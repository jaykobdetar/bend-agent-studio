"""Analyze a CSV exported by experiment.mjs. Uses the Python standard library."""

import argparse
import csv
import hashlib
import gzip
import math
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def number(row, key):
    value = float(row[key])
    if not math.isfinite(value):
        raise ValueError(f"{key} must be finite")
    return value


def measure(row, phase, metric):
    if metric == "reward_per_step":
        steps = int(row[phase + "_steps"]) + (int(row.get("partial_steps", 0)) if phase == "train" else 0)
        reward = number(row, phase + "_sum") + (float(row.get("partial_return", 0)) if phase == "train" else 0)
        if not steps:
            raise ValueError("reward per step is undefined without interactions")
        return reward / steps
    count = int(row[phase + "_episodes"])
    if count <= 0:
        raise ValueError(f"{phase} has no episodes")
    keys = {"return": "_sum", "steps": "_steps", "completion": "_terminal",
            "timeout": "_limited", "illegal": "_illegal"}
    return number(row, phase + keys[metric]) / count


def interval(values, draws, name):
    """Percentile bootstrap over independently trained replicate blocks."""
    n = len(values)
    if n < 2:
        return "", ""
    if min(values) == max(values):
        return values[0], values[0]
    seed = int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big")
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(values, k=n)) for _ in range(draws))

    def quantile(p):
        index = (draws - 1) * p
        lo = math.floor(index)
        return means[lo] + (means[math.ceil(index)] - means[lo]) * (index - lo)

    return quantile(0.025), quantile(0.975)


def budget(row):
    return int(row.get("budget", row["trained_episodes"]))


def read_csv(filename):
    path = Path(filename)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", newline="", encoding="utf-8") as source:
        return list(csv.DictReader(source))


def read_rows(filename):
    rows = read_csv(filename)
    if not rows:
        raise ValueError("empty experiment export")
    seen = set()
    checkpoints = defaultdict(set)
    designs = defaultdict(set)
    phase_counts = {}
    for row in rows:
        g, a, rep, n = row["game"], row["arm"], int(row["replicate"]), budget(row)
        key = (g, a, rep, n)
        if key in seen:
            raise ValueError(f"duplicate trial checkpoint {key}")
        seen.add(key)
        if row.get("budget_unit") == "steps":
            if int(row["train_steps"]) + int(row["partial_steps"]) != n or int(row["interaction_steps"]) != n:
                raise ValueError(f"interaction accounting mismatch at {key}")
        checkpoints[g, a, rep].add(n)
        designs[g, n].add((a, rep))
        for phase in ["train", "validation", "test"]:
            field = row[phase + "_episodes"]
            if not field:
                if phase != "test":
                    raise ValueError(f"missing {phase} metrics at {key}")
                continue
            episodes = int(field)
            stops = sum(int(row[f"{phase}_{k}"]) for k in ("terminal", "limited", "illegal"))
            if episodes != stops or (phase == "train" and episodes != int(row["trained_episodes"])):
                raise ValueError(f"episode accounting mismatch at {key}")
            pair = (g, rep, n, phase)
            matched_budget = n if phase == "train" and row.get("budget_unit") == "steps" else episodes
            block = int(row[phase + "_seed"]), matched_budget
            if pair in phase_counts and phase_counts[pair] != block:
                raise ValueError(f"unpaired {phase} seed block at {key}")
            phase_counts[pair] = block
    all_checkpoints = set.union(*checkpoints.values())
    if any(ns != all_checkpoints for ns in checkpoints.values()):
        raise ValueError("incomplete learning curves")
    for game, n in designs:
        treatments = {a for a, _ in designs[game, n]}
        reps = {i for _, i in designs[game, n]}
        if designs[game, n] != {(a, i) for a in treatments for i in reps}:
            raise ValueError("missing paired replicates")
    last = max(all_checkpoints)
    has_test = any(r["test_episodes"] for r in rows)
    if has_test and any(bool(r["test_episodes"]) != (budget(r) == last) for r in rows):
        raise ValueError("held-out test must occur only at the final checkpoint")
    return rows


def study_groups(rows, phase, metric):
    grouped = defaultdict(dict)
    for row in rows:
        if not row[phase + "_episodes"] or (int(row[phase + "_episodes"]) == 0 and not (phase == "train" and metric == "reward_per_step" and int(row.get("partial_steps",0)))):
            continue
        key = row["game"], budget(row), row["arm"]
        grouped[key][int(row["replicate"])] = measure(row, phase, metric)
    return grouped


def deployment_groups(rows, metric):
    """Pair deployed policies on the same target, seeds, and episode count."""
    grouped = defaultdict(dict)
    blocks = {}
    treatments = defaultdict(set)
    for row in rows:
        game = row.get("target", row.get("game"))
        arm = row.get("comparison", row.get("arm"))
        rep = int(row["replicate"])
        block = int(row["seed"]), int(row["episodes"])
        if block[1] < 1 or sum(int(row[k]) for k in ("terminal", "limited", "illegal")) != block[1]:
            raise ValueError("invalid deployment episode counts")
        if blocks.setdefault((game, rep), block) != block:
            raise ValueError("deployment evaluations use different seed blocks")
        key = game, "deployed", arm
        if rep in grouped[key]:
            raise ValueError("duplicate deployment replicate")
        aliases = {"return": "sum", "steps": "steps", "completion": "terminal", "timeout": "limited", "illegal": "illegal"}
        if metric == "reward_per_step":
            steps = int(row["steps"])
            if not steps:
                raise ValueError("reward per step is undefined without interactions")
            value = number(row, "sum") / steps
        else:
            value = number(row, aliases[metric]) / block[1]
        grouped[key][rep] = value
        treatments[game].add(arm)
    for game, arms in treatments.items():
        rep_sets = [set(grouped[game, "deployed", a]) for a in arms]
        if any(s != rep_sets[0] for s in rep_sets):
            raise ValueError("missing paired deployment replicates")
    return grouped


# Keep the original callable interface as well as the default CLI/CSV contract.
def analyze(rows, phase, metric, reference, draws):
    summarize(study_groups(rows, phase, metric), phase, metric, reference, draws)


def analyze_deployment(rows, metric, reference, draws):
    summarize(deployment_groups(rows, metric), "deployment", metric, reference, draws)


def sign_test(values):
    """Exact two-sided conditional sign test of equally likely non-tie directions."""
    pos = sum(v > 0 for v in values)
    neg = sum(v < 0 for v in values)
    n = pos + neg
    if not n or abs(pos-neg) <= 1:
        return n, 1.0
    # Exact integer lower-tail sum; shared reference need not be independent
    # across arms, but replicate pairs must be independent within an arm.
    term = total = 1
    for j in range(1, min(pos, neg)+1):
        term = term * (n-j+1) // j
        total += term
    return n, max(math.ulp(0.0), min(1.0, (2*total) / (1 << n)))


def holm(pvalues):
    ordered = sorted(pvalues, key=pvalues.get)
    adjusted, previous = {}, 0.0
    for i, arm in enumerate(ordered):
        previous = max(previous, min(1.0, (len(ordered)-i)*pvalues[arm]))
        adjusted[arm] = previous
    return adjusted


def summarize(grouped, phase, metric, reference, draws, multiple=None):
    if not grouped:
        raise ValueError(f"no {phase} episodes in this experiment")
    if multiple and (multiple != "holm-sign" or not reference):
        raise ValueError("holm-sign requires a named reference")
    families = defaultdict(dict)
    records = []
    writer = csv.writer(sys.stdout, lineterminator="\n")
    header = ["game", "budget", "arm", "reference", "phase", "metric",
                     "replicates", "estimate", "ci_low", "ci_high", "replicate_sd"]
    writer.writerow(header + (["family_size", "non_ties", "sign_p", "holm_sign_p"] if multiple else []))
    for (game, n, arm), block in sorted(grouped.items()):
        if reference and arm == reference:
            continue
        values = [v for _, v in sorted(block.items())]
        if reference:
            other = grouped.get((game, n, reference))
            if other is None or block.keys() != other.keys():
                raise ValueError(f"missing reference {reference} at {game}/{n}")
            values = [v - other[i] for i, v in sorted(block.items())]
        low, high = interval(values, draws, repr((game, n, arm, reference, phase, metric)))
        result = [game, n, arm, reference or "", phase, metric, len(values),
                         statistics.fmean(values), low, high, statistics.stdev(values) if len(values)>1 else ""]
        if not multiple:
            writer.writerow(result)
            continue
        non_ties, raw = sign_test(values)
        families[game, n][arm] = raw
        records.append((game, n, arm, result, non_ties, raw))
    if multiple:
        if not records:
            raise ValueError("no non-reference arms to compare")
        adjusted = {key: holm(ps) for key, ps in families.items()}
        for game, n, arm, result, non_ties, raw in records:
            writer.writerow(result + [len(families[game,n]), non_ties, raw, adjusted[game,n][arm]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", help="study, assessment, or offline score CSV (optionally gzipped)")
    parser.add_argument("--phase", choices=["train","validation","test"])
    parser.add_argument("--metric", choices=["return","steps","completion","timeout","illegal","reward_per_step"], default="return")
    parser.add_argument("--reference", help="estimate paired arm-minus-reference differences")
    parser.add_argument("--draws", type=int, default=2000)
    parser.add_argument("--aggregate", choices=["iqm", "probability-of-improvement", "profile"],
                        help="opt in to fixed-suite statistics instead of per-game means")
    parser.add_argument("--direction", choices=["higher", "lower"],
                        help="which changes count as improvements (required for ambiguous endpoints)")
    scale = parser.add_mutually_exclusive_group()
    scale.add_argument("--comparable", action="store_true", help="raw scores have comparable units across games")
    scale.add_argument("--anchors", help="JSON mapping every game to [bad,good], fixed before evaluation")
    parser.add_argument("--threshold", type=float, help="strict score threshold for the profile statistic")
    parser.add_argument("--blocks", choices=["within-game", "across-games"],
                        help="resample IDs per fixed game (default), or share ID draws across games")
    parser.add_argument("--multiple", choices=["holm-sign"], help="Holm-adjusted paired direction tests per game/budget; requires --reference")
    args = parser.parse_args()
    if args.multiple and (args.aggregate or not args.reference):
        parser.error("--multiple requires --reference and is not a suite aggregate")
    if not args.aggregate and any([args.direction, args.comparable, args.anchors, args.threshold is not None, args.blocks]):
        parser.error("aggregate-only option requires --aggregate")
    if args.draws < 100:
        parser.error("supply at least 100 bootstrap draws")
    rows = read_csv(args.csv)
    if not rows:
        parser.error("empty CSV")
    if "source_checkpoint" in rows[0] or "holdout_episodes" in rows[0]:
        if args.phase:
            parser.error("deployment scores have a single evaluation phase")
        phase = "deployment"
        groups = deployment_groups(rows, args.metric)
        games = {r.get("target", r.get("game")) for r in rows}
        unit = "deployment"
    else:
        phase = args.phase or "test"
        rows = read_rows(args.csv)
        groups = study_groups(rows, phase, args.metric)
        games = {r["game"] for r in rows}
        units = {r.get("budget_unit", "episodes") for r in rows} if args.aggregate else set()
        if args.aggregate and (len(units) != 1 or not units <= {"episodes", "steps"}):
            parser.error("suite requires a single known budget unit")
        unit = next(iter(units), None)
    if args.aggregate:
        from suite_stats import aggregate_csv
        aggregate_csv(groups, games, phase, unit, args)
    else:
        summarize(groups, phase, args.metric, args.reference, args.draws, args.multiple)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
