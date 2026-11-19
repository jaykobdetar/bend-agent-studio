"""Copy a verified Bend run to a new, local MLflow file tracking store."""
import argparse
from collections import defaultdict
import csv
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "analysis"))
from analyze import measure

PHASES = ("train", "validation", "test")
METRICS = ("return", "steps", "completion", "timeout", "illegal", "reward_per_step")


def checked_data(run, node):
    result = subprocess.run([node, str(HERE / "snapshot.mjs"), str(run)],
                            check=True, capture_output=True, text=True, encoding="utf-8")
    header, _, contents = result.stdout.partition("\n")
    sealed = json.loads(header)
    plan = sealed["body"]["plan"]
    curves = defaultdict(list)
    for row in csv.DictReader(contents.splitlines()):
        key = row["game"], row["arm"], int(row["replicate"])
        step = int(row["budget"])
        for phase in PHASES:
            count = int(row[f"{phase}_episodes"] or 0)
            for metric in METRICS:
                if not count and not (phase == "train" and metric == "reward_per_step"
                                      and int(row["partial_steps"])):
                    continue
                if metric == "reward_per_step" and not (int(row[f"{phase}_steps"])
                                                        or phase == "train" and int(row["partial_steps"])):
                    continue
                value = measure(row, phase, metric)
                if not math.isfinite(value):
                    raise ValueError(f"non-finite metric: {key} {phase} {metric} at {step}")
                curves[key].append((f"{phase}.{metric}", value, step))
        curves[key]  # Retain trials even when no metrics are defined.
    expected = {(game["id"], arm["id"], rep) for game in plan["games"]
                for arm in plan["arms"] for rep in range(plan["replicates"])}
    if curves.keys() != expected:
        raise ValueError("export does not match the sealed trial inventory")
    return sealed, curves


def flat_params(mapping, prefix, excluded=()):
    params = {}
    for key, value in mapping.items():
        if key in excluded:
            continue
        if isinstance(value, dict):
            params.update(flat_params(value, f"{prefix}.{key}"))
        else:
            params[f"{prefix}.{key}"] = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
    return params


def export_run(run, destination, node="node"):
    if os.path.lexists(destination):
        raise ValueError("tracking destination already exists; choose a new directory")
    sealed, curves = checked_data(run, node)
    metadata = sealed["body"]
    plan = metadata["plan"]
    toolchain = metadata["toolchain"]
    common = flat_params(plan, "plan", ("games", "arms"))
    arms = {arm["id"]: flat_params(arm, "arm") for arm in plan["arms"]}
    # World definitions are already covered by the sealed run hash; avoid copying model inputs.
    games = {game["id"]: flat_params(game, "game", ("definition",)) for game in plan["games"]}
    tags = {"bend.run_hash": sealed["hash"], "bend.backend_hash": toolchain["backend"],
            "bend.version": toolchain["bend"]}

    os.environ["MLFLOW_DISABLE_TELEMETRY"] = "true"
    from mlflow.entities import Metric, Param
    from mlflow.tracking import MlflowClient

    destination.mkdir(exist_ok=False)
    incomplete = destination / ".bend-export-incomplete"
    incomplete.touch(exist_ok=False)
    client = MlflowClient(tracking_uri=destination.resolve().as_uri())
    experiment = client.create_experiment(plan["name"])
    timestamp = time.time_ns() // 1_000_000
    for (game, arm, replicate), points in sorted(curves.items()):
        params = {**common, **games[game], **arms[arm], "replicate": str(replicate)}
        item = client.create_run(experiment, tags={**tags, "bend.game": game, "bend.arm": arm,
                                                 "bend.replicate": str(replicate)},
                                 run_name=f"{game}/{arm}/{replicate}")
        run_id = item.info.run_id
        param_entities = [Param(k, v) for k, v in sorted(params.items())]
        for start in range(0, len(param_entities), 100):
            client.log_batch(run_id, params=param_entities[start:start + 100], synchronous=True)
        for start in range(0, len(points), 1000):
            metrics = [Metric(key, value, timestamp, step) for key, value, step in points[start:start + 1000]]
            client.log_batch(run_id, metrics=metrics, synchronous=True)
        client.set_terminated(run_id)
    incomplete.unlink()
    return {"runs": len(curves), "run_hash": sealed["hash"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="a trusted, complete Bend archive")
    parser.add_argument("destination", type=Path, help="a NEW local tracking directory")
    parser.add_argument("--node", default="node", help="Node executable (use the runtime for the archive)")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(export_run(args.run.resolve(), args.destination.absolute(), args.node)))
    except subprocess.CalledProcessError as exc:
        parser.exit(2, f"Bend archive validation/export failed: {exc.stderr.strip()}\n")
    except (OSError, ValueError, KeyError, ImportError) as exc:
        parser.exit(2, f"MLflow export failed: {exc}\n")


if __name__ == "__main__":
    main()
