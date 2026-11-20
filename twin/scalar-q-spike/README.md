# P11.8 scalar kernels: fixed pthread correctness

**Status: byte parity on fourteen bounded plans with 1, 2, or 4 native workers
and two build targets.** The kernels are still scalar. This is
a bounded parity harness against the reference checkout `62decf6`, not a
production engine, an archive writer, a performance claim, or equivalence for
the complete P11.8 arm panel. No production files or core hashes change here.

The [Dry Lake diagnostic](bench/README.md) records the separate `-O3`
correctness gate and five bounded timing rounds on an unchanged P11.0 cell.

It accepts a stock, trusted, verified archive of one normalized finite JSON
(or normalized grid) world, one built-in Q-learning, Expected SARSA, Double Q,
Uniform, or Dyna-Q arm, current public observations, and whole-episode
checkpoints. Finite source lookup may be literal or packed. It rejects
multiple worlds or arms, hidden-history encodings, step budgets, more than
25 Dyna planning steps per move, custom hooks, source-native worlds, and
large diagnostic plans. The bounds and explicit stream size limit are for this
witness only. If a bound fails it writes no archive. Never run the binary
or import a backend from a source you do not control.

The hosted Linux diagnostic reuses the pinned Bend, Node and Lean toolchain
to build only the tiny literal Q-learning fixture. It generates and verifies a
fresh stock archive before compiling the witness, then compares all 12 complete
checkpoint files using two native workers if glibc reports a usable x86-64-v3
CPU. If that capability is absent, the job records build success only and
reports that runtime parity was not tested. A parity mismatch on supported
hardware fails the job. This smoke does not benchmark anything, change the
engine, or write native archives.

## Exact transaction

1. Generate C constants from the **validated** plan, not from a second
   implementation of the schema. Preserve per-state legal order and use the
   stock BigInt distribution bucket function. Reindex physical state IDs to
   dense destination rows, but keep the full public observation and action
   IDs for the learner. Alias states may have different ordered legal
   actions while sharing the same Q entries.
2. Reset uses `mix(episodeSeed XOR 3266489917)` for the initial outcome.
   Initial policy raw word is `LCG(episodeSeed)`; mix that with XOR
   1515870810 for policy. World uses the **next** raw word with XOR
   2779096485. Advance once more for the next decision, even for deterministic
   world transitions. Train exploration compares low 16 bits against the
   effective bucket count and uses XOR 2654435769 for the sampled action.
   Training ties use exact equality, original legal order, XOR 2246822519
   and the bounded rejection stream. Those retry words do not consume
   episode LCG advances. Evaluate chooses the first exact maximum, no
   model updates. The right fold's winning value, including signed zero,
   is also the Q bootstrap value on the next open view. Double Q acts
   on the F32 sum of two estimators with the same selection rules. Uniform
   uses modulo of the original mixed policy word in every phase, without
   exploration remixes, greedy tie draws, or learning.
3. At reset, a terminal state consumes zero steps and has zero score.
   At the last allowed move, inspect and learn from its destination before
   choosing the stop reason. A terminal destination wins over the limit.
   An open destination still bootstraps for all four learning methods. Illegal
   selection is unreachable in the eligible learner (the native sampler
   always chooses an element of the exact legal list).
4. Preserve F32 operation order: `target = add(reward, mul(gamma, max))`;
   `q' = add(q, mul(alpha, sub(target, q)))`; score accumulates once per
   accepted move. Expected SARSA uses the stock right-fold F32 legal-action
   sum and effective epsilon buckets. Its divisions use binary64 divide
   followed by rounding to F32 as in the compiled Bend JavaScript. For Double Q,
   initialize the independent update-side cursor as
   `mix(replicateTrainSeed XOR 374761393)`. For each accepted training move,
   update left when the low bit of `mix(cursor)` is zero and right otherwise;
   advance the cursor once with LCG. For an open destination, choose the
   first maximal legal action in **the update-side table**, then look up its
   value in **the opposite table**. This is distinct from the sum policy's
   training tie rule. A reset or evaluation does not advance the private
   cursor. Do not use FMA, fast math or flush-to-zero. Inputs/outputs
   travel as raw U32 bit patterns. Unsupported floating-point environment
   or nonfinite score/model triggers failure. This deterministic proof
   boundary does not use transcendental primitives or claim CUDA parity.
5. For Dyna-Q, first apply the real Q update, then append or increment the
   empirical model, then perform the configured number of planning
   updates. Pair keys are public `(observation, action)` in first-seen order.
   Within each pair, samples keep first-seen order and match the whole
   public next view: Open/End tag, observation, and ordered legal actions.
   Physically different states can merge; two different legal orders,
   or Open versus End, must not. On a match update count and
   `mean + (reward - mean) / newCount` in stock F32 order. This mirrors the
   ordered model-word boundary checked separately in the P11.6 CPU spike;
   its fixed workload and outcomes are not used as the reference here.
6. Dyna initializes its private planning cursor with
   `mix(replicateTrainSeed XOR 1274126177)`. Each planning draw mixes that
   cursor, takes modulo the known pair count, backs up that pair's **whole**
   empirical distribution by a right fold of
   `count * (meanReward + gamma * maxNextQ)` beginning at F32 +0, divides
   by the pair total, adjusts the indexed Q tree, then advances the LCG
   once. Each backup sees current Q, including prior backups from the
   same move. Zero-planning still retains real experience and the real
   update, but never advances the planning cursor. No reset or evaluation
   updates it. Terminal and open-at-limit moves both enter experience,
   and only an actual End has zero continuation by stop type.
7. Preserve visits modulo U32 and the stock insertion-shaped digital tree.
   It keeps the first visited key at root and chooses subsequent edges
   by alternating low observation and action bits. Indices are fields on
   an implementation-local flat node array; they are never archived.
   The verifier rebuilds tagged `Nil` / `Con`,
   `Indexed`, `Node`, `Cell`, and `Vacant` with stock settings. Double Q
   reconstructs both independent trees and the live cursor in stock
   `DoubleAgent / Tables` fields; Uniform remains `Agent / Nil`. Dyna
   reconstructs `PlanningAgent / Planner`, with indexed tree, ordered
   `PairModel` and `Sample` lists, counts and private cursor. Its C wire
   uses the representative destination row, not as an archive ID: the
   verifier expands it to precisely the stock public `End` or `Open`.
   Rebuilding from keys sorted by observation would generally give different bytes.
8. Return ordered score/steps/stop reports, not C-computed checkpoint
   statistics. In JS call the original binary64 `record()` reducer in
   training/evaluation seed order, including test only at the final
   checkpoint. Preserve signed zero when decoding and use stock `seal()`
   with the **same existing Bend manifest** and chain links. Compare the
   complete bytes, including the model, stats and envelope, against each
   reference checkpoint. The verifier does not write a new sealed/native
   archive. This first scalar study does not test native resume.

The first fixture episode deliberately exercises an otherwise rare
3-way greedy rejection: train seed 3188627573 yields reset word
1249989579 and mixed policy word 2246822519. That is outside epsilon's
16,384 buckets. The first tie draw is zero and must be rejected (threshold
1), the next is 3692859089, so the first visited action is ID 3 (legal rank
2). A shortcut accepting draw zero would visit the wrong key first. In
Double Q, the initial private cursor is 54066933; its mixed word is odd,
so that first action must be the root of the **right** table. Both layouts
also cover non-power-of-two distributions, state aliases, unsorted legal
IDs including UINT32_MAX, negative-zero reward bits, a terminal reset,
high evaluation seeds, and open-at-limit transitions. The packed fixture
adds unused terminal rows to cross the real packing gate without changing
the reachable task. The Dyna variant makes a single pair encounter an End
and multiple Open views with the same observation, including two equal-sized
lists with opposite legal action order.

## Reproduce the serial correctness check

Use the trusted `62decf6`-based checkout with Node 24.22.3, Bend 2.0.40,
and Clang 22.1.4. This used the existing Clang bundled with Lean 4.34.0.
It ships the standard C headers but not the SIMD intrinsic header,
so the scalar floating-point mode check reads MXCSR directly. On an
actual Zen 3 machine, add `znver3` to the target array to reproduce the
separate local check. This is not a benchmark.

```sh
spike=twin/scalar-q-spike
scratch=$(mktemp -d)
: "${LEAN_CLANG:?set to the pinned Clang 22.1.4 executable}"
clang="$LEAN_CLANG"
export C_INCLUDE_PATH="${clang%/bin/clang}/include/clang"
targets=(x86-64-v3) # Add znver3 only on a compatible local machine.
run_case() {
  key=$1
  node experiment.mjs run "$scratch/$key.json" "$scratch/$key-run"
  node experiment.mjs verify "$scratch/$key-run"
  node "$spike/parity.mjs" generate "$scratch/$key-run" "$scratch/$key.c"
  for arch in "${targets[@]}"; do
    "$clang" -std=c11 -O2 -Wall -Wextra -Werror -march="$arch" \
      -ffp-contract=off -fno-fast-math -pthread \
      "$scratch/$key.c" -lm -o "$scratch/$key-$arch"
    for workers in 1 2 4; do
      node "$spike/parity.mjs" check "$scratch/$key-run" "$scratch/$key-$arch" "$workers"
    done
  done
}
for learner in q_learning expected_sarsa double_q random dyna_q; do
  for layout in literal packed; do
    key="$learner-$layout"
    node "$spike/parity.mjs" fixture "$scratch/$key.json" "$layout" "$learner"
    run_case "$key"
  done
done
node --input-type=module - "$scratch/bridge.json" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const p = JSON.parse(fs.readFileSync('experiments/bridge.json', 'utf8'));
p.name = 'p118-independent-bridge';
p.games[0].file = path.resolve('worlds/bridge.json');
p.arms = [{id: 'expected', method: 'expected_sarsa', epsilon: 0.375, alpha: 0.3125, gamma: 0.96875}];
fs.writeFileSync(process.argv[2], JSON.stringify(p, null, 2) + '\n', {flag: 'wx'});
JS
run_case bridge
node --input-type=module - "$scratch/slippery.json" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const p = {
  schema: 1, name: 'p118-independent-slippery-detour',
  games: [{id: 'slippery-detour', file: path.resolve('worlds/slippery-detour.json'), limit: 24}],
  arms: [{id: 'double', method: 'double_q', epsilon: 0.30, alpha: 0.4375, gamma: 0.9375}],
  replicates: 6, checkpoints: [0,1,33,192], validationEpisodes: 24, testEpisodes: 32,
  seeds: {train: 19283100, validation: 52718423, test: 2293186225, stride: 512},
};
fs.writeFileSync(process.argv[2], JSON.stringify(p, null, 2) + '\n', {flag: 'wx'});
JS
run_case slippery
node --input-type=module - "$scratch" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {numberPreservingJson} from './core/finite_world.mjs';
const directory = process.argv[2];
const zero = JSON.parse(fs.readFileSync(path.join(directory, 'dyna_q-literal.json'), 'utf8'));
zero.name += '-zero';
zero.arms[0].planningSteps = 0;
fs.writeFileSync(path.join(directory, 'dyna-zero.json'), numberPreservingJson(zero, 2) + '\n', {flag: 'wx'});
const p = {
  schema: 1, name: 'p118-independent-reward-cue',
  games: [{id: 'reward-cue', file: path.resolve('worlds/reward-cue.json'), limit: 2}],
  arms: [{id: 'dyna', method: 'dyna_q', planningSteps: 5, epsilon: 0.125, alpha: 0.25, gamma: 0.95}],
  replicates: 4, checkpoints: [0,1,16,65], validationEpisodes: 16, testEpisodes: 24,
  seeds: {train: 181024139, validation: 1700037019, test: 2600281001, stride: 512},
};
fs.writeFileSync(path.join(directory, 'reward-cue.json'), JSON.stringify(p, null, 2) + '\n', {flag: 'wx'});
JS
run_case dyna-zero
run_case reward-cue
```

The generator consumes a stock normalized finite plan, with no fixture names
or independent world constants in the C kernel. Only the rare-tie replay
assertion on artificial fixtures uses their identity. Separate refusal checks
rejected step budgets, previous observation, an unsupported learner,
oversized planning counts, extra evaluation worlds, extra arms, oversized
evaluation counts, and an unknown field. No rejected input wrote candidate C.

## Verified evidence

Both builds used Clang 22.1.4 with FMA contraction and fast math disabled.
Each compared against **the same** stock archive for that plan, including
all 196 checkpoints frozen by scalar commit `7884568` with unchanged archive
seals, backend and trial-set hashes. The table's counts apply independently
to each of 1, 2, or 4 workers. The trial-set digest is
SHA-256 over each sorted archive-relative checkpoint filename, a NUL byte,
and its file bytes. The generic target was compiled and run locally, not
run in hosted CI.

| Plan | x86-64-v3 matches | Local znver3 matches | Stock trial-set SHA-256 |
| --- | ---: | ---: | --- |
| Q, literal | 12/12 | 12/12 | `78e3b9aa4d0ad4b32d3dc7c5439e9dc1f7cb95c82fe36bd4c9410f89360518dc` |
| Q, packed | 12/12 | 12/12 | `02847d24fbda7df9805104ad242d92a5b74c1690555832d8b604225d9eafdd18` |
| Expected SARSA, literal | 12/12 | 12/12 | `abd2fef9b8f7a496f7d51a89fafcf7375258e992eeea38d193e0f868e2092ba4` |
| Expected SARSA, packed | 12/12 | 12/12 | `9a6c5a8a3f3e505424b8744fb51c0157da2eab213d3ce3ce3d85282cd0432f2a` |
| Expected SARSA, independent Bridge | 24/24 | 24/24 | `66646ca3d30de658b7dcb6862da0e6b5d19dc7b49f8aea8cd8f3af776e05ba15` |
| Double Q, literal | 12/12 | 12/12 | `b9bc3b2a376b103426098cb20e4a0fbe9ff7d39e19a6f6ac065c85f601c4b885` |
| Double Q, packed | 12/12 | 12/12 | `33ecaaf35c2797b9b608604c0221ecf7c7792be4ed7bffa847c3d65a0e4a16bc` |
| Double Q, held independent Slippery Detour | 24/24 | 24/24 | `b21939f23152b0dedcbdfe1016ba492b9fb271248076547910bbc0720a5512bf` |
| Uniform, literal | 12/12 | 12/12 | `de3687c6942440f159478de942ed5c39c30805e35c4774e7d386ecad79574364` |
| Uniform, packed | 12/12 | 12/12 | `7f13e529efff46529ce7734242fa5b0307eaee9ef29db48eeaad77669353ee29` |
| Dyna-Q (5 planning updates), literal | 12/12 | 12/12 | `b360d67353df92975c54fde2d275bc90ee17c3b97b45e44c1307e52b46b6b173` |
| Dyna-Q (5 planning updates), packed | 12/12 | 12/12 | `6e011e8ec029a2d3e585f6214eafed3f2cf4b91598e04c4a97c9ef1604c52c61` |
| Dyna-Q (0 planning updates), literal | 12/12 | 12/12 | `b77ba7b9d8c336bac3a9f8577dcdaae966d17d5fd847b4c247d6f043066eac72` |
| Dyna-Q (5 planning updates), held independent Reward Cue | 16/16 | 16/16 | `a05b5a10e2070db1c201aa29374ec9fb0d19e0d0b09bc6778bbc41907b36ea67` |
| **Total** | **196/196** | **196/196** | |

Slippery Detour is a shipped stochastic grid unrelated to the engineered
rounding/RNG fixture and was selected before running its expanded matrix.
For Dyna, shipped Reward Cue was selected before running the next expansion.
At final checkpoint 65, replicate 0, its `(99,0)` pair merges two physical
destinations and rewards into one public `Open(10,[1,2])` sample, count 65,
F32 mean 0.5538462400436401. The two engineered Dyna layouts both retain
the order-only differences and the End at the aliased observation in
replicate 0, checkpoint 31. Across all Dyna checkpoints, the experience
counts sum to accepted moves, tree visits sum to real plus planned updates,
and the archived private cursor is its initial value advanced by exactly
the number of planning draws.
On the engineered learning cases, actual archived training replays and native-derived
trees still pick action 3 first under the deliberately rare rejected draw.
The frozen scalar negative checks each changed one site in generated C, compiled with
the same generic target and left the plan digest and stock archive unchanged:

| Deliberate change | First rejection |
| --- | --- |
| Q accepts the first low-tail tie draw rather than retrying | Rep 0, checkpoint 1, `model` |
| Expected SARSA uses the Q max bootstrap | Rep 0, checkpoint 7, `model` |
| Double Q stops advancing the private cursor | Rep 0, checkpoint 1, `model` |
| Double Q reads continuation value from the update table | Rep 0, checkpoint 7, `model` |
| Uniform remixes its policy word with the exploration domain | Rep 0, checkpoint 0, `validation` |
| Dyna identifies an outcome by physical state | Rep 0, checkpoint 16, `model` (Reward Cue) |
| Dyna ignores legal order in Open views | Rep 0, checkpoint 31, `model` |
| Dyna merges Open and End with the same observation | Rep 0, checkpoint 7, `model` |
| Dyna folds the empirical samples in the opposite order | Rep 0, checkpoint 31, `model` |
| Dyna samples a planning pair from the raw, not mixed, cursor | Rep 0, checkpoint 1, `model` |
| Dyna suppresses the real update's bootstrap on an open limit | Rep 0, checkpoint 7, `model` (zero planning) |

These controls distinguish specific policy, backup, and RNG errors from
matching final scores. No native archive was written.

## Pthread witness

One process starts a fixed cohort of 1, 2, or 4 pthreads. Worker `i`
handles the strided replicate indices `i, i + workers, ...`; each replicate's
seeds, private learner and phase order are unchanged. Workers share only
immutable plan input and do not share a learner or output stream. The
parent joins every worker, checks every replicate result is present, then
emits the plan hash followed by complete replicate streams in ascending
order. The JS reducer and checkpoint comparison are unchanged.

Each worker has a 1 MiB stack, with a compile-time limit of half that for
the learner, and checks the required floating-point mode. The output
slots use a static slab with at most 16 MiB for bytes across the plan
including the plan hash, divided evenly among the replicates. An
oversized replicate fails closed even if another slot has unused space.
No intermediate output files or partially ordered success streams are
written by workers. This is a diagnostic memory bound, not an archive
format or process-pool contract.

The 196 distinct checkpoints matched in each of six combinations
(1/2/4 workers, two compiler targets), for 1,176 full-file comparisons.
Raw streams in every combination also matched the corresponding frozen
scalar executable byte-for-byte, including a fresh 4-worker rerun on
each plan and target (112 raw stream comparisons). A test-only condition
variable forced replicate 1 to finish before 0 for Dyna with 2 and 4
workers; exact sorted output still matched.

Tests that reversed merge order or accidentally reused replicate 0's RNG
seed for replicate 1 were rejected by coordinate and model checks
respectively. Tiny output bounds, missing replicate output, an unsupported
worker floating-point mode, and invalid worker counts all failed with
no stdout. The tests used one pinned logical CPU, explicit memory and
time ceilings, and neither hosted CI nor performance measurements.

## Beyond this reference

### Select a bounded cell range without changing the parent seal

The default `generate`/`check` still require a whole one-world/one-arm
diagnostic plan. The read-only `generate-cell`/`check-cell` commands instead
select explicit IDs and at most eight contiguous replicates in an existing,
trusted mixed parent. Use `COUNT` for a prefix starting at zero, or
`START:COUNT` for a zero-based range. They retain the parent's game, arm
settings, original seed for each selected replicate and phase, checkpoint
list, phase counts and all other applicable witness bounds. As before,
step budgets, transfer worlds, history and other unsupported selections
are refused.

The numerical projection is an internal work descriptor only. Its wire
identity includes the original manifest seal, both cell IDs, the ordered
replicate IDs, and the exact numerical input. For each local slot the
descriptor checks the stock `seedOf` result against the corresponding
original replicate for training, validation and test. Native wire rows
carry compact local slots; the verifier maps them to exact parent replicate
IDs before composing any sealed checkpoint. The verifier first verifies
the untouched stock archive. It derives each candidate chain from
checkpoint zero by sealing complete candidate bodies in memory with
the **original** manifest hash and preceding candidate link, and compares
the complete bytes at their original paths. No projected manifest or
archive is created. C output must be placed outside the parent archive.

For the original stock flagship v2 archive, set
`FLAGSHIP_ARCHIVE` to the trusted complete run with manifest seal
`a5b41470bbe999d26d9919087156c5b62078ecae52c634757addd29e5ea36a43`.
Use the pinned toolchain and C headers from the reproduction above:

```sh
spike=twin/scalar-q-spike
scratch=$(mktemp -d)
for range in 8 8:2; do
  name="cell-${range//:/-}"
  node "$spike/parity.mjs" generate-cell "$FLAGSHIP_ARCHIVE" \
    lake4-dry double_q "$range" "$scratch/$name.c"
  for arch in x86-64-v3 znver3; do # Use znver3 only on compatible hardware.
    "$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march="$arch" \
      -ffp-contract=off -fno-fast-math -pthread "$scratch/$name.c" \
      -lm -o "$scratch/$name-$arch"
    for workers in 1 2 4; do
      node "$spike/parity.mjs" check-cell "$FLAGSHIP_ARCHIVE" \
        lake4-dry double_q "$range" "$scratch/$name-$arch" "$workers"
    done
  done
done
```

On CPU 8, both targets matched 72 original checkpoint files at reps 0–7
and 18 at reps 8–9 in each 1/2/4-worker configuration. The two disjoint
ranges cover **90 distinct files of one Dry Lake Double Q cell** (540
comparisons), not the remaining cells or the whole flagship. The frozen
prefix C was unchanged, and all six runs within each range emitted the
same wire bytes:

| Archive replicates | Wire SHA-256 |
| --- | --- |
| 0–7 | `5e7994222835a31b2a2f2de59e2403872869936c3e0e83aaab7a93ce230fd80a` |
| 8–9 | `a031c3201a0477294041d44fe8af20f5fd3421f83b4ea9f4fce2221e22882335` |

An independent audit of emitted C verified the unchanged phase lengths,
checkpoints, seed stride and these original phase seed bases:

| Original replicate | Train | Validation | Test |
| ---: | ---: | ---: | ---: |
| 8 | 150580000 | 1905080000 | 2945080000 |
| 9 | 150590000 | 1905090000 | 2945090000 |

The original stock verifier passed all 3,600 archived checkpoint files;
an independent relative-path, file-size and SHA-256 inventory showed
that every file in the stock archive was unchanged by the check. The
comparator rejected the previously compiled P11.0 binary from another
seal, the wrong game ID, a nine-replicate request, a C destination inside
the parent, and Courier's step-budget manifest. For the second range it
also rejected a range beyond the parent, a wire submitted for a different
range, and an altered training seed (replicate 8 checkpoint zero model).
The original one-cell
P11.0 generated source and its 27-file check were unchanged. This is
correctness-only, not production archive, timing, replay or resume coverage.

The [separate preregistered gate](flagship-v2-gate.json) also selected
the original `q_learning` and `dyna_q` arms on `lake4-slip` under the
same parent seal. Reuse the command above with that game ID and each of
those arm IDs, with the same ranges and compiler flags.
No numerical kernel, output limit or selection implementation changed.
Each cell matched 90 distinct original files (72 plus 18) in each of six
build/worker configurations. All original phase seeds, phase lengths
and horizons were also checked against the generated C. Raw wires agreed
within each batch across both builds and all worker modes:

| Stock cell | Archive replicates | Wire SHA-256 |
| --- | --- | --- |
| lake4-slip / Q-learning | 0–7 | `ff00f68f2e6039990897f3c63592511f9e770dda23bfe64c6c9cd22457867d9d` |
| lake4-slip / Q-learning | 8–9 | `89a8e13c6c1508a53937272015a0705323bbf341d0735299bc75a081fddcf9bb` |
| lake4-slip / Dyna-Q | 0–7 | `5c9b1ff2f0fd624faa6716f37a7a8d400ebaf737b688ae254397435d6f16a821` |
| lake4-slip / Dyna-Q | 8–9 | `3860d27d6a59114822ed81bf46e609796d8e175e21c8d0bd044cabb18eb0c1e0` |

The full original archive inventory matched before and after both
new cell checks. Together with Dry Lake Double Q, this proves exact
checkpoint comparison for **three original cells**: 270 distinct files
and 1,620 comparisons. The other flagship cells, native archive
production, historical replay/resume and hosted native CI remain out
of this result.

### Remaining work

* The bounded matrix covers all five specified built-ins, not the full
  shipped plan panel. For Dyna, a faster lookup may not alter the first-seen
  pair/sample order, duplicate identity or per-backup F32 right fold.
* Compare all eligible shipped worlds/plans with stock snapshots before
  introducing a dense fast table. A dense representation must still record
  the first-visit order and replay exact insertion on export. Preserve a
  scalar path for all lane-divergence, RNG rejection and signed-zero tests
  before AVX2 populations or threads. Masked lanes must not advance RNGs,
  visits or episode counters; serialize each independent trial in stock
  order. Test one thread versus many and generic x86-64-v3 versus local Zen 3
  with the same explicit float flags.
* A production integration must produce ordinary sealed checkpoints that
  verify and replay via the archived Bend runtime, including historical
  attach/replay/resume and real native interruption/cancellation. A new
  wrapper should not change the specified archive identity or invent novel
  seal logic. Parity includes all phase metrics, not just a score or a
  model digest. Quantify end-to-end including backend generation and transfer
  on the locked P11.0 workloads with five repeats, no regression and measured
  speedup before adoption. The RTX transcendental mismatch is not waived
  by this finite-scope witness.
* This pool establishes ordered independent work, not Level-4 performance.
  Before timing, use a separately reserved CPU window and pin to distinct
  physical cores without competing work. Predeclare the workloads, seed
  panel, worker counts and comparison against the best stock configuration.
  In addition to hot training, measure cold code generation/compilation,
  launch/stream/merge, and the end-to-end archive and evaluation path with
  at least five runs per comparison. Verify same bytes and report memory
  and failure behavior before considering adoption. AVX2 lane parity,
  multi-core contention, and historical resume remain untested.
