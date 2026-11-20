# P11.8 bounded diagnostic: Dry Lake, Double Q

Five guarded rounds completed on the unchanged P11.0
`perf-flagship-double` cell. The result concerns a diagnostic **in-memory
checkpoint comparison**, not the stock and native archive lifecycles.
Do not reproduce timings without a separate exclusive host window.
Cliff/Dyna is not eligible: its 200-move horizon exceeds the witness
cap of 128. Do not lower that horizon, select a faster seed, or change the
eligible plan. P11.0 random Bandit is eligible but substantially smaller and
does not exercise a learner. Dry Lake has three replicates; the fourth worker
is idle. A distinct, already frozen six-replicate Slippery Detour workload
could later be a four-active-worker control, but is not a P11.0 cell and is
not timed by this protocol.

## Fixed work and benches

Trusted stock archive and output identities are in `workload.json`. Use the
same archived world, arm and seeds for both paths: 100-move upper limit,
Double Q alpha 0.25, F32 gamma 0.9, 16,384 exploration buckets; replicate
`r = 0,1,2` uses offset `10000*r` added to train 150500000,
validation 1905000000, and test 2945000000. Checkpoints are
0/8/16/32/64/128/256/512/1024. Run 1,024 train episodes total (per
replicate), validation episodes 0–7 **at every checkpoint**, and test
episodes 0–15 **once** with the final checkpoint model. Preserve actual
terminal vs limit and keep all per-episode report ordering. That is 27
checkpoint bodies; phase episode/accepted-step totals are locked. Train
counts sum final cumulative training, not all nine cumulative points.

## Recreate the reference and candidate

Use Node 24.22.3, Bend 2.0.40 and Clang 22.1.4 with matching standard C
headers. This run used the Linux Clang bundled with Lean 4.34.0. Set
`REFERENCE_CHECKOUT`, `NEW_P110_INPUTS`, `STOCK_DRY_LAKE_RUN` and
`VERIFIED_O3_DIRECTORY` to new absolute paths, and `LEAN_CLANG` to that
compiler executable. From a Bend Agent Studio checkout containing this
witness and the historical commits:

```sh
repo=$(git rev-parse --show-toplevel)
runner=62decf6cce87217a86005eb2a048a94d2062c88f
tooling=db478028c0ca6eabaf3b70450f71c886d536f2f6
probe="$repo/twin/scalar-q-spike/bench/stock-in-memory.mjs"
parity="$repo/twin/scalar-q-spike/parity.mjs"
lock="$repo/twin/scalar-q-spike/bench/workload.json"
git -C "$repo" worktree add --detach "$REFERENCE_CHECKOUT" "$runner"
git -C "$repo" archive "$tooling" tools/perf | tar -x -C "$REFERENCE_CHECKOUT"
node "$REFERENCE_CHECKOUT/tools/perf/prepare.mjs" "$NEW_P110_INPUTS"
test "$(jq -r '.prepared["flagship-double.json"]' "$NEW_P110_INPUTS/input-hashes.json")" = \
  "$(jq -r .preparedPlanLock "$lock")"
node "$REFERENCE_CHECKOUT/experiment.mjs" run \
  "$NEW_P110_INPUTS/flagship-double.json" "$STOCK_DRY_LAKE_RUN"
node "$REFERENCE_CHECKOUT/experiment.mjs" verify "$STOCK_DRY_LAKE_RUN"
node "$probe" --lock "$STOCK_DRY_LAKE_RUN"

mkdir "$VERIFIED_O3_DIRECTORY"
export C_INCLUDE_PATH="${LEAN_CLANG%/bin/clang}/include/clang"
node "$parity" generate "$STOCK_DRY_LAKE_RUN" "$VERIFIED_O3_DIRECTORY/dry-lake.c"
"$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march=x86-64-v3 \
  -ffp-contract=off -fno-fast-math -pthread "$VERIFIED_O3_DIRECTORY/dry-lake.c" \
  -lm -o "$VERIFIED_O3_DIRECTORY/dry-lake-x86-64-v3"
for workers in 1 2 4; do
  node "$parity" check "$STOCK_DRY_LAKE_RUN" \
    "$VERIFIED_O3_DIRECTORY/dry-lake-x86-64-v3" "$workers"
done
```

This creates one scratch **stock** archive as reference; the witness
never writes a native archive. For the second correctness target on
compatible Zen 3 hardware, use `-march=znver3` and a separately named
binary, not a replacement for the timed generic build.
`o3-gate.json` records the generated C, binary and wire identities.
Toolchain/library builds that do not reproduce the locked bytes are
outside this benchmark gate.

## Separate measured intervals

1. **Cold builds**, report both fresh-output compiler-only and separately
   the whole cold preparation path. Stock compiler-only: stage exact
   archived `code/` locally outside the timer, run `bend study.bend -o
   NEW_BACKEND.mjs` and require the locked backend SHA. Native compiler-only:
   generate and lock C outside the timer then compile new files with Lean
   Clang 22.1.4 `-std=c11 -O3 -Wall -Wextra -Werror -march=x86-64-v3
   -ffp-contract=off -fno-fast-math -pthread ... -lm`. Record a second
   cold preparation interval from input validation + source preparation
   through a fresh compile, explicitly label the available stock
   preparation as copying frozen authored inputs (not production adapter
   generation). No filesystem/drop-cache or system changes. Compare compiler
   latencies descriptively, not stock/native end-to-end speedup.
2. **Native producer**: one prebuilt executable, fresh process, all
   train/validation/test and complete ordered JSON wire, captured to a
   fresh output file. Require exact byte count/SHA and zero rejected output.
   Comparison is 1/2/4 native workers against the **same** native producer
   only. This includes startup, join, JSON and stdout; it is not an isolated
   training kernel, not sealed archive time, and not a Bend speedup.
3. **Prebuilt, parity-checked diagnostic end to end**: compare
   `node stock-in-memory.mjs --verify ARCHIVE WORKERS` with
   `node ../parity.mjs check ARCHIVE TRUSTED_NATIVE WORKERS`. Both use the
   same verified archived inputs, perform fresh train/validation/test,
   form the same ordered full sealed checkpoint bytes in memory with
   stock record/seal, and compare every byte to the same stock golden
   archive. Neither writes a checkpoint. Includes JS startup, reference
   reads, model/stream handling and comparisons; excludes compiler on both.
   The stock adapter uses the exact sealed Bend backend, a serial JS loop
   for one worker and Node worker threads for 2 and 4 (a diagnostic mode,
   not production `--jobs`). Also report stock sealed workflow from P11.0
   as historical context only. Do not divide its time by this result or
   add separate median slices to simulate an end-to-end measurement.

Before any timing, run a **correctness-only** `-O3` gate across both
`x86-64-v3` and compatible local `znver3` builds. Keep observed `-O2`
reference results separate. Full comparison requires the previous 196
stock checkpoints plus Dry Lake's 27, for each 1/2/4 worker variant. Match
the frozen `-O2` raw wire on the original 14 plans and compare `-O3` wires
on Dry Lake between workers/targets. Check the stock in-memory adapter
before timing it. A mismatch/refusal/cap leaves the timing gate closed.
Do not pick the faster architecture after observing results.

The recorded `o3-gate.json` is that untimed correctness gate, not a
speed result: 223 complete stock checkpoint files matched in each of
six target/worker combinations (1,338 comparisons, 223 distinct files).
The original 14 plans produced the same raw streams at `-O3` as their
frozen `-O2` controls. All six Dry Lake target/worker combinations
produced the same wire. Before timing
the stock in-memory adapter also matched the 27 locked files at each of
1/2/4 workers (81 untimed comparisons).

## Measured results

Ryzen 7 5800X, Linux; generic `x86-64-v3 -O3` build. Values are median
wall milliseconds with min–max in parentheses for five samples each,
not confidence intervals.

| Fresh build interval | Stock Bend | Generated Clang |
| --- | ---: | ---: |
| Compiler only | 3307.45 (3218.07–3587.58) | 140.88 (138.55–144.12) |
| Source preparation and compile | 3464.32 (3293.03–3504.27) | 214.32 (211.31–215.77) |

| Workers requested | Native producer only | Stock checked endpoint | Native checked endpoint |
| --- | ---: | ---: | ---: |
| 1 | 5.81 (5.68–5.85) | 348.85 (339.89–352.71) | 121.87 (116.69–183.76) |
| 2 | 4.94 (4.72–5.37) | 344.57 (337.38–373.33) | 93.54 (84.88–94.95) |
| 4 (3 active) | 3.99 (3.87–4.25) | 273.55 (259.11–284.04) | 90.39 (87.46–94.13) |

The ratio of stock/native checked endpoint medians is 2.86×, 3.68×
and 3.03× respectively. These are like-for-like **prebuilt in-memory
diagnostics**, not the time ratios for sealed training runs. The P11.0
stock production measurement for this cell was 3.90 s median
(3.66–4.05 s), including compilation, checkpoint writes and evaluation;
it has no equivalent measured native production path. Do not compare it
to the raw native row or to the checked endpoint.

The timed endpoints matched all 27 distinct stock checkpoint files on
each invocation (810 complete-file comparisons over 30 invocations).
All 15 producer streams matched the locked 92,702 bytes. Each invocation
processed 3,072 train episodes / 21,834 moves, 216 validation episodes /
13,328 moves, and 48 test episodes / 288 moves. No resource limit tripped:
peak sampled group PSS was 686,838 KiB, minimum MemAvailable was
9,352,456 KiB, and no group swap or host swap-out was observed.
[Sanitized numeric evidence](dry-lake-results.json) retains all five
wall samples per timed cell; raw logs and local archive paths are omitted.

## Future guarded window

Reserve four physical cores and both of their sibling lanes from other
heavy jobs. The benchmark used logical 8 for one, 8–9 for two, 8–11 for
four, with siblings 0–3 reserved. The launcher takes the four logical
CPUs in order and refuses shared physical cores or less than 5 GiB
MemAvailable. For hardware/topology other than the reference, label the
result separately.
Pin the process mask only; do not change host affinity or settings.
Native/stock workers within each stage receive the same mask; Linux can
schedule threads within that fixed mask. Keep P11.0's nice +10. Have
the owner explicitly grant the exclusive slot and use the existing
per-user benchmark lock. Keep all caps (2 GiB sampled group PSS,
5 GiB headroom, >=24 GiB free, no sustained swap, 90 s process-group
stop, STOP file) and read-only input hashes. Prefer the P11.0 Linux
watchdog: its single-CPU outer pin can launch a nested `taskset -c MASK`
for the requested child mask. No command runs concurrently with another
timed command. If any guard triggers, retain evidence, abort instead of
replacing failures, and report censored cells; no medians with less than
five clean runs. Check that no process remains on interruption.

Five interleaved rounds: use the fixed worker orders in `workload.json`.
Within each worker count run stock/native comparison in stock-first order
on odd rounds, native-first on even rounds; alternate stock/native cold
compilers with the same rule. Raw native is before each endpoint pair in
rounds 1/3/5 and after in rounds 2/4, and always uses an independently
fresh output. Keep compilation checks outside hot samples; no benchmark
warmup run enters the five repeats. Freeze any allowed warmup policy before
launch. Capture per-component wall from wait/reap, child CPU, max RSS,
sampled group PSS and swap, input/output hashes, environment/tool versions,
and all five raw samples with median and range. Report train workload
rates only at a specified boundary. Do not infer multicore gains from
single-core correctness, an idle fourth worker, or producer timing.

After exclusive approval, the launch harness verifies the archived lock
and compiled `-O3` identity and refuses to overwrite an evidence directory.
From the repo root with the pinned toolchain on PATH:

```sh
P110_GUARD_PY="$REFERENCE_CHECKOUT/tools/perf/guard.py"
P118_EXCLUSIVE_SLOT=confirmed P118_CPUS="$FOUR_RESERVED_LOGICAL_CPUS" \
  bash twin/scalar-q-spike/bench/run-authorized.sh \
  "$STOCK_DRY_LAKE_RUN" "$VERIFIED_O3_DIRECTORY" "$NEW_EVIDENCE_DIRECTORY" \
  "$P110_GUARD_PY" "$LEAN_CLANG"
```

Use the P11.0 watchdog as-is and the exact .c and generic executable named
`dry-lake.c` and `dry-lake-x86-64-v3` under the correctness directory.
For intentional cancellation create `STOP` in the new evidence folder.
The evidence used this schedule with the recorded masks. The published
launcher parameterizes the mask instead of assuming those local CPU
numbers.

The witness does not write native archives or prove historical
replay/resume, production interruption or AVX2. No Level-4 adoption claim
is possible. A later production comparison needs the same consumed
seed panel, fresh compiler/manifest/checkpoint writes, verification,
replay and resumed lifecycle on both paths; compare against the best
eligible stock settings under identical resource and artifact contracts,
then apply the user's throughput/no-regression criterion.
