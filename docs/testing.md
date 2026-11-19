# Testing

## Which checks run where?

Run commands from the repository root unless a different working directory is specified. The [CI workflow](../.github/workflows/checks.yml) is the source of truth for the pinned tools and steps.

| Check | What it exercises | Where it runs |
| --- | --- | --- |
| `npm test` | Documentation links, CLI coverage and counts; Node host and Studio fixtures; generated probe worlds; packed-world checks. With Bend installed, the eligible tests also compile, train, replay or resume small fixtures. | Linux and Windows jobs. An absent compiler produces explicit skips in [compiler-dependent tests](../checks/support.mjs); the Node suite still expects Python 3 for suite statistics; an installed but broken compiler is not a pass. |
| Bend check programs | The [engine](../checks/checks.bend), [benchmark fixtures](../checks/benchmark_checks.bend), [study fixtures](../checks/study_checks.bend) and each of the six learner check programs assert concrete results. | Linux, Bend 2.0.40. These are distinct from the standalone CSV benchmark producer. |
| BendTT verdicts | `bend laws/PROOF.bend --verdict` and the six learner proof entrypoints check the propositions with the independent kernel. | Linux, Lean 4.34.0. Numerical examples passing is not a proof, and a structural law is not a performance claim. |
| Archive gates | Source and bundle fingerprints, representative compiled backend hashes, and a historical-archive check through the current Studio and MCP. See [what each archive gate covers](../tools/archive-gates/README.md). | Both jobs compare flat source/bundle identities; Linux additionally compiles backend samples and exercises historical archives. Passing current-code tests alone does not cover old runs. |
| Analysis and generated-world checks | Both Python statistical modules, a small seeded compiler campaign against an independent simulator, and the two-pile Nim plan/checker. | Explicit Linux steps; the campaign samples worlds, not every possible world or horizon. |
| MCP and Python integrations | MCP runs its own package tests. The optional Gymnasium and Minari adapters run their own Python tests in isolated environments, including compiled-replay and offline-export fixtures respectively. | MCP on both jobs (Linux provisions a second Node version for archived-runtime coverage); optional Python integrations on Linux. These are not implied by running the root Node suite. |

A green Windows job means the Node-only workflow passed. It does **not** mean Bend, Lean, the compiled backend hash checks, Gymnasium or Minari ran on Windows. For the quick local smoke test use `npm test`; for a change to archive layout, learner semantics or Python integration, run the matching row above as well.

### Running individual checks

| Local command or guide | Coverage and CI step |
| --- | --- |
| `node checks/docs_check.mjs`; `node --test checks/docs_inventory.test.mjs checks/docs_markdown.test.mjs` | Link targets, headings, executable paths, source counts and negative fixtures. Root Node tests. |
| `node --test checks/experiment_checks.mjs checks/batch_checks.mjs studio/studio_checks.mjs` | Checkpoints, resume/replay, selection/assessment, offline partitions and Studio workflows. Root Node tests. |
| `node --test checks/legacy_examples.test.mjs agents/linear/checks.mjs` | Fixed two-door demo output, the 100-row legacy benchmark CSV hash, and linear learning/replay. Root Node tests, compiler-dependent. |
| `node --test checks/oracle_checks.mjs checks/memory_checks.mjs checks/statistics_checks.mjs` | Oracle values and memory-world regeneration (also executable directly); Python suite-statistics regressions through a Node wrapper. Root Node tests. |
| `node --test worlds/benchmarks/probes/checks.mjs tools/finite-layout/packed-checks.mjs` | Regenerate authored probes; compare packed/expanded storage, partial episodes and replay. Root Node tests. |
| `python3 -m unittest checks.test_multiple_comparisons checks.test_suite_stats` | Multiplicity adjustments, paired bootstrap and statistical CLI behavior. Linux statistical comparisons step. |
| `node experiment.mjs run experiments/two-pile-nim.json runs/nim`, then `node checks/nim_checks.mjs runs/nim` | Exact independent checks for all nine starting pile pairs. Linux Nim step. For a separate compiled self-play check, use `node checks/arena_checks.mjs runs/self-play` on a completed self-play study; it is not a separate hosted step. |
| [Each learner’s checks and proof](laws.md#formal-properties) | Run the commands in its README, e.g. `bend agents/sarsa/checks.bend` and `bend agents/sarsa/proof.bend --verdict`. Linux Bend and BendTT steps. |
| `node tools/archive-gates.mjs check tools/archive-gates/m0-exceptions.json`; `node tools/archive-gates.mjs check-backends` | Exact permitted source/bundle hashes and representative compiled backend hashes. For the Linux historical-archive step, use the [hosted harness](../tools/archive-gates/g4-hosted.sh) with full Git history, pinned Node/Bend and MCP dependencies, not just a copied source tree. |
| In the [MCP package](../mcp/README.md), run `npm ci --ignore-scripts`, then `npm test`. | Protocol, workspace boundaries, workflow, compiler, inspection, lifecycle and optional-tool fixtures. Both MCP jobs. |
| Follow the [Gymnasium](../integrations/gymnasium/README.md) or [Minari](../integrations/minari/README.md) environment instructions and run that adapter’s unittest command. | The corresponding optional Python integration step on Linux. Neither dependency belongs to the root install. |

## Test the implementation

```sh
bend checks/checks.bend
bend checks/benchmark_checks.bend
bend checks/study_checks.bend
bend laws/PROOF.bend --verdict
node checks/experiment_checks.mjs
node checks/batch_checks.mjs
node checks/world_campaign.mjs --bend bend --seed 30000 --worlds 4 --episodes 128 --batches 1
```

The independent verdict needs a matching BendTT kernel available to Bend. The randomized campaign compiles newly generated games and compares boundary transitions, episode reports, and paused execution with an independent simulator. Its output lists the seed and source fingerprints so a failing batch can be repeated.

### Compare keyed tabular training against list-backed archives

Use the same `benchmarks/tabular-parity.json` plan in a list-backed checkout
and an indexed checkout (copy the plan into a `benchmarks/` folder in the
older checkout). Run `node experiment.mjs run benchmarks/tabular-parity.json RUN`
in each with a separate, new output directory. This is a bounded planning-budget
study: two games, four arms, two replicates and three checkpoints. Compare
train, validation and test metrics, not checkpoint hashes: the representation
of learned tables intentionally changes. Existing runs continue replaying with
their archived code; no old models are converted.

To time the **training kernel** rather than compilation or checkpoint I/O, run
`node benchmarks/tabular-timing.mjs LIST_RUN TREE_RUN` with trusted local
archives. It checks each of 700 Detour Q-learning episode scores across two
warmups and eight alternating-order measurements. As one local example with
Node 24.22.3/Bend 2.0.40, median times were 72.3 ms and 67.9 ms respectively
(1.07×). The result is workload-specific: very small tables may not benefit;
UCB still scans the table once for total visits at an observation.

## Run the checks

With Bend 2.0.40 and Node 24 installed:

```sh
npm test
bend checks/checks.bend
bend checks/benchmark_checks.bend
bend checks/study_checks.bend
bend laws/PROOF.bend
```

`npm test` runs the Node checks, including public-policy oracles and generated memory worlds. If the Bend executable is absent, compiler-backed tests are marked skipped. With Bend installed, they exercise training, replay, checkpoint persistence, and offline evaluation.

For an independent proof verdict, install Lean 4.34.0 (for example, `elan toolchain install leanprover/lean4:v4.34.0`) and run `bend laws/PROOF.bend --verdict`. Bend 2.0.40 builds and caches its bundled BendTT kernel on first use. You can also set `BENDTT` to a kernel built from the same release.
