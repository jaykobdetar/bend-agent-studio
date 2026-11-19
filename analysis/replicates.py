"""Estimate paired replicate count and sign-test power from a pilot export."""
import argparse
import json
import math
import random
import statistics
import sys

from analyze import budget, measure, read_rows


METRICS = ("return", "steps", "completion", "timeout", "illegal", "reward_per_step")
MAX_REPLICATES = 2_000


def paired_differences(rows, game, checkpoint, phase, metric, reference, challenger):
    if reference == challenger:
        raise ValueError("reference and challenger must be different")
    groups = {reference: {}, challenger: {}}
    units = set()
    for row in rows:
        if row["game"] != game or budget(row) != checkpoint or row["arm"] not in groups:
            continue
        unit = row.get("budget_unit") or "episodes"
        if unit not in ("episodes", "steps"):
            raise ValueError("unknown budget unit")
        units.add(unit)
        rep = int(row["replicate"])
        if rep < 0 or rep in groups[row["arm"]]:
            raise ValueError("invalid or duplicate replicate")
        if not row[phase + "_seed"]:
            raise ValueError("selected phase has no paired seed")
        seed, episodes = int(row[phase + "_seed"]), int(row[phase + "_episodes"])
        keys = ("steps", "terminal", "limited", "illegal")
        if min(seed, episodes, *(int(row[f"{phase}_{key}"]) for key in keys)) < 0:
            raise ValueError("selected phase has negative accounting values")
        if phase == "train" and int(row.get("partial_steps") or 0) < 0:
            raise ValueError("selected phase has negative partial steps")
        value = measure(row, phase, metric)
        if not math.isfinite(value):
            raise ValueError("selected metric must be finite")
        block = (seed, checkpoint if phase == "train" and unit == "steps" else episodes)
        groups[row["arm"]][rep] = (block, value)
    lhs, rhs = groups[challenger], groups[reference]
    if len(units) != 1 or set(lhs) != set(rhs) or len(lhs) < 2:
        raise ValueError("select a single budget with at least two complete matched replicate blocks")
    seeds, differences = set(), []
    for rep in sorted(lhs):
        block, value = lhs[rep]
        rblock, reference_value = rhs[rep]
        if block != rblock or block[0] in seeds:
            raise ValueError("replicates must have distinct, matched seed blocks")
        seeds.add(block[0])
        difference = value - reference_value
        if not math.isfinite(difference):
            raise ValueError("paired differences must be finite")
        differences.append(difference)
    return units.pop(), differences


def bootstrap_half_width(values, draws, seed):
    """95% percentile half-width for paired means at pilot sample size."""
    n = len(values)
    if min(values) == max(values):
        return 0.0
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(values, k=n)) for _ in range(draws))

    def quantile(p):
        pos = (draws - 1) * p
        low, fraction = int(pos), pos % 1
        return means[low] * (1 - fraction) + means[math.ceil(pos)] * fraction

    return quantile(.975) / 2 - quantile(.025) / 2


def binomial_weights(n, p):
    """Stable relative-mass recurrence around the mode, normalized to one."""
    if p == 0:
        return [1.0] + [0.0] * n
    if p == 1:
        return [0.0] * n + [1.0]
    mode = min(n, math.floor((n + 1) * p))
    q = 1 - p
    weights = [0.0] * (n + 1)
    weights[mode] = 1.0
    for k in range(mode, n):
        weights[k + 1] = weights[k] * ((n - k) * p) / ((k + 1) * q)
    for k in range(mode, 0, -1):
        weights[k - 1] = weights[k] * (k * q) / ((n - k + 1) * p)
    total = math.fsum(weights)
    return [w / total for w in weights]


def critical_low(n):
    """Largest lower-tail count rejected by the exact two-sided 5% test."""
    denominator = 1 << n
    term = total = 1
    k = 0
    # 2 * lower-tail probability <= 1/20, compared without floating point.
    while 40 * total <= denominator:
        k += 1
        term = term * (n - k + 1) // k
        total += term
    return k - 1


def sign_power(n, non_tie_probability, positive_given_non_tie):
    """Average exact conditional rejection over the planned random non-tie count."""
    non_tie_counts = binomial_weights(n, non_tie_probability)
    power = []
    for m, mass in enumerate(non_tie_counts):
        if not mass:
            continue
        low = critical_low(m)
        if low >= 0:
            positives = binomial_weights(m, positive_given_non_tie)
            reject = math.fsum(positives[:low + 1] + positives[m - low:])
            power.append(mass * reject)
    return min(1.0, max(0.0, math.fsum(power)))


def estimate(values, target, draws=4_000, seed=0):
    n = len(values)
    if not 2 <= n <= MAX_REPLICATES:
        raise ValueError(f"pilot must have 2–{MAX_REPLICATES} matched replicates")
    if not math.isfinite(target) or target <= 0:
        raise ValueError("target half-width must be finite and positive")
    if not 1_000 <= draws <= 10_000:
        raise ValueError("draws must be 1000–10000")
    width = bootstrap_half_width(values, draws, seed)
    # Resampling from the empirical distribution uses denominator n, not n-1.
    corrected = width * math.sqrt(n / (n - 1))
    ratio = corrected / target
    if not math.isfinite(ratio) or ratio > math.sqrt(MAX_REPLICATES / n):
        raise ValueError(f"estimated count exceeds {MAX_REPLICATES}; reconsider the target or collect a larger pilot")
    required = max(n, math.ceil(n * ratio * ratio))
    if required > MAX_REPLICATES:
        raise ValueError(f"estimated count exceeds {MAX_REPLICATES}")
    positives = sum(d > 0 for d in values)
    negatives = sum(d < 0 for d in values)
    non_ties = positives + negatives
    conditional_win = positives / non_ties if non_ties else None
    return {
        "planning_only": True,
        "pilot_replicates": n,
        "required_replicates": required,
        "pilot_mean_difference": statistics.fmean(values),
        "pilot_bootstrap_half_width": width,
        "projected_half_width": corrected * math.sqrt(n / required),
        "target_half_width": target,
        "bootstrap_draws": draws,
        "bootstrap_seed": seed,
        "pilot_positive": positives,
        "pilot_negative": negatives,
        "pilot_ties": n - non_ties,
        "p_positive_given_non_tie": conditional_win,
        "sign_test_alpha": 0.05,
        "sign_test_power": sign_power(required, non_ties / n, conditional_win or 0.0),
        "warning": ("No pilot variance detected; precision cannot be inferred from this pilot."
                    if width == 0 else None),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", help="verified training export CSV (optionally .gz)")
    parser.add_argument("--game", required=True)
    parser.add_argument("--budget", required=True, type=int)
    parser.add_argument("--phase", choices=("train", "validation", "test"), default="validation")
    parser.add_argument("--metric", choices=METRICS, default="return")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--challenger", required=True)
    parser.add_argument("--target-half-width", required=True, type=float)
    parser.add_argument("--draws", type=int, default=4_000)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        unit, values = paired_differences(read_rows(args.csv), args.game, args.budget, args.phase,
                                          args.metric, args.reference, args.challenger)
        result = estimate(values, args.target_half_width, args.draws, args.seed)
        print(json.dumps({"game": args.game, "budget": args.budget, "budget_unit": unit,
                          "phase": args.phase, "metric": args.metric, "reference": args.reference,
                          "challenger": args.challenger, **result}, indent=2, allow_nan=False))
    except (ArithmeticError, OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(2, f"replicates.py: {exc}\n")


if __name__ == "__main__":
    main()
