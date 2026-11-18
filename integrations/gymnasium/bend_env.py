"""Gymnasium adapter for the repository's finite/grid JSON worlds."""
from bisect import bisect_left
import json
from numbers import Integral
from pathlib import Path
import subprocess

import gymnasium as gym
from gymnasium import spaces
import numpy as np

_MASK = 0xffffffff
_BRIDGE = Path(__file__).with_name("compile_world.mjs")


def _next(seed):
    return (seed * 1664525 + 1013904223) & _MASK


def _mix(word):
    a = ((word ^ (word >> 16)) * 2246822507) & _MASK
    b = ((a ^ (a >> 13)) * 3266489909) & _MASK
    return b ^ (b >> 16)


def _distribution(outcomes):
    return tuple(x["upper"] for x in outcomes), tuple(outcomes)


def _draw(distribution, word):
    uppers, outcomes = distribution
    return outcomes[bisect_left(uppers, word)]


class BendFiniteEnv(gym.Env):
    """Preserves Bend public views and draws; step takes a dense action index."""

    metadata = {"render_modes": []}

    def __init__(self, world, *, horizon, node="node"):
        super().__init__()
        if not isinstance(horizon, Integral) or isinstance(horizon, bool) or not 1 <= horizon <= _MASK:
            raise ValueError("horizon must be a positive U32")
        self.horizon = int(horizon)
        source = (Path(world).read_text(encoding="utf-8") if isinstance(world, (str, Path))
                  else json.dumps(world, allow_nan=False))
        built = subprocess.run([node, str(_BRIDGE)], input=source, capture_output=True,
                               text=True, check=False, timeout=10)
        if built.returncode:
            raise ValueError(built.stderr.strip())
        raw = json.loads(built.stdout)
        self._initial = _distribution(raw["initial"])
        self.action_ids = tuple(sorted({a["id"] for s in raw["states"] for a in s["actions"]}))
        self._indices = {v: i for i, v in enumerate(self.action_ids)}
        self.action_space = spaces.Discrete(max(1, len(self.action_ids)))
        # No array is allocated for unused numeric observation IDs.
        self.observation_space = spaces.Discrete(1 + max(s["observation"] for s in raw["states"]))
        self._states = {s["id"]: (s["observation"], {a["id"]: _distribution(a["outcomes"])
                        for a in s["actions"]}) for s in raw["states"]}
        self._done = True

    def _view(self, reason=None):
        observation, actions = self._states[self._state]
        mask = np.zeros(self.action_space.n, dtype=np.int8)
        for action in actions:
            mask[self._indices[action]] = 1
        # No hidden state IDs or simulation RNG words appear in the public view.
        return observation, {"legal_action_ids": tuple(actions), "action_mask": mask,
                             "bend_episode_score": float(self._score), "reason": reason}

    def reset(self, *, seed=None, options=None):
        if seed is not None and (not isinstance(seed, Integral) or isinstance(seed, bool) or not 0 <= seed <= _MASK):
            raise ValueError("explicit Bend episode seeds must be U32")
        if options:
            raise ValueError("no reset options supported")
        super().reset(seed=None if seed is None else int(seed))
        episode_seed = int(self.np_random.integers(1 << 32)) if seed is None else int(seed)
        self._state = _draw(self._initial, _mix(episode_seed ^ 3266489917))["to"]
        self._seed = _next(episode_seed)
        self._steps = 0
        self._score = np.float32(0.0)
        self._done = False
        self._initial_terminal = not self._states[self._state][1]
        return self._view("terminal_on_reset" if self._initial_terminal else None)

    def step(self, action):
        if self._done:
            raise gym.error.ResetNeeded("reset before stepping")
        if not self.action_space.contains(action):
            raise ValueError("action is outside the declared Gymnasium space")
        actions = self._states[self._state][1]
        aid = self.action_ids[int(action)] if self.action_ids else None
        if self._initial_terminal or aid not in actions:
            self._done = True
            obs, info = self._view("terminal_on_reset" if self._initial_terminal else "illegal")
            return obs, 0.0, True, False, info
        world_seed = _next(self._seed)
        out = _draw(actions[aid], _mix(world_seed ^ 2779096485))
        self._seed = _next(world_seed)
        self._steps += 1
        # E.recorded_step rounds after each addition, not just at episode end.
        with np.errstate(over="ignore", invalid="ignore"):
            self._score = np.float32(self._score + np.float32(out["reward"]))
        self._state = out["to"]
        terminated = not self._states[self._state][1]
        truncated = not terminated and self._steps == self.horizon
        self._done = terminated or truncated
        obs, info = self._view("terminal" if terminated else "limit" if truncated else None)
        return obs, float(out["reward"]), terminated, truncated, info
