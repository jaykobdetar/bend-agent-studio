import json
import math
import subprocess
import sys
import unittest
from collections import Counter
from fractions import Fraction as F
from functools import cache
from itertools import pairwise
from pathlib import Path

import gymnasium as gym
import numpy as np
from bend_env import BendFiniteEnv

from toy_text.generate import OUT, SPECS

HERE = Path(__file__).resolve().parent
WORDS = 2**32


def wire(data):
    return json.loads(
        subprocess.check_output(
            ["node", str(HERE.parent / "compile_world.mjs")],
            input=json.dumps(data),
            text=True,
            timeout=20,
        )
    )


def probabilities(xs):
    if "upper" in xs[0]:
        ends = [-1] + [x["upper"] for x in xs]
        return [F(b - a, WORDS) for a, b in pairwise(ends)]
    total = sum(y["weight"] for y in xs)
    return [F(x["weight"], total) for x in xs]


class TestPorts(unittest.TestCase):
    def test_rebuild_and_oracles(self):
        subprocess.run(
            [sys.executable, str(HERE / "generate.py"), "--check"], check=True
        )
        subprocess.run(["node", str(HERE / "oracles.mjs")], check=True)

    def test_tabular_kernels_and_reset(self):
        for name, (gid, kwargs) in SPECS.items():
            if name == "blackjack":
                continue
            with self.subTest(name=name), gym.make(gid, **kwargs) as source:
                e = source.unwrapped
                raw = json.loads((OUT / (name + ".json")).read_text())
                limits = json.loads((HERE / "baselines.json").read_text())
                if source.spec.max_episode_steps is not None:
                    self.assertEqual(
                        limits[name]["horizon"], source.spec.max_episode_steps
                    )
                else:
                    self.assertEqual(name, "cliff4x12")
                for compiled, w in [(False, raw), (True, wire(raw))]:
                    states = {s["id"]: s for s in w["states"]}
                    reset = {
                        x["to"]: p
                        for x, p in zip(w["initial"], probabilities(w["initial"]))
                    }
                    ideal = {
                        i: F(float(p)).limit_denominator()
                        for i, p in enumerate(e.initial_state_distrib)
                        if p
                    }
                    self.assertEqual(reset.keys(), ideal.keys())
                    for k, probability in reset.items():
                        self.assertLessEqual(
                            abs(probability - ideal[k]), F(1, WORDS) if compiled else 0
                        )
                    for s, acts in e.P.items():
                        exported = states[s]["actions"]
                        self.assertEqual([a["id"] for a in exported], list(acts))
                        for a in exported:
                            uses = Counter()
                            expected = Counter()
                            xs = a["outcomes"]
                            for x, p in zip(xs, probabilities(xs)):
                                dest = states[x["to"]]
                                uses[
                                    dest.get("observation", dest["id"]),
                                    x["reward"],
                                    not dest["actions"],
                                ] += p
                            for p, d, r, done in acts[a["id"]]:
                                expected[int(d), int(r), bool(done)] += F(
                                    float(p)
                                ).limit_denominator()
                            self.assertEqual(uses.keys(), expected.keys())
                            for k in uses:
                                self.assertLessEqual(
                                    abs(uses[k] - expected[k]),
                                    F(len(xs), WORDS) if compiled else 0,
                                )
                                if compiled and (
                                    name.endswith("dry")
                                    or name in ("taxi", "cliff4x12")
                                ):
                                    self.assertEqual(uses[k], expected[k])

    def test_wall_and_goal_in_dry_lake(self):
        with (
            gym.make("FrozenLake-v1", is_slippery=False) as gym_env,
            BendFiniteEnv(OUT / "lake4-dry.json", horizon=100) as bend_env,
        ):
            self.assertEqual(gym_env.reset(seed=11)[0], bend_env.reset(seed=93)[0])
            for action in [0, 1, 1, 2, 1, 2, 2]:
                actual = bend_env.step(action)[:4]
                self.assertEqual(gym_env.step(action)[:4], actual)
            self.assertEqual(actual, (15, 1.0, True, False))

    def test_slip_cannot_be_exactly_represented_by_one_u32(self):
        raw = json.loads((OUT / "lake4-slip.json").read_text())
        xs = wire(raw)["states"][0]["actions"][0]["outcomes"]
        p = probabilities(xs)
        self.assertEqual(sum(p), 1)
        self.assertEqual(set(p), {F(1431655765, WORDS), F(1431655766, WORDS)})
        self.assertNotIn(F(1, 3), p)

    def test_blackjack_initial_natural_ties_only_another_natural(self):
        raw = json.loads((OUT / "blackjack.json").read_text())
        states = {s["id"]: s for s in raw["states"]}
        checked = set()
        for start in raw["initial"]:
            s = states[start["to"]]
            # A two-card soft 21 is always an initial natural.
            for up in range(1, 11):
                if s["observation"] != (21 * 16 + up) * 2 + 1:
                    continue
                stick = s["actions"][0]["outcomes"]
                reward_probs = {
                    x["reward"]: p for x, p in zip(stick, probabilities(stick))
                }
                hole_completes = F(4, 13) if up == 1 else F(1, 13) if up == 10 else F(0)
                self.assertEqual(reward_probs.get(0, 0), hole_completes)
                self.assertEqual(reward_probs[1], 1 - hole_completes)
                checked.add(up)
        self.assertEqual(checked, set(range(1, 11)))

    def test_blackjack_public_optimal_policy(self):
        raw = json.loads((OUT / "blackjack.json").read_text())
        w = wire(raw)
        states = {s["id"]: s for s in w["states"]}
        policy = {}

        @cache
        def value(i):
            s = states[i]
            if not s["actions"]:
                return 0.0
            qs = [
                sum(
                    float(p) * (x["reward"] + value(x["to"]))
                    for p, x in zip(probabilities(a["outcomes"]), a["outcomes"])
                )
                for a in s["actions"]
            ]
            best = int(np.argmax(qs))
            self.assertEqual(policy.setdefault(s["observation"], best), best)
            return max(qs)

        truth = sum(
            float(p) * value(x["to"])
            for x, p in zip(w["initial"], probabilities(w["initial"]))
        )
        baseline = json.loads((HERE / "baselines.json").read_text())["blackjack"]
        self.assertAlmostEqual(truth, baseline["optimal"], places=12)
        for bend in [False, True]:
            env = BendFiniteEnv(raw, horizon=32) if bend else gym.make("Blackjack-v1")
            scores = []
            try:
                for i in range(25000):
                    obs, _ = env.reset(seed=20261118 + i)
                    for j in range(32):
                        if not bend:
                            total, up, u = obs
                            obs = (total * 16 + up) * 2 + int(u)
                        obs, r, terminated, truncated, _ = env.step(policy[obs])
                        self.assertFalse(truncated)
                        if terminated:
                            scores.append(r)
                            break
                    else:
                        self.fail("blackjack did not end by the bound")
            finally:
                env.close()
            mean = np.mean(scores)
            se = np.std(scores, ddof=1) / math.sqrt(len(scores))
            print(
                f"Blackjack {'Bend' if bend else 'Gym'}: N={len(scores)}, mean={mean:.6f}, SE={se:.6f}, oracle={truth:.6f}"
            )
            self.assertLessEqual(abs(mean - truth), 4 * se)
