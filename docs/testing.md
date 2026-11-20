# Testing

## Set up a machine

Use a trusted checkout on Linux or macOS (x86-64 or ARM64). The bootstrap needs Bash, curl, tar, zstd, a SHA-256 utility, and Python 3.12 with working `venv`. On Ubuntu 24.04 the corresponding packages include `python3.12-venv` and `zstd`; on macOS install Python 3.12 and zstd before running the script. If the interpreter has a different path, set `BEND_SETUP_PYTHON` to the Python 3.12 executable. For Windows, use WSL or follow the Node-only job in CI.

From the repository root:

```sh
bash scripts/setup.sh
source .venv/bend-studio/env.sh
npm test
```

Setup installs and checks Bend 2.0.40, Node 24.22.3 and Lean 4.34.0 from checksum-pinned distributions. It prints the resolved versions, creates separate Gymnasium and Minari virtual environments from their existing lock files, and runs the locked MCP install with lifecycle scripts disabled. Run it again to reuse verified-version tools and reconcile packages with the locks. No global tool or shell profile is changed. The generated activation file applies to this checkout; source it in each new shell. The initial download includes the full Lean distribution and can take several minutes.

The [devcontainer](../.devcontainer/devcontainer.json) runs setup with the test extras when it opens. To match the fresh-runner CI job outside it, run:

```sh
bash scripts/setup.sh --with-test-extras
bash scripts/check-setup.sh
```

The extras install Node 24.22.1 alongside, not in place of, 24.22.3 for the cross-version archive fixture, and a separate locked Python environment for the MCP SVG fixture. The fresh setup job builds the same developer image and runs its post-create command in a clean container before checking for zero skips in both Node suites and testing the two adapter environments. The original Linux and Windows jobs still run, including archive gates and proofs as before.

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

After a passing `npm test` in a Git checkout, a guard reports untracked files
at the repository root. Move any intentional scratch output into an ignored
directory such as `runs/`. The Studio compiler fixture also checks that a
validation-only invocation writes nothing, including in source archives without Git.

The training-tie regression compiles the deployed policy paths and runs a
four-move, zero-exploration corridor. The prior policy completed 0 of 24
training episodes and 0 of 3 frozen evaluation episodes in that corridor.
The new policy completed all 24 training episodes and all three evaluations,
each reaching the goal in four moves. This isolates first-action bias; it does
not establish how much the change helps on other worlds. A fixed-word
frequency check covers the three-way tie and exercises the incomplete-bucket
retry. The flagship v1 and historical demo checks retain their original pins.
The fixed legacy benchmark keeps the original training policy and CSV hash.

A green Windows job means the Node-only workflow passed. It does **not** mean Bend, Lean, the compiled backend hash checks, Gymnasium or Minari ran on Windows. For the quick local smoke test use `npm test`; for a change to archive layout, learner semantics or Python integration, run the matching row above as well.

The [Bend upgrade watch](upgrading-bend.md) is a separate weekly/manual check against the latest official 2.x version. It does not replace any pinned job, and its results are never required for a merge.

### Running individual checks

Run `node --test checks/scaffold_checks.mjs` for starter validity, no-clobber
behavior, seeded sweep determinism, compiled multi-arm screening, halving and held-out-data rejection. With
pinned Lean available, `BEND_CHECK_SCAFFOLD_VERDICT=1 node --test checks/scaffold_checks.mjs`
also proves the generated placeholder law independently; Linux CI runs it in
the BendTT step. MCP stdio covers workspace-only authoring and sweep paths.

The Linux workflow also runs `node checks/flagship_slice.mjs` to reproduce two original first-checkpoint files from the [flagship study](../studies/flagship-toy-text/README.md). This checks the exact byte hashes under the pinned runner, not training quality or reproduction of every row. For G2/G3, the [additive fixture](../tools/archive-gates/n9-flagship-plan.json) also pins the new manifest and full source/bundle identities without replacing the historical baselines. The [flagship v2 study](../studies/flagship-toy-text-v2/README.md) has its own additive archive pin and a separate `node checks/flagship_v2_slice.mjs` job step. It checks two exact checkpoint hashes after 64 episodes. Neither slice is a claim that every artifact was reproduced in hosted CI.

The [post-fix challenge and Kart results](../studies/complex-worlds/tie-breaking-fix/README.md)
include a separate local archive check. Its read-only collection stage verifies
the four sealed runs, replays no training, and recomputes the checked-in
challenge summaries, exact Storm values, and Kart frozen-policy results. This
is not a full retraining step in hosted CI.

| Local command or guide | Coverage and CI step |
| --- | --- |
| `node checks/docs_check.mjs`; `node --test checks/docs_inventory.test.mjs checks/docs_markdown.test.mjs` | Link targets, headings, executable paths, source counts and negative fixtures. Root Node tests. |
| `node --test checks/experiment_checks.mjs checks/batch_checks.mjs studio/studio_checks.mjs` | Checkpoints, resume/replay, selection/assessment, offline partitions and Studio workflows. Root Node tests. |
| `node --test checks/legacy_examples.test.mjs agents/linear/checks.mjs` | Fixed two-door demo output, the 100-row legacy benchmark CSV hash, and linear learning/replay. Root Node tests, compiler-dependent. |
| `node --test checks/oracle_checks.mjs checks/memory_checks.mjs checks/statistics_checks.mjs` | Oracle values and memory-world regeneration (also executable directly); Python suite-statistics and replicate-planning regressions through a Node wrapper. Root Node tests. |
| `node --test worlds/benchmarks/probes/checks.mjs tools/finite-layout/packed-checks.mjs` | Regenerate authored probes; compare packed/expanded storage, partial episodes and replay. Root Node tests. |
| `python3 -m unittest checks.test_replicates` | Paired precision planning, exact sign-power checks and export/seed validation. Also run through the root Node suite. |
| `python3 -m unittest checks.test_multiple_comparisons checks.test_suite_stats` | Multiplicity adjustments, paired bootstrap and statistical CLI behavior. Linux statistical comparisons step. |
| `node experiment.mjs run experiments/two-pile-nim.json runs/nim`, then `node checks/nim_checks.mjs runs/nim` | Exact independent checks for all nine starting pile pairs. Linux Nim step. |
| `node experiment.mjs run experiments/self-play.json runs/self-play --until 128`, then `node checks/arena_checks.mjs runs/self-play` | Exact physical-coordinate checks for both tic-tac-toe encodings, plus minimax and self-play update checks. Linux self-play step. |
| [Each learner’s checks and proof](laws.md#formal-properties) | Run the commands in its README, e.g. `bend agents/sarsa/checks.bend` and `bend agents/sarsa/proof.bend --verdict`. Linux Bend and BendTT steps. |
| `node tools/archive-gates.mjs check tools/archive-gates/m0-exceptions.json`; `node tools/archive-gates.mjs check-backends` | Exact permitted source/bundle hashes and representative compiled backend hashes. For the Linux historical-archive step, use the [hosted harness](../tools/archive-gates/g4-hosted.sh) with full Git history, pinned Node/Bend and MCP dependencies, not just a copied source tree. |
| In the [MCP package](../mcp/README.md), run `npm ci --ignore-scripts`, then `npm test`. | Protocol, workspace boundaries, workflow, compiler, inspection, lifecycle and optional-tool fixtures. Both MCP jobs. |
| Follow the [Gymnasium](../integrations/gymnasium/README.md) or [Minari](../integrations/minari/README.md) environment instructions and run that adapter’s unittest command. | The corresponding optional Python integration step on Linux. Neither dependency belongs to the root install. |
| Follow the [MLflow guide](../integrations/mlflow/README.md). | Optional isolated tracking-client test on Linux; a real local file-store round trip compares metric histories with the learning-curve plotter. |

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

See [the experiment guide’s keyed archive comparison](experiments.md#compare-keyed-tabular-training-against-list-backed-archives).

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


## Studio browser smoke

With the normal pinned Node and Bend tools on PATH, run this isolated Playwright harness:

```sh
cd tools/studio-smoke
npm ci --ignore-scripts
PLAYWRIGHT_BROWSERS_PATH=0 npx --no-install playwright install --no-shell chromium
PLAYWRIGHT_BROWSERS_PATH=0 npm test
```

The Linux job installs browser prerequisites on its fresh runner. The smoke test starts a loopback Studio with a temporary home, selects and trains a multi-world manifest, verifies the planned hook types, dismisses and reopens the replay picker, checks the expected rendered grid colors, and fails on console or script errors or page overflow at 390 px. Studio's root Node tests separately cover manifest/source confinement, FIFO crash recovery, and generated sidecar identity.

## Generated properties and boundary checks

Root `npm test` runs 64 reproducible cases per domain for manifest validation, finite-world normalization including authored grids, memory-world product rules, Cassandra sparse POMDP export/reparse, and MCP workspace path confinement. The path cases use only owned temporary test fixtures and check both allowed destinations and rejected sibling paths. The direct CLI prints the seed and the failing case, and can run larger campaigns.

```sh
node checks/seeded_properties.mjs --seed 23 --cases 1000
node --test checks/layout_logging_checks.mjs
bend laws/PROOF.bend --verdict
```

With Bend installed, the second command compiles literal and packed versions of the same generated worlds, checks every 16-bit draw for sampled logging policies, and compares chunked and direct episode reports for both completion hook types. These cases complement the independent proof verdict, which the pinned workflow and advisory Bend watch both run. See [the proof boundaries](laws.md#phase-9-proof-boundaries) for what is formal and what is empirical.

## Formatting JavaScript

Run this from the repository root using the pinned Node version:

```sh
npm --prefix tools/format ci --ignore-scripts
npm --prefix tools/format run check
npm --prefix tools/format run write
```

The isolated Prettier 3.6.2 package has no effect on the root or runtime
dependencies. It checks Git-tracked .js and .mjs files under studio, mcp,
analysis, tools, checks, offline, integrations and benchmarks. Stage new
files before formatting so they enter the Git inventory. The formatter skips
dependency directories, vendored/generated sources and documentation checker
fixtures. Python, Bend, third-party data, core, agents and worlds are not
formatted. To compare syntax trees and formatter idempotence, run
`npm --prefix tools/format run audit`. The Linux CI check never rewrites files.

## Acrobot and matrix games

```sh
node --test checks/acrobot.test.mjs checks/matrix_solver.test.mjs checks/matrix_world.test.mjs
node tools/matrix-games/generate.mjs --check
```

The root suite checks 21 Acrobot reference steps with independently written double-precision dynamics, wrapping/clamps, seeded reset and terminal rewards. To add the independent upstream implementation as a cross-check, set `BEND_ACROBOT_GYM_PYTHON` to the existing pinned Gymnasium virtual environment's Python and rerun the Acrobot case. The mobile Studio smoke checks pixels from a real trained Acrobot replay as well as the finite grid.

Matrix tests check exact closed forms, reconstruct the generated files, verify the live Bend run, and confirm that both seats see an identical precommitment observation independent of the private action. They check the revealed pair, payoff and empirical exploitability on archived validation rolls. The archive gates separately pin the new plan identities without changing older fingerprints.

## Tied-policy evaluation

The compiler-backed suite in [checks/exact_evaluation.test.mjs](../checks/exact_evaluation.test.mjs)
compares actual Evaluate-mode rollouts with frozen values, decision explanations,
preferred actions in trajectory logging, exact off-policy target scoring, and
arena cross-play on tied values. It checks the ordered first-maximum contract
rather than assuming that an oracle-optimal action is the learner's chosen action.

## MCP finite-world session parity

Run `node --test mcp/environment.test.mjs` after installing the MCP package to
test public views, capacity/lifetime and confinement. With pinned Bend on PATH
the same suite plays 24 stochastic literal and packed episodes by submitting
their replayed action sequences and compares every public frame exactly.
