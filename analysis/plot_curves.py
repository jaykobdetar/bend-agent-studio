"""Plot per-checkpoint means and pointwise bootstrap intervals across trained replicates."""
import argparse
from collections import defaultdict
from pathlib import Path
import statistics
import sys

from analyze import budget, interval, measure, read_rows


def learning_curves(rows, phase, metric, reference, arms, games, draws):
    groups = defaultdict(dict)
    for row in rows:
        game, arm = row["game"], row["arm"]
        if games and game not in games or arms and arm not in arms and arm != reference:
            continue
        if not row[phase + "_episodes"]:
            continue
        if int(row[phase + "_episodes"]) == 0:
            if phase != "train" or metric != "reward_per_step" or int(row.get("partial_steps", 0)) == 0:
                continue
        groups[game, arm, budget(row)][int(row["replicate"])] = measure(row, phase, metric)
    series = defaultdict(list)
    for (game, arm, checkpoint), sample in sorted(groups.items()):
        if arm == reference:
            continue
        values = [v for _, v in sorted(sample.items())]
        if reference:
            baseline = groups.get((game, reference, checkpoint))
            if baseline is None or sample.keys() != baseline.keys():
                raise ValueError(f"missing paired reference for {game} at {checkpoint}")
            values = [v - baseline[rep] for rep, v in sorted(sample.items())]
        # Share resampling draws across arms to keep equivalent curves equivalent.
        low, high = interval(values, draws, repr((game, checkpoint, phase, metric)))
        series[game, arm].append((checkpoint, statistics.fmean(values), low, high))
    if not series:
        raise ValueError("no eligible replicate measurements")
    return series


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", help="experiment export or .csv.gz")
    parser.add_argument("output", help="destination .svg, .pdf, or .png")
    parser.add_argument("--phase", choices=["train", "validation", "test"], default="validation")
    parser.add_argument("--metric", choices=["return", "steps", "completion", "timeout", "illegal", "reward_per_step"], default="return")
    parser.add_argument("--reference")
    parser.add_argument("--arms", nargs="+")
    parser.add_argument("--games", nargs="+")
    parser.add_argument("--draws", type=int, default=2000)
    parser.add_argument("--xscale", choices=["linear", "symlog"], default="linear")
    args = parser.parse_args()
    if args.draws < 100:
        parser.error("bootstrap draws must be at least 100")
    output = Path(args.output)
    if output.suffix.lower() not in {".png", ".svg", ".pdf"}:
        parser.error("use a .png, .svg, or .pdf destination")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker

    rows = read_rows(args.csv)
    series = learning_curves(rows, args.phase, args.metric, args.reference, args.arms, args.games, args.draws)
    games = sorted({game for game, _ in series})
    unit = rows[0].get("budget_unit", "episodes")
    treatments = sorted({arm for _, arm in series})
    colors = ["#006c79", "#b34925", "#674aa0", "#46742a", "#395590", "#a3476b", "#826316", "#555555"]
    symbols = ["o", "s", "^", "D", "v", "P", "X", "h"]
    fig, panels = plt.subplots(len(games), 1, figsize=(8.5, 3.15 * len(games) + 0.65), squeeze=False, layout="constrained")
    label = {"return": "Mean episode return", "steps": "Steps per episode", "completion": "Terminal fraction",
             "timeout": "Horizon fraction", "illegal": "Rejected-action fraction", "reward_per_step": "Reward per interaction"}[args.metric]
    for ax, game in zip(panels[:, 0], games):
        if args.reference:
            ax.axhline(0, color="#62696b", linewidth=0.85)
        for i, arm in enumerate(treatments):
            if (game, arm) not in series:
                continue
            points = series[game, arm]
            x, y, low, high = zip(*points)
            color = colors[i % len(colors)]
            ax.plot(x, y, label=arm, color=color, marker=symbols[i % len(symbols)], markersize=4, linewidth=1.6)
            if all(v != "" for v in low):
                ax.fill_between(x, low, high, color=color, alpha=0.12, linewidth=0)
        ax.set_title(game.replace("_", " ").replace("-", " "), loc="left", fontsize=12)
        ax.set_ylabel(label + (" difference" if args.reference else ""))
        if args.xscale == "symlog":
            positive = [p[0] for (g, _), curve in series.items() if g == game for p in curve if p[0] > 0]
            if positive:
                ax.set_xscale("symlog", linthresh=min(positive))
        ax.xaxis.set_major_formatter(ticker.StrMethodFormatter("{x:,.0f}"))
        ax.set_xlabel("Training " + ("interactions" if unit == "steps" else "episodes"))
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(axis="y", color="#dedede", linewidth=0.6)
        ax.set_axisbelow(True)
        ax.legend(frameon=False, ncol=min(4, len(treatments)), fontsize=8)
    phase = args.phase.capitalize()
    comparison = f" relative to {args.reference}" if args.reference else ""
    fig.suptitle(f"{phase} learning curves{comparison}", fontsize=14)
    fig.savefig(output, dpi=180)
    plt.close(fig)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, ImportError) as error:
        sys.exit(str(error))
