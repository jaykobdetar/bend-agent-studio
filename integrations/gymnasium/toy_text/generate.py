"""Export pinned Gymnasium toy-text benchmarks. Optional build-time dependency only."""

import argparse
import json
from collections import Counter, deque
from fractions import Fraction as F
from functools import cache
from math import lcm
from pathlib import Path

import gymnasium as gym

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "worlds/benchmarks/toy-text"
WORDS = 2**32
CARDS = tuple(range(1, 11))
P = {c: F(4 if c == 10 else 1, 13) for c in CARDS}
SPECS = {
    "lake4-dry": ("FrozenLake-v1", {"is_slippery": False}),
    "lake4-slip": ("FrozenLake-v1", {"is_slippery": True}),
    "lake8-dry": ("FrozenLake8x8-v1", {"is_slippery": False}),
    "lake8-slip": ("FrozenLake8x8-v1", {"is_slippery": True}),
    "taxi": ("Taxi-v4", {}),
    "cliff4x12": ("CliffWalking-v1", {}),
    "blackjack": ("Blackjack-v1", {}),
}


def weights(probabilities):
    """Prefer minimal exact integer weights; otherwise floor *cumulative* endpoints."""
    assert sum(probabilities) == 1 and min(probabilities) > 0
    d = lcm(*(p.denominator for p in probabilities))
    if d <= WORDS:
        return [int(p * d) for p in probabilities]
    cumulative = F(0)
    prev = 0
    result = []
    for p in probabilities:
        cumulative += p
        end = int(cumulative * WORDS)
        result.append(end - prev)
        prev = end
    assert min(result) > 0 and sum(result) == WORDS
    return result


def official(env):
    """Clone terminated destinations so terminality is attached to the *outcome*.
    A state ID may be a live observation elsewhere (notably Taxi drop-off)."""
    n = env.observation_space.n
    starts = [
        (i, F(float(p)).limit_denominator())
        for i, p in enumerate(env.initial_state_distrib)
        if p
    ]
    initial = [
        {"to": i, "weight": w}
        for (i, _), w in zip(starts, weights([p for _, p in starts]))
    ]
    states, ends = [], set()
    for s, actions in sorted(env.P.items()):
        out = []
        for a, xs in sorted(actions.items()):
            ps = [F(float(p)).limit_denominator() for p, _, _, _ in xs]
            transitions = []
            for (_, dest, reward, done), w in zip(xs, weights(ps)):
                dest = int(dest)
                if done:
                    ends.add(dest)
                transitions.append(
                    {
                        "to": int(dest + n if done else dest),
                        "reward": int(reward),
                        "weight": w,
                    }
                )
            out.append({"id": int(a), "outcomes": transitions})
        states.append({"id": int(s), "actions": out})
    states += [
        {"id": int(n + s), "observation": s, "actions": []} for s in sorted(ends)
    ]
    return {"schema": 1, "initial": initial, "states": states}


def add(total, usable, card):
    hard = total - 10 * usable + card
    usable = (usable or card == 1) and hard <= 11
    return hard + 10 * usable, bool(usable)


@cache
def finish(total, usable):
    if total >= 17:
        return {total if total <= 21 else 0: F(1)}
    out = Counter()
    for c, p in P.items():
        for s, q in finish(*add(total, usable, c)).items():
            out[s] += p * q
    return dict(out)


@cache
def dealer(up):
    out = Counter()
    for hole, p in P.items():
        natural = {up, hole} == {1, 10}
        for s, q in finish(*add(*add(0, False, up), hole)).items():
            out[s, natural] += p * q
    return out


def blackjack():
    """Track the initial natural separately; a soft 21 from three cards is not a natural."""
    starts = Counter()
    for a, pa in P.items():
        for b, pb in P.items():
            total, usable = add(*add(0, False, a), b)
            for up, pu in P.items():
                starts[total, up, usable, {a, b} == {1, 10}, False] += pa * pb * pu
    queue, ids, states = deque(), {}, []

    def intern(key):
        if key not in ids:
            ids[key] = len(ids)
            queue.append(key)
        return ids[key]

    initial = [
        {"to": intern(k), "weight": w}
        for k, w in zip(starts, weights(list(starts.values())))
    ]
    while queue:
        k = queue.popleft()
        total, up, u, natural, end = k
        actions = []
        if not end:
            rewards = Counter()
            for (score, dealer_natural), p in dealer(up).items():
                reward = (
                    1
                    if natural and not dealer_natural
                    else int(total > score) - int(total < score)
                )
                rewards[reward] += p
            stick = intern((total, up, u, False, True))
            rs = sorted(rewards)
            actions.append(
                {
                    "id": 0,
                    "outcomes": [
                        {"to": stick, "reward": r, "weight": w}
                        for r, w in zip(rs, weights([rewards[r] for r in rs]))
                    ],
                }
            )
            xs = []
            for c in CARDS:
                nt, nu = add(total, u, c)
                bust = nt > 21
                xs.append(
                    {
                        "to": intern((nt, up, nu, False, bust)),
                        "reward": -int(bust),
                        "weight": int(P[c] * 13),
                    }
                )
            actions.append({"id": 1, "outcomes": xs})
        states.append(
            {
                "id": ids[k],
                "observation": (total * 16 + up) * 2 + int(u),
                "actions": actions,
            }
        )
    return {"schema": 1, "initial": initial, "states": states}


def render(w):
    compact = lambda v: json.dumps(v, separators=(",", ":"))
    return (
        '{"schema":1,"initial":'
        + compact(w["initial"])
        + ',"states":[\n'
        + ",\n".join(map(compact, w["states"]))
        + "\n]}\n"
    )


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("--check", action="store_true")
    args = arg.parse_args()
    if gym.__version__ != "1.4.0":
        raise RuntimeError("generator requires gymnasium 1.4.0")
    for name, (id, opts) in SPECS.items():
        spec = gym.spec(id)
        if name == "blackjack":
            assert spec.kwargs == {"sab": True, "natural": False}
            w = blackjack()
        else:
            env = gym.make(id, **opts)
            try:
                w = official(env.unwrapped)
            finally:
                env.close()
        f = OUT / (name + ".json")
        data = render(w).encode()
        if args.check:
            if f.read_bytes() != data:
                raise RuntimeError(f"generated world differs: {name}")
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
        print(name, len(w["states"]), spec.max_episode_steps, len(data))


if __name__ == "__main__":
    main()
