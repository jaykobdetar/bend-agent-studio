"""Linux-only, opt-in paired compiler + runner RSS probe; no dependencies."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

MIB = 1024 ** 2
INTERVAL = 0.060
CAP = 1200


def host():
    with open("/proc/meminfo") as stream:
        info = {line.split(":")[0]: int(line.split()[1]) // 1024
                for line in stream if line.startswith(("MemAvailable:", "SwapFree:"))}
    return info["MemAvailable"], info["SwapFree"]


def group_rss(pgid):
    pages = 0
    for pid in Path("/proc").iterdir():
        if not pid.name.isdecimal():
            continue
        try:
            stat = (pid / "stat").read_text().rsplit(")", 1)[1].split()
            if int(stat[2]) == pgid:
                pages += int(stat[21])
        except (OSError, IndexError, ValueError):
            continue  # Processes can exit during the sample.
    return pages * os.sysconf("SC_PAGE_SIZE") // MIB


def group_signal(pgid, sig):
    try:
        os.killpg(pgid, sig)
    except ProcessLookupError:
        pass


def probe(root, command, log):
    ram, swap = host()
    if ram < 4608 or swap < 384:
        raise RuntimeError("insufficient free RAM/swap to start guarded probe")
    swap_floor = max(384, swap - 32)
    peak, stop = 0, "exited"
    started = time.monotonic()
    # Measured subject and its children are the only members of this new group.
    with log.open("xb") as stream:
        child = subprocess.Popen(command, cwd=root, env={**os.environ, "BEND_NO_TELEMETRY": "1"},
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while child.poll() is None:
                rss = group_rss(child.pid)
                peak = max(peak, rss)
                ram, swap = host()
                if rss >= CAP:
                    stop = "RSS guard"
                    break
                if ram < 4096 or swap < swap_floor:
                    stop = "host reserve"
                    break
                if time.monotonic() - started >= 90:
                    stop = "timeout"
                    break
                time.sleep(INTERVAL)
        finally:
            if child.poll() is None:
                group_signal(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    group_signal(child.pid, signal.SIGKILL)
                    child.wait()
    return dict(stop=stop, status=child.returncode, group_rss_mib=peak,
                seconds=round(time.monotonic()-started, 2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output-parent", type=Path, default=Path(tempfile.gettempdir()),
                        help="parent for a unique directory of plans, archives, logs and JSON")
    parser.add_argument("--rounds", type=int, choices=range(1, 11), default=3)
    args = parser.parse_args()
    baseline, candidate = args.baseline.resolve(), args.candidate.resolve()
    run = Path(tempfile.mkdtemp(prefix="bend-layout-", dir=args.output_parent)).resolve()
    print("Evidence:", run, flush=True)
    cpu = min(os.sched_getaffinity(0))
    for n in range(1, args.rounds+1):
        for world in ("taxi", "blackjack"):
            relative = Path("worlds/benchmarks/toy-text") / (world + ".json")
            if (candidate / relative).read_bytes() != (baseline / relative).read_bytes():
                raise ValueError(f"{world} worlds differ")
            spec = run / (world + ".json")
            spec.write_text(json.dumps(dict(schema=1, name="smoke-"+world,
                games=[dict(id="probe", file=str(candidate/relative), limit=8)],
                arms=[dict(id="q", method="q_learning")], replicates=1,
                checkpoints=[0, 3], validationEpisodes=4, testEpisodes=4,
                seeds=dict(train=73000000, validation=1600000000, test=2600000000, stride=10000))))
            for label, tree in (("baseline", baseline), ("candidate", candidate)):
                name = f"{label}-{world}-{n}"
                command = ["nice", "-n", "15", "taskset", "-c", str(cpu),
                           "node", "experiment.mjs", "run", str(spec), str(run/name)]
                result = dict(world=world, layout=label, round=n,
                              **probe(tree, command, run/(name+".log")))
                print(json.dumps(result), flush=True)
                with (run / "measurements.jsonl").open("a") as stream:
                    stream.write(json.dumps(result) + "\n")
                if result["stop"] in ("host reserve", "timeout"):
                    raise SystemExit("Stopped to preserve resources; partial evidence retained.")
                if result["stop"] == "exited" and result["status"] != 0:
                    raise SystemExit(f"{name} failed; examine its log.")


if __name__ == "__main__":
    main()
