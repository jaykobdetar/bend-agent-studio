"""P11.0 fixed benchmark suite; build fresh runs serially and verify their bytes."""
import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
from machine import machine

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FAMILIES = ["flagship-baseline", "flagship-one-step", "flagship-double", "flagship-planning",
            "flagship-multi-step"]
CASES = [("flagship", "train", FAMILIES), ("storm-24x8", "train", ["storm"]),
         ("kart-transfer", "train", ["kart"]), ("cartpole-network", "train", ["cartpole"]),
         ("acrobot", "train", ["acrobot"]), ("oracle-taxi", "oracle",
          ["worlds/benchmarks/toy-text/taxi.json", "200"]),
         ("oracle-storm-12x4", "oracle", ["worlds/challenges/storm-reserve/reserve-12x4.json", "12"]),
         ("analysis-flagship", "analysis", [])]
CSV = "studies/flagship-toy-text-v2/checkpoints.csv"
ANCHORS = "studies/flagship-toy-text-v2/anchors.json"
ANALYZE = [["--phase", "validation", "--reference", "q_learning"],
           ["--phase", "validation", "--aggregate", "iqm", "--anchors", ANCHORS],
           ["--phase", "validation", "--reference", "q_learning", "--aggregate",
            "probability-of-improvement"]]


def dump(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def run(args, options=None):
    env = os.environ.copy()
    env["BEND_NO_TELEMETRY"] = "1"
    return subprocess.run(args, cwd=REPO, env=env, text=True, check=True, **(options or {}))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def archive(run_dir):
    # Verifying and reading the complete archive is outside the timed command.
    v = json.loads(run(["node", "experiment.mjs", "verify", str(run_dir)],
                       {"stdout": subprocess.PIPE}).stdout)
    assert v["completeTrials"] == v["totalTrials"]
    assert v["savedCheckpoints"] == v["totalCheckpoints"]
    item = json.loads((run_dir / "run.json").read_text())
    plan = item["body"]["plan"]
    paired = []
    train_ep = train_steps = val_ep = val_steps = test_ep = test_steps = 0
    for file in sorted((run_dir / "trials").rglob("*.json")):
        blob = file.read_bytes()
        row = json.loads(blob)["body"]
        paired.append((file.relative_to(run_dir).as_posix(), digest(blob)))
        if row["episodes"] == plan["checkpoints"][-1]:
            train_ep += row["train"]["episodes"]
            train_steps += row["train"]["steps"] + (row.get("partial") or {}).get("steps", 0)
        val_ep += row["validation"]["episodes"]
        val_steps += row["validation"]["steps"]
        if row["test"]:
            test_ep += row["test"]["episodes"]
            test_steps += row["test"]["steps"]
    return {"identity": {"manifest": item["hash"], "backend": item["body"]["toolchain"]["backend"],
                         "checkpoints": digest(json.dumps(paired).encode())},
            "trials": v["totalTrials"], "checkpoints": v["totalCheckpoints"],
            "trainEpisodes": train_ep, "trainSteps": train_steps,
            "validationEpisodes": val_ep, "validationSteps": val_steps,
            "testEpisodes": test_ep, "testSteps": test_steps}


def guarded(a, directory, label, command, seconds):
    directory.mkdir(parents=True, exist_ok=True)
    out = directory / (label + ".out")
    err = directory / (label + ".err")
    metric = directory / (label + ".json")
    run([sys.executable, str(HERE / "guard.py"), "--cpu", str(a.cpu),
         "--seconds", str(seconds), "--mib", str(a.max_mib),
         "--min-available-mib", str(a.min_available_mib),
         "--stdout", str(out), "--stderr", str(err), "--metric", str(metric), "--", *command])
    return json.loads(metric.read_text()), out


def case(a, kind, args, inputs, directory, data_rows):
    out = {"commands": [], "counts": {}}
    values = []
    if kind == "train":
        tasks = [(n, ["node", "experiment.mjs", "run", str(inputs / (n + ".json")),
                      str(directory / (n + "-archive"))]) for n in args]
        cap = 600
    elif kind == "oracle":
        tasks = [("solve", ["node", "experiment.mjs", "oracle", *args])]
        cap = 120
    else:
        tasks = [(f"statistics-{i + 1}", [sys.executable, "analysis/analyze.py", CSV,
                  *cmd, "--draws", "2000"]) for i, cmd in enumerate(ANALYZE)]
        cap = 180
    for label, cmd in tasks:
        m, stdout = guarded(a, directory, label, cmd, cap)
        out["commands"].append({"component": label, **m})
        if m["capReason"]:
            return {"status": "censored", **out}
        if m["returncode"] != 0:
            return {"status": "failed", **out}
        if kind == "train":
            values.append(archive(directory / (label + "-archive")))
        else:
            values.append({"identity": digest(stdout.read_bytes())})
            if kind == "oracle":
                o = json.loads(stdout.read_text())
                out["counts"]["modeledStates"] = o["states"]
                out["counts"]["solves"] = 1
    if kind == "train":
        for row in values:
            for name, count in row.items():
                if name != "identity":
                    out["counts"][name] = out["counts"].get(name, 0) + count
    if kind == "analysis":
        out["counts"] = {"csvRows": data_rows, "fullCsvPasses": len(tasks), "rowPasses": data_rows * len(tasks)}
    return {"status": "complete", "identities": [v["identity"] for v in values], **out}


def summary(samples):
    if len(samples) < 5 or any(x["status"] != "complete" for x in samples):
        return {"status": "insufficient complete replicates", "attempts": len(samples)}
    totals = []
    for samp in samples:
        c = samp["commands"]
        w = sum(x["wallSeconds"] for x in c)
        co = {"wallSeconds": w, "processCpuSeconds": sum(x["processCpuSeconds"] for x in c),
              "maxIndividualRssKiB": max(x["maxIndividualRssKiB"] for x in c)}
        pss = [x["sampledGroupPssKiB"] for x in c if x["sampledGroupPssKiB"] is not None]
        co["peakGroupPssKiB"] = max(pss) if pss else None
        for n in ["trainEpisodes", "trainSteps", "solves", "modeledStates", "rowPasses"]:
            if n in samp["counts"]:
                co[n + "PerSecond"] = samp["counts"][n] / w
        totals.append(co)
    columns = {k: [r[k] for r in totals if r[k] is not None] for k in totals[0]}

    def fold(f):
        return {k: f(v) if len(v) == len(totals) else None for k, v in columns.items()}

    return {"status": "complete", "attempts": len(samples), "counts": samples[0]["counts"],
            "median": fold(statistics.median), "min": fold(min), "max": fold(max)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("output", type=Path)
    p.add_argument("--cpu", type=int, default=6)
    p.add_argument("--repeats", type=int, default=5)
    p.add_argument("--max-mib", type=int, default=4096)
    p.add_argument("--min-available-mib", type=int, default=5120)
    p.add_argument("--gpu-report", type=Path)
    p.add_argument("--wait-for-lock", action="store_true")
    a = p.parse_args()
    assert a.repeats >= 5 and a.cpu in os.sched_getaffinity(0)
    assert 0 < a.max_mib <= 6144 and a.min_available_mib >= 4096
    out = a.output.resolve()
    lock = Path("/tmp") / ("bend-perf-" + str(os.getuid()) + ".lock")
    # All stock work is one serial suite. This coordinates bench.py sessions,
    # not other software the owner may be running.
    handle = os.fdopen(os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "r+")
    with handle:
        fcntl.flock(handle, fcntl.LOCK_EX | (0 if a.wait_for_lock else fcntl.LOCK_NB))
        out.mkdir(parents=True)
        profile = machine(a.gpu_report.read_text() if a.gpu_report else None)
        dump(out / "machine.json", profile)
        run(["node", str(HERE / "prepare.mjs"), str(out / "inputs")])
        evidence = (out / "inputs" / "input-hashes.json").read_bytes()
        assert evidence == (HERE / "input-hashes.json").read_bytes(), "benchmark inputs have drifted"
        with (REPO / CSV).open() as f:
            data_rows = sum(1 for _ in csv.reader(f)) - 1
        samples = {name: [] for name, _, _ in CASES}
        revision = run(["git", "rev-parse", "HEAD", "HEAD^{tree}"],
                       {"stdout": subprocess.PIPE}).stdout.splitlines()
        dirty = bool(run(["git", "status", "--porcelain"], {"stdout": subprocess.PIPE}).stdout)
        def save():
            dump(out / "results.json", {"machine": profile,
                                        "inputSha256": digest(evidence),
                                        "engineSource": {"commit": revision[0], "tree": revision[1],
                                                         "worktreeModified": dirty},
                                        "limits": {"cpu": a.cpu, "nice": 10, "groupPssMiB": a.max_mib,
                                                   "hostAvailableFloorMiB": a.min_available_mib,
                                                   "requestedRepetitions": a.repeats},
                                        "cases": {id: {"samples": s, "summary": summary(s)}
                                                  for id, s in samples.items()}})
        save()
        for i in range(a.repeats):
            # Rotate only between cases; their component order remains fixed.
            ordering = CASES[i:] + CASES[:i] if i < len(CASES) else CASES
            for name, kind, args in ordering:
                old = samples[name]
                if old and old[-1]["status"] != "complete":
                    continue
                print(f"round {i + 1}: {name}", flush=True)
                r = case(a, kind, args, out / "inputs", out / f"round-{i + 1}" / name, data_rows)
                if old and r["status"] == "complete":
                    assert r["identities"] == old[0]["identities"], name + " byte identities differ"
                    assert r["counts"] == old[0]["counts"], name + " workload counts differ"
                old.append(r)
                save()
                print(f"{name}: {r['status']}", flush=True)


if __name__ == "__main__":
    main()
