# P11.6: stock Bend population diagnostic

**Bounded CPU correctness passed; not adopted.** One slippery-lake workload
matched the archived JavaScript reference on stock Bend 2.0.40. A bounded
CUDA attempt stopped during sidecar compilation without results. No CUDA
parity, throughput, sealed-checkpoint parity, or engine integration is claimed.

## Fixed first gate

Use the sealed [flagship v2 study](../../studies/flagship-toy-text-v2/README.md)
and its [identity](../../studies/flagship-toy-text-v2/identity.json). The first
gate is the slippery 4×4 lake only, built-in Q-learning and Dyna-Q. Take
replicates 0–7 (zero-based) and budgets 0, 8, 64 and 128 in each arm. The
available archive is from the stock 2.0.40 JavaScript backend after R10.2;
no new RNG stream or test results are needed to prepare reference data.
The comparator checks the manifest and all checkpoint links through 128. It
reads checkpoint data and never imports or runs the archived backend.

With Node 24.22.3, set ARCHIVE to that trusted run and CANDIDATE to a separate
JSON diagnostics file:

```sh
node tools/bend-parallel-spike/check-model-words.mjs "$ARCHIVE"
node tools/bend-parallel-spike/check-model-words.mjs "$ARCHIVE" "$CANDIDATE"
```

The first form prints the diagnostic reference JSON; the second verifies a
candidate and reports the first different word. The file contains one object
with schema 1, the v2 sealed manifest hash as source, game ID, and 64 rows.
Rows are ordered by arm, then replicate, then budget. Each row contains
its coordinates and ordered unsigned 32-bit model words:

- Q: tag 0, raw binary32 alpha, raw binary32 gamma, exploration buckets, and
  the table. Dyna: tag 1, the same settings, planning steps, pair count,
  planner RNG seed, table, then experience.
- Table: 0 for empty; otherwise 1 and its exact tree. A tree is 0 for vacant,
  or 1 followed by state, action, visits, raw value, then the low and
  high subtrees in preorder. The tree shape must match; a sorted flattening
  could hide a changed archive encoding.
- Dyna experience: prefix each pair with 1, then observation, action, total,
  then its samples; terminate the pair list with 0. Prefix each sample with
  1, then count, raw reward, next observation and the view tag (0 for End,
  1 for Open). For an open view, prefix each legal action with 1 and terminate
  the action list with 0. Terminate each sample list with 0.

Keep diagnostic output outside the archive, never as a sealed checkpoint.
Matching these words verifies the selected model states only. It does not
verify validation/test, episode summaries, archive bytes or speed.

## CPU evidence

We staged the identical archived modules and verbatim generated slippery-lake
adapter in a new directory, keeping the stock study implementation and
excluding unrelated generated entrypoints. The full flagship generated
module exceeded the 2 GiB sampled-PSS guard in this diagnostic; the narrow
build completed without raising the cap. Nothing inside the reference
archive or sealed runner changed.

| Checked path | Complete model snapshots | Exact individual training reports |
| --- | ---: | ---: |
| Stock JS, serial | 64 / 64 | 2,048 / 2,048 |
| Stock JS, same fork tree | 64 / 64 | 2,048 / 2,048 |
| Stock native, serial, one thread | 64 / 64 | 2,048 / 2,048 |
| Stock native, parallel let tree, one thread | 64 / 64 | 2,048 / 2,048 |
| Stock native, parallel let tree, two threads | 64 / 64 | 2,048 / 2,048 |

All runs were pinned to logical CPU 7, below the 2 GiB sampled process-group
PSS guard and above the 5 GiB host-memory floor. Each command had a 90 s
ceiling. Both native threads shared one CPU, so this exercises the stock
fork path and worker configuration, not scaling. No timing claim is made.
Every candidate report was compared to the same sealed JS backend's
recomputed score bits, accepted step count and stop reason/action. Its
cumulative metrics and model agreed with the archive at every checkpoint
through 128. Validation and test were not recomputed by the candidate.

### Reproduce CPU correctness

Use the [fixed baseline guard](../perf/guard.py) with the same resource
limits for each candidate compile/run. For the following command bodies
set ARCHIVE to the verified trusted study, STAGE to a new directory with
a plain path name and an existing parent, and EVIDENCE to a separate
existing output directory. The exact toolchain was Node 24.22.3, Bend
2.0.40 and Clang 22.1.4. The installed Lean-bundled Clang needed its own
include directory on C_INCLUDE_PATH in addition to its bin on PATH.

```sh
node tools/bend-parallel-spike/prepare.mjs "$ARCHIVE" "$STAGE"
bend "$STAGE/population.bend" -o "$STAGE/population.mjs"
bend "$STAGE/population.bend" -o "$STAGE/population-native"
node tools/bend-parallel-spike/check-model-words.mjs "$ARCHIVE" > "$EVIDENCE/golden.json"
node tools/bend-parallel-spike/js-entry.mjs "$STAGE/population.mjs" 0 serial > "$EVIDENCE/js-q.json"
"$STAGE/population-native" +RTS --threads 2 --gpu off -RTS 1 0 > "$EVIDENCE/native-q.json"
node tools/bend-parallel-spike/check-reports.mjs "$ARCHIVE" "$EVIDENCE/golden.json" q_learning "$EVIDENCE/native-q.json"
```

Repeat the report check for the JS output and for arm argument 1, which
maps to dyna_q; use serial mode 0 and fork mode 1 on native and serial or
parallel in the JS driver. The report checker executes only the trusted v2
backend after checking its SHA-256; never substitute an untrusted archive.
Each replicate yields four complete model rows, then three contiguous
report-word segments (8, 56, and 64 episodes). Each report is four words:
raw score, accepted steps, stop tag (0 terminal, 1 limit, 2 illegal), and
action for illegal stops or 0 otherwise.

## CUDA build and bounded attempt

Prepare a separate staging directory with the --cuda option. It adds
mode 2 for the GPU-marked form of the same balanced tree. Pass CUDA_HOME
as /usr for the local Ubuntu NVRTC layout during the build. The resulting
ELF linked the CUDA driver and NVRTC and contains the stock bend_dev
kernel source. The stock runtime is expected to generate its .gpu sidecar
on first device execution; no sidecar or CUDA execution was observed
from the compile-only command.

| Artifact | SHA-256 for local build |
| --- | --- |
| CPU diagnostic source | `830da57141ad448ef2c146ba6ff387eddfe1ba784e22291d8b68f6fee0ccebd3` |
| CPU executable | `b4ac9595aafb05ed26109f29cb8a9c6251ffad1fa8a4b3784ac88346790426e7` |
| CUDA diagnostic source | `3c97cc8896d902fb5af2e4ceb1928d91ea14367ce578e3384e6d959729be1464` |
| CUDA-linked executable | `ece1c3c21c3f0c35a929d25d8415dee4649c7d47880e4f8349376155d62e1670` |

One Q-learning population attempt on the RTX 3060 Ti used logical CPU 7,
one host thread, a 512 MiB Bend heap request, and a 60 s elapsed limit.
The guard stopped the process group at the elapsed limit. Stock Bend last
reported compiling the missing or stale GPU sidecar; no sidecar completed
and stdout contained zero model rows. The matching offline Nsight importer
and SQLite export succeeded, but the export had no kernel activity table.
It cannot verify even one timed bend_dev launch. A missing table does not
prove no launch outside the captured data. Cleanup verified that neither
the diagnostic nor the profiler remained running. Dyna-Q was not attempted
on CUDA. The result is **undemonstrated under this bound**, not a numerical
parity failure or a device throughput measurement.

For a separately authorized future device run use the same CPU and host memory
guard, no concurrent GPU work, at least 2 GiB actual free VRAM, and start
with one arm, one host thread, and a 512 MiB explicit Bend heap ceiling.
The stock runtime has a substantial fixed heap overhead; the different
F32 sentinel needed about 410 MiB, which is **not** this population's
measured minimum. The total driver/context footprint may exceed the
requested heap, so do not treat the option as a GPU-wide bound. Use an
isolated writable scratch and cache, a fresh trace per arm, and no CPU,
OS, or system-wide sampling. Stop without raising the ceiling on an
allocation failure, missing device, guard intervention, or mismatch.

The invocation shape is:

```text
nsys profile --trace=cuda --sample=none --cpuctxsw=none --export=sqlite   --output=NEW_TRACE_PREFIX STAGED_CUDA_BINARY +RTS --threads 1 --gpu 512MB -RTS 2 0
```

Capture stdout separately. Require nonzero timed bend_dev activity from
one child on one device in its own isolated trace using
[the read-only kernel checker](check-kernel.py), and run the same
full model/report checker on stdout. Repeat with arm 1 only if the first
passes. CPU fallback, no kernel rows, failed import, or wrong kernel name
cannot count as CUDA parity. Offline, the checker verified 105 timed
bend_dev launches in a separate sentinel capture and rejected this capped
population capture because its kernel activity table is missing. The
sentinel's launches are not population evidence.

## Initial sequence and remaining adoption gates

1. Copy only the verified stock archive's flat Bend sources into a new
   private staging directory. Check each against the toolchain source map.
   Do not mutate the archive or tracked sources. Add a diagnostic entry point
   separate from the generated study: reuse the exact generated world
   adapter named by `adapterName(game, arm)` in
   [the reference runner](../../core/experiment.mjs), its `initial_for`,
   and the archived seed/settings rules. Use the plan's horizon. Start at
   that replicate's training seed, and call the same `E.Train` episode
   function with seed plus episode index in the exact order; snapshot
   at the fixed boundaries. Do not rewrite greedy tie-breaking or Dyna
   sampling. Encode with `F32.bits`, then print a single model-word JSON
   document on the host side. Compile a JS diagnostic module and ensure a
   serial version matches all 64 golden model snapshots before moving on.
2. Compile the same staged program with the stock Bend release as a native
   executable with a real main. Run the serial entry with CPU threads set
   to one and GPU off. Then split the eight independent replicates into a
   fixed balanced tree of parallel calls, each leaf training exactly one
   model; use trial order, not completion order, when collecting. Run still
   with GPU off on one and eight CPU threads. Compare all model words and
   record the first mismatch instead of silently accepting approximate
   equality. Budgets and short episodes reveal diverging paths; do not align
   by taking extra steps or share a mutable RNG or model between replicates.
3. Only if CPU gates pass, exercise one actual GPU-marked call around the
   same population using the stock CUDA-linked build and the bounded
   procedure above. A device listing, request flag,
   or matching answers does not prove the kernel ran: the runtime may fall
   back to CPU. Verify nonzero Bend device kernel launches for that
   specific child with the established offline Nsight trace, then compare
   words against the same reference. Treat absent device access, failed
   build or no kernel activity as blocked, not parity. The existing
   transcendental GPU differences do not imply a failure for this
   transcendental-free model; Dyna's correctly rounded divisions and
   binary32 update order still have to pass.
4. Before adoption, carry exact episode reports and ordered model data to
   the unchanged host collector, verify train/validation/test metrics and
   every sealed byte against the reference for the same plan, and verify
   replay and resume with archived Bend. Then run end-to-end timing against
   the best [fixed baseline path](../../docs/performance.md) under the
   baseline guard and exclusive slot. Report compile/startup/transfer and
   host sealing separately as diagnostics, but count them in total time
   where the reference includes them. Use at least five controlled runs;
   no win on a kernel alone. If parity fails or no workload improves
   without a regression, record the measured result as not adopted.

The [previous native spike](../native-spike/README.md) compared an older flat
table and did not establish a speedup; it is not evidence about this
current indexed model. No continuous world, custom learner, partial cursor
or parity of transcendental functions is in this first gate.
