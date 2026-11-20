"""Check raw F32 bit transport, compare targets, and require actual CUDA kernel evidence."""
import argparse
import json
from pathlib import Path
import re
import sqlite3

base = Path(__file__).resolve().parent
ops = ["transport_x", "transport_y", "sin", "cos", "tanh", "log", "exp",
       "sqrt", "add", "sub", "mul", "div", "mul_sub_one"]
cases = [line.split() for line in (base / "cases.tsv").read_text().splitlines()
         if line.strip() and not line.startswith("#")]
word = r"[0-9a-fA-F]{8}"

def is_nan(x):
    return (x & 0x7fffffff) > 0x7f800000

def rank(x):
    return (~x & 0xffffffff) if x >> 31 else (x ^ 0x80000000)

def diff(observed, ref, transport):
    if ref == "nan":
        if not is_nan(observed):
            return "not_nan", None
        return ("quiet_nan", None) if observed & 0x400000 else ("signaling_nan", None)
    if observed == ref:
        return "exact", 0
    if transport:
        return "transport_changed", None
    if is_nan(observed) or is_nan(ref) or (ref & 0x7fffffff) == 0x7f800000 or (observed & 0x7fffffff) == 0x7f800000:
        return "different_special", None
    if ((observed | ref) & 0x7fffffff) == 0:
        return "different_zero_sign", None
    return "different", abs(rank(observed) - rank(ref))

def load(path, reference=False):
    data = {}
    for line in path.read_text().splitlines():
        if not line.startswith("R " if reference else "S "):
            continue
        f = line.split()
        n = len(ops)
        if reference:
            assert len(f) == 3 + n
            lhs, rhs = f[3:], None
        else:
            assert len(f) == 5 + 2 * n and f[3] == "H" and f[4+n] == "P"
            lhs, rhs = f[4:4+n], f[5+n:]
        def words(xs):
            assert all(re.fullmatch(word, x) or (reference and x == "nan") for x in xs)
            return [x if x == "nan" else int(x, 16) for x in xs]
        key = tuple(int(x, 16) for x in f[1:3])
        assert key not in data
        data[key] = (words(lhs), None if rhs is None else words(rhs))
    assert list(data) == [(int(a, 16), int(b, 16)) for a,b,_ in cases], f"missing/extra/reordered output in {path.name}"
    return data

def trace(path):
    if not path.is_file():
        return None
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as cx:
        names = {row[0] for row in cx.execute("select name from sqlite_master")}
        for table in ("CUPTI_ACTIVITY_KIND_KERNEL", "CUPTI_ACTIVITY_KIND_CONCURRENT_KERNEL"):
            if table not in names:
                continue
            cols = {row[1] for row in cx.execute(f'pragma table_info("{table}")')}
            for col in ("shortName", "demangledName", "mangledName", "name"):
                if col not in cols:
                    continue
                if "StringIds" in names:
                    n = cx.execute(f"""select count(*) from "{table}" k
                                    join StringIds s on s.id = k."{col}"
                                    where k.end > k.start and s.value like '%bend_dev%'""").fetchone()[0]
                else:
                    n = 0
                if not n:
                    n = cx.execute(f"""select count(*) from "{table}" k
                                    where k.end > k.start and k."{col}" like '%bend_dev%'""").fetchone()[0]
                if n:
                    return {"evidence": "Nsight CUDA device activity", "kernel": "bend_dev",
                            "positiveDurationKernelEvents": n}
    return None

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", nargs="?", type=Path)
    p.add_argument("--words", action="store_true")
    p.add_argument("--require-gpu", action="store_true")
    p.add_argument("--negative-trace", type=Path, help="verify an imported Nsight control trace has no bend_dev")
    p.add_argument("--compact", action="store_true", help="print the raw comparison matrix and control counts")
    opt = p.parse_args()
    if opt.words:
        for a,b,_ in cases:
            print(int(a, 16))
            print(int(b, 16))
        return
    root = opt.directory.resolve()
    js, cpu = load(root/"js.txt"), load(root/"native.txt")
    mpfr = load(root/"mpfr.txt", reference=True) if (root/"mpfr.txt").is_file() else None
    gpu_trace = trace(root/"gpu-trace.sqlite") if opt.require_gpu else None
    if opt.require_gpu and not gpu_trace:
        raise SystemExit("No GPU claim: did not verify CUDA device kernel activity in this executable")
    gpu = load(root/"gpu.txt") if gpu_trace else None
    negative = None
    if opt.negative_trace:
        p = opt.negative_trace.resolve()
        if not p.is_file():
            raise SystemExit("Missing negative-control trace")
        with sqlite3.connect(p.as_uri() + "?mode=ro", uri=True) as cx:
            tables = {r[0] for r in cx.execute("select name from sqlite_master")}
        if not {"StringIds", "ENUM_CUPTI_SYNC_TYPE"} <= tables or trace(p):
            raise SystemExit("Negative control must be an Nsight export with no positive-duration bend_dev kernel")
        negative = {"positiveDurationBendDevEvents": 0}
    result = {"scope": "diagnostic sentinel only", "cuda": gpu_trace,
              "independentReference": "MPFR directed enclosure RNE" if mpfr else None,
              "negativeControl": negative, "cases": []}
    for ax,by,purpose in cases:
        key = (int(ax, 16),int(by, 16))
        methods = {"emittedJs": js[key][0], "emittedJsBang": js[key][1],
                   "nativeCpu": cpu[key][0], "nativeCpuBangDisabledGpu": cpu[key][1]}
        if js[key][0] != js[key][1] or cpu[key][0] != cpu[key][1]:
            raise SystemExit("Host bang control differs for " + purpose)
        if gpu:
            if gpu[key][0] != cpu[key][0]:
                raise SystemExit("CUDA process host control differs for " + purpose)
            methods.update(nativeGpuProcessHost=gpu[key][0], nativeCudaOffloaded=gpu[key][1])
        reference = mpfr[key][0] if mpfr else list(key) + [None] * (len(ops)-2)
        data = {}
        for i, (op, exp) in enumerate(zip(ops, reference, strict=True)):
            observed = {name: f"{values[i]:08x}" for name,values in methods.items()}
            states = {}
            if exp is not None:
                for name,values in methods.items():
                    tag, distance = diff(values[i], exp, i<2)
                    states[name] = {"relation": tag}
                    if distance is not None:
                        states[name]["ulp"] = distance
            data[op] = {"words": observed, "exactAllBackends": len(set(observed.values())) == 1}
            if exp is not None:
                data[op].update(reference=exp if exp == "nan" else f"{exp:08x}", differences=states)
        result["cases"].append({"input": [ax,by], "purpose": purpose, "ops": data})
    if opt.compact:
        targets = {"js": "emittedJs", "native": "nativeCpu"}
        if gpu:
            targets["cuda"] = "nativeCudaOffloaded"
        compact = {"fields": ops, "hostControlsMatched": True, "cuda": gpu_trace,
                   "negativeControl": negative, "rows": []}
        for case in result["cases"]:
            row = {"case": case["purpose"], "input": case["input"]}
            for target, category in targets.items():
                row[target] = [r["words"][category] for r in case["ops"].values()]
            if mpfr:
                row["mpfr"] = [r["reference"] for r in case["ops"].values()]
            compact["rows"].append(row)
        result = compact
    print(json.dumps(result, indent=2))
if __name__ == "__main__":
    main()
