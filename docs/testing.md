# Testing

Run shell commands from the repository root.

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
