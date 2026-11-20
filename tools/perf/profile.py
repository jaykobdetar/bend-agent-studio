"""One separate profiling pass per workload; never use these timings as medians."""
import argparse
from collections import Counter
import csv
import fcntl
import json
import os
from pathlib import Path
import pstats
import re
import shutil
import sys
from bench import ANALYZE, CASES, CSV, HERE, REPO, archive, digest, dump, guarded


def profile_stacks(file, generated):
    p = json.loads(file.read_text())
    nodes = {n["id"]: n["callFrame"] for n in p["nodes"]}
    parents = {i: n["id"] for n in p["nodes"] for i in n.get("children", [])}
    counts = Counter()
    cached = {}
    generated_lines = generated.read_text().splitlines() if generated and generated.is_file() else []
    seal = {"seal", "immutable", "existing"}
    for sample, delta in zip(p["samples"], p["timeDeltas"], strict=True):
        if sample not in cached:
            frames = []
            pos = sample
            while pos:
                frames.append(nodes[pos])
                pos = parents.get(pos)
            leaf = frames[0]
            name = leaf["functionName"]
            names = {fr["functionName"] for fr in frames}
            url = leaf["url"]
            location = leaf["lineNumber"]
            compiled = url.endswith(("/study.mjs", "/backend.mjs"))
            source_line = generated_lines[location] if compiled and 0 <= location < len(generated_lines) else ""
            if name == "(idle)":
                category = "idle"
            elif name == "(garbage collector)":
                category = "V8 GC"
            elif "testModel" in names:
                category = "evaluation"
            elif seal & names:
                category = "checkpoint sealing/input/output"
            elif compiled and (name == "run_lib" or re.search(r"return \(\.\.\.a\) =>", source_line)
                               or re.search(r"run_lib\(\(a0", source_line)):
                category = "visible JS-to-Bend adapter"
            elif compiled:
                category = "Bend-compiled training/initialization"
            elif "oracle" in names or (file.parent.name == "solve" and url.endswith("/finite_world.mjs")):
                category = "JavaScript exact oracle"
            else:
                category = "other Node/setup/unattributed"
            cached[sample] = category
        counts[cached[sample]] += delta
    active = sum(counts.values()) - counts["idle"]
    return {"samples": len(p["samples"]), "intervalMicroseconds": 1000,
            "sampleSeconds": {k: v / 1e6 for k, v in sorted(counts.items())},
            "activeSampleFraction": {k: v / active for k, v in sorted(counts.items()) if k != "idle"}}


def perf_metrics(file):
    if not file.exists():
        return None
    values = {}
    for row in csv.reader(file.read_text().splitlines()):
        if len(row) >= 3 and row[2] in {"task-clock", "cycles", "instructions"}:
            values[row[2]] = {"value": float(row[0]), "unit": row[1]} if row[0].strip().replace(".", "", 1).isdigit() else None
    return values


def python_stats(file):
    stats = pstats.Stats(file.as_posix())
    rows = sorted(stats.stats.items(), key=lambda row: row[1][2], reverse=True)[:10]
    return [{"file": Path(f).name, "line": line, "function": name,
             "selfSeconds": row[2], "inclusiveSeconds": row[3], "calls": row[1]}
            for (f, line, name), row in rows]


def bridge_calls(run_dir):
    plan = json.loads((run_dir / "run.json").read_text())["body"]["plan"]
    mode = plan["budgetUnit"]
    calls = Counter(initializations=0, trainEpisodes=0, trainBegins=0, trainSegments=0,
                    validationEpisodes=0, testEpisodes=0)
    part = 0
    for f in (run_dir / "trials").rglob("*.json"):
        b = json.loads(f.read_text())["body"]
        calls["validationEpisodes"] += b["validation"]["episodes"]
        if b["test"]:
            calls["testEpisodes"] += b["test"]["episodes"]
        if b["episodes"] == plan["checkpoints"][-1]:
            calls["initializations"] += 1
            if mode == "episodes":
                calls["trainEpisodes"] += b["train"]["episodes"]
            else:
                calls["trainBegins"] += b["started"]
                calls["trainSegments"] += b["train"]["episodes"]
        if mode == "steps" and b["partial"]:
            part += 1
    if mode == "steps":
        calls["trainSegments"] += part
    return calls


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("baseline", type=Path, help="completed bench.py output")
    p.add_argument("--cpu", type=int, default=6)
    p.add_argument("--max-mib", type=int, default=4096)
    p.add_argument("--min-available-mib", type=int, default=5120)
    a = p.parse_args()
    baseline = a.baseline.resolve()
    evidence = baseline / "profiles"
    lockfile = Path("/tmp") / ("bend-perf-" + str(os.getuid()) + ".lock")
    with os.fdopen(os.open(lockfile, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads((baseline / "results.json").read_text())
        assert data["limits"]["cpu"] == a.cpu and data["limits"]["groupPssMiB"] == a.max_mib
        assert data["limits"]["hostAvailableFloorMiB"] == a.min_available_mib
        evidence.mkdir()
        result = {"machine": data["machine"], "inputSha256": data["inputSha256"],
                  "instrumentedSinglePass": True, "cases": {}}
        inputs = baseline / "inputs"
        real_bend = str(Path(shutil.which("bend")).resolve())
        os.environ["BEND_PERF_COMPILER"] = real_bend
        for name, kind, args in CASES:
            prior = data["cases"][name]
            if prior["summary"]["status"] != "complete":
                result["cases"][name] = {"status": "not profiled after incomplete baseline"}
                continue
            entries = result["cases"][name] = []
            source_identities = prior["samples"][0]["identities"]
            if kind == "train":
                components = args
            elif kind == "oracle":
                components = ["solve"]
            else:
                components = ["statistics-" + str(i + 1) for i in range(len(ANALYZE))]
            for i, component in enumerate(components):
                d = evidence / name / component
                d.mkdir(parents=True)
                cp = d / "node.cpuprofile"
                stats = d / "analysis.prof"
                perf = d / "perf.csv"
                prefix = ["node", "--cpu-prof", "--cpu-prof-interval=1000",
                          "--cpu-prof-name=" + cp.name, "--cpu-prof-dir=" + str(d)]
                archive_dir = d / "archive"
                compile_times = d / "compiler.txt"
                os.environ["BEND_PERF_COMPILER_TIMES"] = str(compile_times)
                if kind == "train":
                    cmd = [*prefix, "experiment.mjs", "run", str(inputs / (component + ".json")),
                           str(archive_dir), "--bend", str(HERE / "measure-compiler.sh")]
                elif kind == "oracle":
                    cmd = [*prefix, "experiment.mjs", "oracle", *args]
                else:
                    cmd = [sys.executable, "-m", "cProfile", "-o", str(stats), "analysis/analyze.py",
                           CSV, *ANALYZE[i], "--draws", "2000"]
                if data["machine"]["perf"]["counters"] == "available":
                    cmd = ["perf", "stat", "--no-big-num", "-x", ",", "-e", "task-clock,cycles,instructions",
                           "-o", str(perf), "--", *cmd]
                print("profile:", name, component, flush=True)
                m, stdout = guarded(a, d, "profile", cmd, 600 if kind == "train" else 180)
                entry = {"component": component, "duration": m, "perf": perf_metrics(perf)}
                entries.append(entry)
                if not m["capReason"] and m["returncode"] == 0:
                    got = archive(archive_dir)["identity"] if kind == "train" else digest(stdout.read_bytes())
                    assert got == source_identities[i], f"{name}: profiling changed study/output bytes"
                    entry["outputMatchesBaseline"] = True
                    if kind == "train":
                        entry["bridgeCalls"] = bridge_calls(archive_dir)
                    if cp.exists():
                        entry["v8"] = profile_stacks(cp, archive_dir / "code/backend.mjs" if kind == "train" else None)
                    if stats.exists():
                        entry["python"] = python_stats(stats)
                    if compile_times.exists():
                        by_kind = {}
                        for line in compile_times.read_text().splitlines():
                            phase, user, syscpu, wall, rss = line.split()
                            mode = by_kind.setdefault(phase, {"calls": 0, "cpuSeconds": 0,
                                                               "wallSeconds": 0, "peakRssKiB": 0})
                            mode["calls"] += 1
                            mode["cpuSeconds"] += float(user) + float(syscpu)
                            mode["wallSeconds"] += float(wall)
                            mode["peakRssKiB"] = max(mode["peakRssKiB"], int(rss))
                        entry["compiler"] = by_kind
                dump(evidence / "summary.json", result)


if __name__ == "__main__":
    main()
