# Performance on the Phase 11 reference machine

**P11.0** fixes benchmark inputs before optimizing the reference engine.
The baseline engine is checkout
[`62decf6`](https://github.com/jaykobdetar/bend-agent-studio/tree/62decf6cce87217a86005eb2a048a94d2062c88f).
The [machine profile](../tools/perf/machine.json) describes the Ryzen 7 5800X
Linux desktop, memory, GPU, kernel and actual runtime/compiler versions.
GPU information is descriptive; none of these workloads uses the GPU.
No swap or kernel settings were changed.

## Fixed workloads

| Workload | Fixed definition |
| --- | --- |
| Flagship v2 subset | All eight original arms, three replicates per arm. One representative world per family: bandit/random; slippery lake/Q-learning, Expected SARSA and sampled SARSA; dry lake/Double Q; CliffWalking/Dyna; Deep Sea/n-step and TD(λ). Each family is a separate serial plan with original settings, seeds and checkpoints through 1,024; the timing is their sum. |
| Storm Reserve 24×8 | Q-learning and Dyna-5, eight matched replicates per arm, original factorial seeds/settings, through 4,096 episodes. |
| Apex Kart transfer | Original practice mixture only: tabular and shared features, eight seeds per arm, through 65,536 observed moves. Includes original checkpoint validation, not the separate holdout analysis. |
| CartPole network | One network actor–critic fit for 64 training episodes; checkpoints 0/8/32/64. |
| Acrobot | Original two fits through 64 episodes each. |
| Exact Taxi oracle | Shipped Taxi transitions, 200-tick horizon, one stock CLI solve. |
| Exact Storm Reserve oracle | Shipped 12×4 transitions, horizon 12, one stock CLI solve. |
| Flagship v2 analysis | Three passes over all 3,600 archived CSV rows: validation paired differences against Q, normalized IQM, and probability of improvement versus Q; each uses 2,000 bootstrap draws and the existing analysis CLI plus its suite statistics module. |

The [input lock](../tools/perf/input-hashes.json) checks generated plans, finite-world definitions and the checked-in analysis
data. It ignores absolute checkout paths,
not input contents. Every measured training run starts from a new directory
and is verified outside the measured interval. Sealed manifest, backend and
checkpoint digests must agree across repetitions.

## Measurement protocol

* Five serial repetitions, one pinned logical CPU at nice +10; no concurrent
  benchmark cases. Order rotates by round. The sibling hardware thread and
  ordinary system processes are not reserved. The filesystem/system caches are
  not flushed. Every timed training invocation compiles a fresh archive and
  includes training, ordinary validation/test and checkpoint writes.
* Wall time is recorded at reaping, independent of the memory polling
  cadence. Process CPU is Linux child user + system time including reaped
  compiler work. Peak RSS is for the largest individual child; peak group
  PSS is a sampled process-tree estimate, not a hard memory maximum. Report
  both, since a short-lived RSS peak can fall between PSS samples.
* Training episodes and moves are counted from the verified final checkpoint.
  Moves include any unfinished episode's accepted steps. Rates divide only
  training work by end-to-end wall time, so they include compile/evaluation
  overhead in the denominator. Non-training jobs report solves/s or CSV-row
  passes/s, not simulated episodes.
* The guard limits one command to 4 GiB sampled group PSS, requires 5 GiB
  host MemAvailable and 24 GiB free disk, and stops on ≥1 MiB sampled group
  swap or ≥8 MiB new host swap-out. It leaves existing swap untouched. If a
  case is censored, it is not silently counted toward a median.
* A separate profiling pass checks that instrumentation preserves all sealed
  output bytes. Node's sampling profile and the compiler's child CPU timings
  are diagnostic, **not** additional baseline runs. Python analysis uses
  cProfile instead. An inlined or too-short JS-to-Bend crossing may leave no
  visible profile frame. No hardware counter data are implied when `perf`
  cannot run. Visible bridge samples are not a measurement of total crossing
  overhead; the separate logical call counts indicate how often the runner
  uses that interface.

## Reproduce

From the repository root on Linux with the pinned Node/Bend toolchain,
Python 3, `taskset` and GNU `/usr/bin/time`, choose a new output directory
on local disk. Keep other heavy jobs out of the measurement window:

```sh
python3 tools/perf/bench.py runs/perf-p110
python3 tools/perf/profile.py runs/perf-p110
```

Use the reference checkout above for a historical rerun after engine
changes: create a detached worktree at that commit and copy this
`tools/perf/` directory into it before running the commands. Run a candidate
in a separate checkout and keep the input lock, CPU, versions and limits
fixed. Preserve the original measurements; compare against them.

Choose an available logical core with `--cpu` on both commands. They lock
out another benchmark script for the same user. On system pressure the
guard stops its own timed process group, not unrelated applications.
For an intentional stop, create `STOP` under the benchmark output directory
(the same marker stops the separate profiler). Benchmarks
retain local archives, logs and raw profiles. Do not commit those directories;
profiles can contain local paths.

## Results

All eight workloads completed five repetitions. The
[raw measurements and output digests](../tools/perf/baseline.json) retain each
timed component, the min/median/max, host headroom, work counts and profiling
aggregates. Wall ranges below are min–max, not confidence intervals. The
reference engine’s sealed output digests and counted work matched in all
five repetitions. No runs were censored.

| Workload | Median wall s (range) | CPU s | Max child RSS MiB | Group PSS MiB | Training episodes/s | Training steps/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Flagship v2 subset | 22.159 (21.925–22.827) | 21.864 | 1,342.4 | 1,390.5 | 1,109.1 | 10,863.5 |
| Storm Reserve 24×8 | 233.952 (233.458–236.107) | 233.487 | 366.1 | 430.3 | 280.1 | 6,723.0 |
| Apex Kart transfer practice | 122.741 (121.714–126.587) | 122.369 | 359.0 | 422.8 | 1,568.9 | 8,543.0 |
| CartPole network | 1.752 (1.636–1.846) | 1.731 | 253.5 | 305.5 | 36.5 | 1,540.8 |
| Acrobot | 4.293 (4.118–4.397) | 4.252 | 260.0 | 312.6 | 29.8 | 12,020.4 |
| Exact Taxi oracle | 0.0910 (0.0850–0.0979) | 0.0908 | 74.2 | 69.4 | — | — |
| Exact Storm Reserve oracle | 0.0679 (0.0641–0.0699) | 0.0676 | 68.6 | 51.7 | — | — |
| Flagship v2 analysis | 4.863 (4.804–4.960) | 4.861 | 35.6 | 25.7 | — | — |

The fixed exact solves completed at 10.99 solves/s for Taxi (504 modeled
states) and 14.74 solves/s for Storm (161 modeled states). The analysis consumed
2,221 CSV row-passes/s, counting each of the three passes over 3,600 rows;
that rate includes bootstrap work. These are descriptive workload rates,
not kernel operations per second. The busiest training repetition reached
1,450.8 MiB sampled group PSS; the lowest host MemAvailable across all
measurements was 8,573.5 MiB. The guard observed no group swap or host
swap-out during timed commands.

## Profiling

The separate profile pass preserved all 14 components’ output digests.
Each percentage is a share of **non-idle Node V8 profile time**, weighted by
the sample intervals. It is not a share of end-to-end wall time or
whole-process-tree CPU. Compiler CPU is measured separately and includes
Bend subprocesses for version checks, type checks and backend generation;
Node often appears idle while the compiler child runs. The evaluation and
checkpoint buckets are attributed by stack function names, not direct I/O
timers. A dash means no visible samples were assigned to that bucket.

| Workload | Compiler CPU s | Active Node sample s | Generated Bend (train/init) | Visible JS→Bend adapter | Checkpoint seal/I/O | Evaluation | GC | Other/setup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Flagship v2 subset | 17.48 | 4.258 | 72.56% | 0.12% | 3.70% | 3.77% | 10.93% | 8.91% |
| Storm Reserve 24×8 | 2.24 | 238.498 | 88.97% | <0.01% | 0.45% | 3.92% | 6.40% | 0.25% |
| Apex Kart transfer practice | 2.87 | 121.617 | 94.00% | 0.02% | 1.15% | 1.51% | 2.82% | 0.49% |
| CartPole network | 1.59 | 0.125 | 28.86% | — | 2.54% | 5.11% | 9.05% | 54.45% |
| Acrobot | 2.33 | 1.878 | 64.58% | — | 8.46% | 11.93% | 10.00% | 5.04% |

The flagship subset spends much of its time compiling; Storm 24×8 and Kart
spend most of their sampled Node time executing generated training code.
Kart issued 192,576 training begins and 192,617 training segments; the
small visible-adapter sample count does not measure all their overhead.
The exact oracles are pure JavaScript: Taxi had 25.0 ms attributed to
the solver and Storm 4.6 ms, with much of each short profile classified as
Node startup/other. Do not infer sub-millisecond effects from these samples.

For the three Python analysis passes, `random.choices` was the largest
self-time entry in each cProfile capture (0.797, 1.879 and 1.742 s); IQM
and probability-of-improvement also spent time in [suite_stats.py](../analysis/suite_stats.py)'s
bootstrap code. These are instrumented durations, not baseline medians.

`perf` was not installed and the host reported
`perf_event_paranoid=4`. No hardware-counter or kernel-level attribution
was collected, and nothing was installed or reconfigured for this baseline.


## P11.1: optional superiority bootstrap

On the [same target machine](../tools/perf/machine.json), the paired test
repeated the fixed flagship v2 analysis inputs with Python 3.12 and NumPy 2.5.5
installed. Each row is the median of five interleaved reference/opt-in runs,
using the same interpreter, affinity and guards. All 30 CSV outputs matched
the P11.0 output hashes. Use these same-interpreter controls, not the earlier
Python 3.14 baseline timing, to estimate the effect of the option.

| Analysis component | Reference wall s | Opt-in wall s |
| --- | ---: | ---: |
| Paired validation | 0.456 | 0.454 |
| Normalized IQM | 1.310 | 1.310 |
| Probability of improvement | 2.030 | 0.882 |
| Three passes total | 3.802 | 2.645 |

The probability-of-improvement pass took 57% less time, and the three analysis
passes took 30% less time. This does not accelerate training or solve calls.
The paired path is unchanged and IQM never imports NumPy. A broader draft
made IQM about 4% slower and was not adopted. For the adopted path the median
largest-child RSS rose from 32.0 to 39.1 MiB in the superiority pass.

With the [optional analysis requirements](../analysis/requirements.txt)
installed in a Python environment, set `BEND_ANALYSIS_NUMPY=1` for the suite
statistics command. The shortcut is limited to eligible balanced
probability-of-improvement inputs. If NumPy is absent or the input is not
eligible, it uses the original standard-library path.


## P11.2: hard limits before automatic shards

The reference PC exposes the cgroup v2 memory controller and its user
systemd reports version 255. The benchmark's sampled PSS guard is useful
for telemetry but does not prove a hard cap for concurrent workers. A
transient scope's effective memory limit and OOM behavior were not verified,
so `--jobs auto` is not available. Existing manual shard behavior is unchanged.

Before adopting automatic sizing, verify effective limits from inside
a dedicated transient scope, measure a representative shard, observe a
scope-local memory failure, and demonstrate safe fallback on that failure
without retrying unrelated errors. Compare sealed checkpoints and archive
exports against serial runs, including interrupted resumes and partial
episodes. Any separate evaluation pool must reduce in seed order with the
existing statistics update and fit in the same memory budget. Neither
change was adopted or timed against the reference.


## P11.3: prospective stopping and annotation trials

The CLI's [preregistered sequential validation](experiments.md#prospective-validation-stopping)
keeps the matched blocks in seed order and never trains an unapproved block.
On a synthetic, deterministic two-arm validation fixture, the effect was
known before the run: the learning arm chooses an action worth two more
reward units than the fixed reference. The maximum was fixed at 32 pairs;
there were no test episodes. This is separate from the P11.0 workloads.

Five alternating comparisons used the [reference machine](../tools/perf/machine.json),
pinned Node 24.22.3 and Bend 2.0.40, one logical CPU, and the benchmark guard.
Both versions of the stopping command stopped at 9 of 32 pairs. All 36
sealed checkpoint files in each stopped prefix matched the corresponding
fixed-maximum run byte-for-byte, and the decision was recalculated solely
from the authorized validation prefix.

| Approach | Median wall time | Pairs executed |
| --- | ---: | ---: |
| Complete the fixed maximum (initial comparison) | 0.898 s | 32 |
| Stopping draft, one Node process per arm | 2.474 s | 9 |
| Complete the fixed maximum (resident comparison) | 0.899 s | 32 |
| Stopping with one verified resident runner | 0.428 s | 9 |

The resident command took about 52% less time on this early-crossing fixture.
A study that cannot stop early may not benefit; the no-crossing path was
tested for correctness, not timed. This does not make training a given
checkpoint faster. Normal run, replay and resume do not use the new command.

An experimental exact-evaluation annotation path preserved all 60 sealed
files and the old sampled CSV in ten runs of the fixed flagship
Cliff/Dyna cell over five rounds. Opting in increased median wall time from
8.960 to 9.199 seconds; re-reading 27 exact values took 0.197 seconds, versus
0.176 seconds with the existing study helper. Its overlapping modeled values
agreed; the candidate was not adopted. Neither sampled evaluation nor the
existing analysis has changed.

A live compile-cache prototype passed unit tests for corrupt entries and
ownership rejection, but the real compiler dependency audit and
warm/cold measurements are incomplete. Cross-plan raw checkpoint reuse
does not satisfy the current manifest-linked seal. Neither cache is enabled.


## P11.5: episode batching was not adopted

A diagnostic called the same compiled Bend advancement function once per
episode or once per checkpoint interval. It used the two fixed slippery-lake
arms from the [population fixture](../tools/bend-parallel-spike/README.md),
on one logical CPU of the [reference machine](../tools/perf/machine.json).
Both arms had 1,024 episode calls or 24 interval calls. The model snapshots
and the ordered score/step/stop reports agreed with the stock archived
JavaScript output at all 64 model and 2,048 report coordinates.

After equal warming, five interleaved pairs measured advancement plus the
same host-side report consumption. The clock did not include compilation,
checkpoint model encoding, or output serialization.

| Arm | Per-episode median | Batched median | Batched vs. per-episode |
| --- | ---: | ---: | ---: |
| Q-learning | 34.427 ms | 33.463 ms | 2.8% less; ranges overlap |
| Dyna-Q | 257.093 ms | 264.950 ms | 3.1% more; slower in all five pairs |

Cold compilation for the common diagnostic module took 3.624 seconds in
its one observed setup; that is not a five-run timing or an estimate of
end-to-end saved time. Traversal and encoding were checked separately,
not subtracted to infer a pure call-overhead percentage. Since batching
regressed one arm, it was not adopted. This was not a P11.0 workload,
a step-budget test, or a sealed archive parity test. The original runner
and its archive digests remain unchanged.

## P11.7: a verified CUDA rounding counterexample

A [bounded diagnostic](../tools/bend-f32-sentinel/README.md) found that
stock Bend 2.0.40 on the RTX 3060 Ti rounds `sin(1e6)` differently from its
emitted JS and native CPU backends. The independent MPFR result agreed
with JS and CPU. The test recorded 105 actual `bend_dev` kernel events;
the negative control recorded none. Ten sampled CUDA fields differed by
one ULP, representing seven distinct operation/input combinations. This
is evidence against replacing the sealed engine with stock transcendental
operations on CUDA, not a full numerical or checkpoint test. No engine
source, archive format, or default changed.


## P11.6: stock population diagnostic

A [bounded slippery-lake diagnostic](../tools/bend-parallel-spike/README.md)
matched all 64 model snapshots and 2,048 individual training reports on
each of five stock JavaScript and native CPU paths. Both arms used the
original archived seeds and generated world adapter. When two native
threads were requested, both shared one logical CPU; the result verifies
the mechanism and these outputs, not throughput or sealed archive parity.
The wider compiler job hit the diagnostic's 2 GiB memory guard, so only the
scoped fixture is qualified.

A separate RTX 3060 Ti Q-learning attempt hit its 60-second ceiling while
the runtime was compiling the device sidecar. It returned no model rows and
its trace provided no verified kernel evidence. Dyna was not attempted on
the GPU. No native or CUDA backend was adopted.


## P11.8: scalar native checkpoint witness

The [bounded native witness](../twin/scalar-q-spike/README.md) generated C for
14 finite plans covering Q-learning, Expected SARSA, Double Q, Uniform and
Dyna-Q. It reproduced 196 complete stock checkpoint files byte-for-byte on
each of two Clang 22.1.4 builds: generic x86-64-v3 and local Zen 3. Both builds
ran locally at `-O2`, with contraction and fast math disabled. The verifier
used the unchanged JavaScript statistics reducer, original manifest and
seal code. No generated result was written as an archive.

This verifies the chosen plans, including literal and packed worlds, not all
eligible shipped plans. The fixture detects a rare random tie retry and Dyna
experience and draw ordering errors. This is not a runtime, scaling or
compiler tuning measurement. SIMD, production scheduling, integration,
and archive replay and resume through a native path are still unverified.
