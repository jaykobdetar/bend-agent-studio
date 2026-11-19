#!/usr/bin/env python3
"""Summarize a verified memory-capacity archive without executing its backend."""

import itertools
import json
import math
import statistics
import sys
from pathlib import Path

WIDTH = 16
CAPACITIES = [0, 2, 4, 6, 8, 12, 16]
BUDGETS = [0, 128, 512, 2048, 8192]
REPLICATES = 8


def return_from_policy(width, retain, policy):
    """Exact value on fair independent cues and a uniform query."""
    contexts = width * 2**retain
    # Unknown labels contribute zero. Unseen actions tie and choose 0;
    # the all-zero policy has zero expected return for every capacity.
    return sum(
        2 if (memory >> (width - 1 - query)) & 1 else -2
        for (query, memory), guess in policy.items()
        if query >= width - retain and guess == 1
    ) / contexts


def check_tiny():
    for k in range(3):
        contexts = list(itertools.product(range(2), range(2**k)))
        ceiling = -1
        for choices in itertools.product([0, 1], repeat=len(contexts)):
            policy = dict(zip(contexts, choices))
            known = return_from_policy(2, k, policy)
            exhaustive = sum(
                1 if policy[q, mask % (2**k)] == ((mask >> (1 - q)) & 1) else -1
                for mask, q in itertools.product(range(4), range(2))
            ) / 8
            assert known == exhaustive
            ceiling = max(ceiling, known)
        assert ceiling == k / 2


def score_checkpoint(path, k, n):
    body = json.loads(path.read_text(encoding="utf8"))["body"]
    values = body["model"]["values"]
    assert body["train"]["episodes"] == body["train"]["terminal"] == n
    assert body["train"]["steps"] == (WIDTH + 1) * n
    query_values, visits = {}, 0
    if values["$"] != "Nil":
        assert values["$"] == "Con" and values["head"]["$"] == "Indexed"
        assert values["tail"]["$"] == "Nil"
        stack = [values["head"]["tree"]]
        while stack:
            node = stack.pop()
            if node["$"] == "Vacant":
                continue
            assert node["$"] == "Node"
            stack.extend((node["lo"], node["hi"]))
            memory, event = divmod(node["s"], 3 * WIDTH + 2)
            assert 0 <= memory < 2**k
            if 2 * WIDTH + 1 <= event <= 3 * WIDTH:
                query = event - (2 * WIDTH + 1)
                assert node["a"] in (0, 1)
                query_values.setdefault((query, memory), {})[node["a"]] = node["cell"]["value"]
                visits += node["cell"]["visits"]
    assert visits == n
    greedy = {c: int(q.get(1, 0) > q.get(0, 0)) for c, q in query_values.items()}
    assert all(
        guess == ((m >> (WIDTH - 1 - q)) & 1)
        for (q, m), guess in greedy.items()
        if q >= WIDTH - k
    )
    return {
        "exact": return_from_policy(WIDTH, k, greedy),
        "visited": len(greedy),
        "validation": body["validation"]["mean"],
        "test": body["test"]["mean"] if body["test"] else None,
    }


def average(values):
    return round(statistics.mean(values), 8)


def bounds(values):
    mean = statistics.mean(values)
    half = 2.364624251 * statistics.stdev(values) / math.sqrt(REPLICATES)
    return [round(mean - half, 8), round(mean + half, 8)]


def analyze(root):
    plan = json.loads((root / "run.json").read_text(encoding="utf8"))["body"]["plan"]
    assert plan["name"] == "memory-capacity-width16"
    assert plan["replicates"] == REPLICATES and plan["checkpoints"] == BUDGETS
    assert [g["id"] for g in plan["games"]] == [f"retain-{k}" for k in CAPACITIES]
    check_tiny()
    rows = {}
    cells = {
        (n, k): [
            score_checkpoint(root / "trials" / f"retain-{k}" / "q" / str(r) / f"{n}.json", k, n)
            for r in range(REPLICATES)
        ]
        for n, k in itertools.product(BUDGETS, CAPACITIES)
    }
    for (n, k), runs in cells.items():
        metrics = {name: average([x[name] for x in runs]) for name in ("exact", "visited", "validation")}
        contexts = WIDTH * 2**k
        metrics["iid_first_visit_return"] = round((-k / WIDTH) * math.expm1(n * math.log1p(-1 / contexts)), 8)
        if n == BUDGETS[-1]:
            metrics["test"] = average([x["test"] for x in runs])
        rows.setdefault(str(n), {})[str(k)] = metrics

    contrasts = []
    for n, a, b, metric in (
        (128, 2, 4, "exact"), (512, 4, 6, "exact"),
        (2048, 6, 16, "exact"), (2048, 6, 0, "exact"),
        (8192, 8, 6, "exact"), (8192, 8, 6, "test"),
        (8192, 16, 0, "test"),
    ):
        differences = [x[metric] - y[metric] for x, y in zip(cells[n, a], cells[n, b])]
        contrasts.append({
            "episodes": n, "left": a, "right": b, "metric": metric,
            "mean_difference": average(differences), "paired_t_interval_95": bounds(differences),
        })
    return {"replicates": REPLICATES, "rows": rows, "paired_differences": contrasts}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 audit.py VERIFIED_RUN")
    print(json.dumps(analyze(Path(sys.argv[1])), indent=2))
