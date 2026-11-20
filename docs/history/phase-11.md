# Phase 11: performance and parity checkpoint

**The phase is not complete.** The normal engine and archive formats remain
the reference. This record separates shipped changes from bounded diagnostic
results. No changes to the engine core, laws, proof kernel, archive format,
or stock random-seed rules were made in this checkpoint. See the [performance guide](../performance.md) for fixed inputs,
guard settings, medians, and reproduction commands.

| Item | Status | What is verified or still missing |
| --- | --- | --- |
| P11.0 | Baseline recorded | Eight fixed workloads, five repeats each; diagnostic profiles preserved output bytes. Hardware perf counters were unavailable. |
| P11.1 | Partial, on main | Optional exact same-seed superiority calculation and configurable Studio replay limits landed. Windows/macOS scope and existing checks were retained. |
| P11.2 | Deferred | A disposable Linux memory cap was enforced. Two-worker evaluation preserved checkpoint bytes but slowed Bridge. No automatic sharding or evaluation change. |
| P11.3 | Partial, on main | Resident preregistered validation stopping passed exact prefix checks and the fixed small pilot. Exact annotations, cold/warm compiler caching and cross-plan raw checkpoint reuse were not adopted. |
| P11.4 | Deferred | No warm compiler service, Unix socket listener or background activation was installed. The measured compile cache did not meet the adoption gate. |
| P11.5 | Not adopted | Warm batching preserved the sampled models and reports but was slower for Dyna-Q in all five paired comparisons. Step-budget and sealed parity were not tested in that spike. |
| P11.6 | CPU diagnostic; not adopted | Five stock JS/CPU paths matched 64 complete models and 2,048 training reports each. The bounded CUDA population attempt returned no model rows or verified device kernel. |
| P11.7 | Partial diagnostic | Stock sine differed by one ULP on actual CUDA. An outward portable tanh prototype matched 5,692 CPU/JS words and 24 verified CUDA words. A separate midpoint test found two deliberate refusals and no incorrect numeric output. The current precision stages do not cover all inputs. |
| P11.8 | Partial diagnostic | Five finite learners, both compiler targets, 1/2/4 workers, three cells under the actual flagship seal, one complete shipped Bridge plan, bounded continuation and stock archive handoff, a Uniform-policy AVX2 RNG witness, and a hosted generic-native smoke. No adopted engine, whole eligible plan matrix, learner SIMD, or complete native archive lifecycle. |
| P11.9 | Deferred | Do not tune a production native engine until one qualifies; no PGO, ThinLTO or BOLT adoption. |
| P11.10 | Not qualified | One original flagship Q-learning cell matched all 90 stock checkpoints on the actual RTX 3060 Ti. The scope does not qualify a production CUDA backend. |
| P11.11 | Not evaluated | A missing population test does not justify an approximate screening backend. |
| P11.12 | Deferred | No tuner or persisted settings derived from an unqualified runtime. |
| P11.13 | Deferred | No automatic idle work or service activation. |
| P11.14 | Preparation complete | Inert owner-only template and isolation guide. No runner registered or started and no GPU job enabled. |

## Measured results

- The selected NumPy superiority path reduced the measured three-pass
  analysis median from 3.802 to 2.645 seconds with identical CSV bytes.
  It does not accelerate training. The broader IQM change was dropped.
- Preregistered stopping ran 9 rather than 32 matched pairs on its
  deterministic validation-only fixture. The resident variant was 0.428
  seconds versus 0.899 seconds for the fixed maximum and preserved all 36
  prefix checkpoints. The no-crossing path was checked for correctness,
  not timed.
- The compile cache's warm median was 0.264 seconds against 1.934 seconds
  direct on the fixed flagship bandit cell. Its cold median was 2.106
  seconds and lost all five pairs, so it was not adopted.
- For prebuilt, checked in-memory Dry Lake/Double Q, the two-worker
  medians were 344.570 ms stock and 93.541 ms native. All 810 timed
  complete-file comparisons were exact; neither endpoint writes
  archives. This does **not** establish a full flagship speedup.

- The exact parent-seal checks cover 270 files across three original flagship
  v2 cells. The separate [Bridge check](../../twin/scalar-q-spike/bridge/README.md)
  covers one complete unchanged shipped plan, all 72 files. Both compiler
  targets and all three worker counts agreed in these bounded cases.
- The existing archived runner reproduced a learned-model replay and
  resumed a [verified literal Q prefix](../../twin/scalar-q-spike/lifecycle/README.md).
  This used a scratch handoff after complete byte equality, not a general
  native archive writer.

- A separate [Bridge end-to-end diagnostic](../../twin/scalar-q-spike/bridge-workflow/README.md)
  matched all 72 checkpoint files in each of 20 complete archive runs,
  with identical verification, CSV and untimed replay. Native was 1.73×
  as fast with prebuilt code, but took 17% longer cold. This is not
  flagship performance or a qualified production runtime.

## P11.2: memory isolation and evaluation

The single authorized disposable Linux scope enforced the 48 MiB limit,
recorded one OOM kill attributable to that scope, and was removed when the
test exited. This establishes basic enforcement, not automatic sharding
or a supported fallback. The scheduler tests exercised a simulated
failure and cleanup; no production scheduler was enabled.

A separate evaluation-only comparison used the pinned Node 24.22.3,
archived Bend backend, unchanged validation and test seeds, and two
resident Node worker threads on the fixed Ryzen 7 5800X machine.
Evaluation used the existing report accumulator in seed order. Before
timing and on every repeat, resealing the body with recomputed metrics
matched every reference checkpoint byte. Reference files were not changed.
Five alternating serial and two-worker repeats followed the preflight.

| Original case | Checkpoints | Evaluation episodes | Serial median | Two workers median |
| --- | ---: | ---: | ---: | ---: |
| Bridge / Q-learning | 24 | 1,792 | 5.450 ms | 8.601 ms |
| Storm Reserve 12×4 / Q-learning | 32 | 3,072 | 2,222.293 ms | 1,350.358 ms |

These times exclude training, archive I/O, worker startup and checksum
verification. Parallel evaluation was 1.65× as fast on this Storm
Reserve cell but took 58% longer on Bridge. No worker mode was enabled or
selected automatically. Qualifying a selective policy would require
preregistered thresholds, checks across more models and all fixed
workloads, and end-to-end lifecycle parity.

## Actual CUDA: one original flagship cell

The original flagship v2 slippery FrozenLake / Q-learning cell used the
unchanged plan, all ten original replicate IDs, and its original validation
and test budgets. The reference was the stock archive with parent seal
`a5b41470bbe999d26d9919087156c5b62078ecae52c634757addd29e5ea36a43`.

The one-cell CUDA witness was built with CUDA 12.0.140 and GCC 12 for
sm_86, with FMA contraction and flush-to-zero disabled. The finite
Q-learning loop used explicit round-to-nearest binary32 arithmetic and
no transcendental operations. Two Nsight captures on the RTX 3060 Ti
each recorded one positive-duration kernel event. Host code transferred
and encoded the results but did not run the learner or fall back to the
CPU. The captured output matched the corresponding ordered CPU output,
covering 11,120 training, validation and test episode reports in total.
The unchanged native comparator then matched the complete checkpoint
bytes against the stock archive.

| Original replicates | Matched checkpoints | Captured wire SHA-256 |
| --- | ---: | --- |
| 0–7 | 72 | `ff00f68f2e6039990897f3c63592511f9e770dda23bfe64c6c9cd22457867d9d` |
| 8–9 | 18 | `89a8e13c6c1508a53937272015a0705323bbf341d0735299bc75a081fddcf9bb` |

This is device correctness evidence for one cell, not a speed test.
There was no GPU archive writer, no independent full-plan lifecycle
test on CUDA, and no CPU/GPU crossover measurement. The original archive
was not modified. The portable tanh and stock Bend CUDA experiments
are distinct diagnostics and do not extend this cell's scope.

## Adoption priorities

First expand the native witness to the eligible shipped plan matrix and
prove that native-generated archives verify, replay and resume through
the supported lifecycle. Measure true end-to-end cold and warm runs
across P11.0 without reducing the work. Keep the stock engine as the
default until exact parity and no-regression criteria hold. Portable
math still needs independent all-input coverage and backend checks;
retain verified device evidence separately from CPU correctness.


## Where to verify the checkpoint

- [Fixed baseline and adoption rules](../performance.md), with the
  [first baseline CI run](https://github.com/jaykobdetar/bend-agent-studio/actions/runs/44744928589).
- [Stock GPU rounding counterexample](../../tools/bend-f32-sentinel/README.md)
  and [portable tanh diagnostic](../../tools/bend-tanh-diagnostic/README.md).
- [Scalar, parent-seal and threaded native witnesses](../../twin/scalar-q-spike/README.md),
  including the [hosted generic smoke](https://github.com/jaykobdetar/bend-agent-studio/actions/runs/44762190976).
- [The replay fixture CI repair](https://github.com/jaykobdetar/bend-agent-studio/actions/runs/44758586298)
  kept Windows coverage while improving its test-only startup allowance and
  requiring the single test replay slot to be released. Production replay
  behavior and its configured defaults did not change in that repair.
