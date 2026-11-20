"""Fixed-suite, replicate-level aggregates for analyze.py (standard-library default)."""
from bisect import bisect_left, bisect_right
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import random
import statistics
import sys


def iqm(values):
    """Mean after removing floor(n/4) observations at each end."""
    ordered = sorted(values)
    trim = len(ordered) // 4
    return statistics.fmean(ordered[trim:len(ordered) - trim])


def superiority(candidate, reference):
    """All cross-arm pairs, with half credit for ties; not the matched win rate."""
    ordered = sorted(reference)
    twice_wins = sum(bisect_left(ordered, x) + bisect_right(ordered, x) for x in candidate)
    return twice_wins / (2 * len(candidate) * len(reference))


def estimate(xs, ys, mode, threshold=None):
    if mode == "probability-of-improvement":
        return statistics.fmean(superiority(x, y) for x, y in zip(xs, ys))
    def scalar(tasks):
        values = [v for task in tasks for v in task]
        if mode == "iqm":
            return iqm(values)
        return sum(v > threshold for v in values) / len(values)
    return scalar(xs) - (scalar(ys) if ys is not None else 0.0)


def numpy_safe(xs, ys, draws):
    """Admit only complete, bounded panels represented exactly as binary64."""
    if ys is None or len(xs) != len(ys) or draws < 1:
        return False
    n = len(xs[0])
    if len(xs) * n * n > 65536 or n > 64:
        return False
    try:
        return all(len(task) == n and all(math.isfinite(v) and float(v) == v for v in task)
                   for panel in (xs, ys) for task in panel)
    except OverflowError:
        return False


def bootstrap(xs, ys, mode, threshold, blocks, draws, label):
    """Keep games fixed; matched arm IDs always move together."""
    n = len(xs[0])
    if n < 2:
        return "", ""
    rng = random.Random(int.from_bytes(hashlib.sha256(label.encode()).digest()[:8], "big"))
    sims = None
    if (mode == "probability-of-improvement" and os.environ.get("BEND_ANALYSIS_NUMPY") == "1"
            and numpy_safe(xs, ys, draws)):
        try:
            from bootstrap_numpy import superiority_draws
        except ModuleNotFoundError as exc:
            if exc.name != "numpy":
                raise
        else:
            sims = superiority_draws(xs, ys, blocks, draws, rng)
    if sims is None:
        sims = []
        for _ in range(draws):
            common = rng.choices(range(n), k=n) if blocks == "across-games" else None
            sample_x, sample_y = [], []
            for task, x in enumerate(xs):
                ids = common if common is not None else rng.choices(range(n), k=n)
                sample_x.append([x[i] for i in ids])
                if ys is not None:
                    sample_y.append([ys[task][i] for i in ids])
            sims.append(estimate(sample_x, sample_y if ys is not None else None, mode, threshold))
    sims.sort()
    def quantile(p):
        index = (len(sims) - 1) * p
        lo, hi = math.floor(index), math.ceil(index)
        return sims[lo] + (sims[hi] - sims[lo]) * (index - lo)
    return quantile(.025), quantile(.975)


def aggregate_csv(groups, games, phase, unit, args):
    if not groups:
        raise ValueError(f"no {phase} episodes in suite")
    games = sorted(games)
    arms = sorted({key[2] for key in groups})
    budgets = sorted({key[1] for key in groups})
    ref, mode = args.reference, args.aggregate
    if mode == "probability-of-improvement" and not ref:
        raise ValueError("probability-of-improvement needs --reference")
    if ref and (ref not in arms or len(arms) < 2):
        raise ValueError("reference comparison requires a reference and a challenger")
    if (args.threshold is not None) != (mode == "profile"):
        raise ValueError("supply --threshold exactly for profile")
    if args.threshold is not None and not math.isfinite(args.threshold):
        raise ValueError("threshold must be finite")
    anchors = None
    if args.anchors is not None:
        if args.direction:
            raise ValueError("anchors already define the direction of improvement")
        anchors = json.loads(Path(args.anchors).read_text(encoding="utf-8"))
        if not isinstance(anchors, dict) or set(anchors) != set(games):
            raise ValueError("anchors must name exactly the games in the suite")
        for pair in anchors.values():
            if (not isinstance(pair, list) or len(pair) != 2 or
                not all(type(v) in (float, int) and math.isfinite(v) for v in pair) or
                pair[0] == pair[1] or not math.isfinite(pair[1] - pair[0])):
                raise ValueError("anchors must be distinct finite [bad, good] scores")
    direction = args.direction or {"completion": "higher", "timeout": "lower", "illegal": "lower",
                                  "return": "higher", "reward_per_step": "higher"}.get(args.metric)
    if not anchors and not direction:
        raise ValueError("specify --direction for this metric")
    if (len(games) > 1 and mode != "probability-of-improvement" and not anchors and
        not args.comparable and args.metric not in {"completion", "timeout", "illegal"}):
        raise ValueError("choose --anchors or --comparable before pooling different games")
    def orient(game, value):
        if anchors:
            bad, good = anchors[game]
            value = (value - bad) / (good - bad)
        elif direction == "lower":
            value = -value
        if not math.isfinite(value):
            raise ValueError("nonfinite transformed score")
        return value
    blocks = args.blocks or "within-game"
    output = []
    for budget in budgets:
        ids = None
        matrix = {arm: [] for arm in arms}
        for game in games:
            for arm in arms:
                block = groups.get((game, budget, arm))
                if not block:
                    raise ValueError(f"incomplete suite: {game}/{budget}/{arm}")
                order = sorted(block)
                if ids is None:
                    ids = order
                if order != ids:
                    raise ValueError(f"unbalanced replicate IDs at {game}/{budget}/{arm}")
                matrix[arm].append([orient(game, block[i]) for i in ids])
        for arm in arms:
            if arm == ref:
                continue
            xs, ys = matrix[arm], matrix[ref] if ref else None
            point = estimate(xs, ys, mode, args.threshold)
            label = repr((tuple(games), budget, arm, ref, phase, args.metric, mode, blocks))
            low, high = bootstrap(xs, ys, mode, args.threshold, blocks, args.draws, label)
            output.append([budget,unit,arm,ref or "",phase,args.metric,mode,
                           args.threshold if args.threshold is not None else "",len(games),len(ids),
                           "anchors" if anchors else direction,blocks,args.draws,point,low,high])
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["budget","budget_unit","arm","reference","phase","metric","statistic","threshold",
                     "games","replicates_per_game","score_orientation","replicate_blocks","draws",
                     "estimate","ci_low","ci_high"])
    writer.writerows(output)
