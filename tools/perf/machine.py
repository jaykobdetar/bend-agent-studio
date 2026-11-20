"""Record deliberately allowlisted, non-identifying Linux benchmark facts."""
import argparse
import csv
import json
from pathlib import Path
import shutil
import subprocess
import sys


def run(args):
    if not shutil.which(args[0]):
        return None
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def version(command):
    out = run(command)
    return out.splitlines()[0] if out else None


def machine(gpu_report=None):
    wanted = {
        "Architecture", "CPU(s)", "Model name", "Thread(s) per core", "Core(s) per socket",
        "Socket(s)", "L1d cache", "L1i cache", "L2 cache", "L3 cache", "Flags",
    }
    raw = json.loads(run(["lscpu", "--json"]) or "{}")
    cpu = {p["field"].rstrip(":"): p["data"] for p in raw.get("lscpu", [])
           if p["field"].rstrip(":") in wanted}
    if "Flags" in cpu:
        cpu["Flags"] = sorted(cpu["Flags"].split())
    mem = {k: int(v.split()[0]) for line in Path("/proc/meminfo").read_text().splitlines()
           if (k := line.partition(":")[0]) in {"MemTotal", "SwapTotal"}
           for v in [line.partition(":")[2]]}
    query = ["nvidia-smi", "--query-gpu=name,memory.total,driver_version,compute_cap",
             "--format=csv,noheader,nounits"]
    text = gpu_report or run(query)
    devices = []
    if text:
        for row in csv.reader(text.splitlines()):
            assert len(row) == 4
            name, mib, driver, capability = (x.strip() for x in row)
            assert name.startswith("NVIDIA ") and name.isascii()
            assert all(c in "0123456789." for c in driver + capability)
            devices.append({"name": name, "vramMiB": int(mib), "driver": driver,
                            "computeCapability": capability})
    cuda = run(["nvcc", "--version"]) or ""
    cuda_version = next((x for x in cuda.splitlines() if x.startswith("Cuda compilation tools, release ")), None)
    distro = next((x.split("=", 1)[1].strip('"') for x in Path("/etc/os-release").read_text().splitlines()
                   if x.startswith("PRETTY_NAME=")), None)
    paranoid = int(Path("/proc/sys/kernel/perf_event_paranoid").read_text())
    perf = shutil.which("perf")
    # Output intentionally discarded. The tool may print path names on failure.
    if not perf:
        counters = "not installed"
    else:
        try:
            probe = subprocess.run(["perf", "stat", "-e", "task-clock,cycles,instructions", "--", "true"],
                                   capture_output=True, timeout=10, check=False)
            counters = "available" if probe.returncode == 0 else "unavailable in this session"
        except (OSError, subprocess.TimeoutExpired):
            counters = "unavailable in this session"
    return {"cpu": cpu, "memoryKiB": mem, "gpu": devices,
            "gpuQuery": "nvidia-smi device fields only" if devices else "unavailable in this session",
            "os": distro, "kernelRelease": version(["uname", "-r"]),
            "versions": {"node": version(["node", "--version"]), "bend": version(["bend", "version"]),
                         "python": sys.version.split()[0], "gcc": version(["gcc", "--version"]),
                         "clang": version(["clang", "--version"]), "nvcc": cuda_version},
            "perf": {"counters": counters, "kernelPerfEventParanoid": paranoid}}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--gpu-report", type=Path, help="override only the four allowlisted nvidia-smi CSV fields")
    a = p.parse_args()
    print(json.dumps(machine(a.gpu_report.read_text() if a.gpu_report else None), indent=2))
