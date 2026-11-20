"""Measure one child process and its descendants. Do not touch host settings."""
import argparse
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import threading
import time


def numbers(path, keys, colon=False):
    found = {}
    for line in Path(path).read_text().splitlines():
        if colon:
            key, _, value = line.partition(":")
        else:
            key, value = line.split()
        if key in keys:
            found[key] = int(value.split()[0])
    assert set(found) == set(keys)
    return found


def process_group_memory(group):
    pss = swap = 0
    for d in Path("/proc").iterdir():
        if not d.name.isdecimal():
            continue
        try:
            state = (d / "stat").read_text().rpartition(") ")[2].split()
            if int(state[2]) != group:
                continue
            v = numbers(d / "smaps_rollup", {"Pss", "SwapPss"}, colon=True)
            pss += v["Pss"]
            swap += v["SwapPss"]
        except (OSError, AssertionError, IndexError, ValueError):
            continue  # short-lived child, or process no longer readable
    return pss, swap


def stop_group(group):
    try:
        os.killpg(group, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(0.25)
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpu", required=True, type=int)
    parser.add_argument("--seconds", required=True, type=float)
    parser.add_argument("--mib", required=True, type=int)
    parser.add_argument("--min-available-mib", required=True, type=int)
    parser.add_argument("--stdout", required=True, type=Path)
    parser.add_argument("--stderr", required=True, type=Path)
    parser.add_argument("--metric", required=True, type=Path)
    parser.add_argument("--stop-file", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    opts = parser.parse_args()
    assert opts.command[0] == "--"
    assert opts.cpu in os.sched_getaffinity(0)
    assert 0 < opts.mib <= 6144 and opts.min_available_mib >= 4096
    output = opts.stdout.parent
    marker_root = opts.stdout.parents[2]
    stop_files = [opts.stop_file or marker_root / "STOP"]
    if not opts.stop_file and marker_root.name == "profiles":
        stop_files.append(marker_root.parent / "STOP")

    def stopped():
        return any(f.is_file() for f in stop_files)

    # Exit before opening another command when the suite was explicitly stopped.
    if stopped():
        raise SystemExit("benchmark STOP marker present")
    page_kib = os.sysconf("SC_PAGESIZE") // 1024
    start_swaps = numbers("/proc/vmstat", {"pswpin", "pswpout"})
    peak = swaps = samples = 0
    min_available = numbers("/proc/meminfo", {"MemAvailable"}, True)["MemAvailable"]
    reason = None
    completed = None
    t = time.monotonic()
    if min_available < opts.min_available_mib * 1024:
        reason = "insufficient host MemAvailable before launch"
    elif shutil.disk_usage(output).free < 24 * 2**30:
        reason = "insufficient disk headroom before launch"
    else:
        with opts.stdout.open("xb") as stdout, opts.stderr.open("xb") as stderr:
            t = time.monotonic()
            p = subprocess.Popen(["nice", "-n", "10", "taskset", "-c", str(opts.cpu),
                                  *opts.command[1:]], stdout=stdout, stderr=stderr, start_new_session=True)

            finished = threading.Event()
            end_time = []

            def reap():
                p.wait()
                end_time.append(time.monotonic())
                finished.set()

            waiter = threading.Thread(target=reap, daemon=True)
            waiter.start()

            def interrupted(sig, _frame):
                stop_group(p.pid)
                raise SystemExit(128 + sig)

            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                signal.signal(signum, interrupted)
            try:
                while not finished.is_set():
                    measured, group_swap = process_group_memory(p.pid)
                    samples += 1
                    peak = max(peak, measured)
                    swaps = max(swaps, group_swap)
                    min_available = min(min_available, numbers("/proc/meminfo", {"MemAvailable"}, True)["MemAvailable"])
                    io = numbers("/proc/vmstat", {"pswpout"})
                    if stopped():
                        reason = "benchmark STOP marker"
                    elif measured > opts.mib * 1024:
                        reason = "sampled process-group PSS cap"
                    elif min_available < opts.min_available_mib * 1024:
                        reason = "host MemAvailable floor"
                    elif group_swap >= 1024:
                        reason = "process group reached 1 MiB sampled swap"
                    elif (io["pswpout"] - start_swaps["pswpout"]) * page_kib >= 8192:
                        reason = "host swapped out at least 8 MiB in this command"
                    elif shutil.disk_usage(output).free < 24 * 2**30:
                        reason = "disk headroom floor"
                    elif time.monotonic() - t > opts.seconds:
                        reason = "elapsed cap"
                    if reason:
                        stop_group(p.pid)
                        break
                    finished.wait(0.035)
                waiter.join()
                completed = p.returncode
            finally:
                stop_group(p.pid)
    elapsed = (end_time[0] if completed is not None else time.monotonic()) - t
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    ends = numbers("/proc/vmstat", {"pswpin", "pswpout"})
    report = {"wallSeconds": elapsed, "processCpuSeconds": usage.ru_utime + usage.ru_stime,
              "maxIndividualRssKiB": usage.ru_maxrss, "sampledGroupPssKiB": peak if samples else None,
              "samples": samples, "sampledGroupSwapPssKiB": swaps, "minHostAvailableKiB": min_available,
              "hostSwapInKiB": (ends["pswpin"] - start_swaps["pswpin"]) * page_kib,
              "hostSwapOutKiB": (ends["pswpout"] - start_swaps["pswpout"]) * page_kib,
              "returncode": completed, "capReason": reason}
    opts.metric.write_text(json.dumps(report) + "\n")
