# General sparse linear Q-learning

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

`agents/lib/linear.bend` accepts any observation data type and a pure feature
function `O -> List<&2,Feature>`. Each `Feature{id,value}` has a U32 identifier
and a signed F32 coefficient. The function is static code, archived with the
agent, not a callback serialized in a checkpoint. Instantiate
`L.act(~O,~features,...)` and `L.learn(~O,~features,...)` in an authored agent.
A test instantiates this interface with F32 observations, not only discrete IDs.

The included `agents/linear/agent.bend` uses a shared bias and one state indicator
indexed by the low 16 observation bits. This is an example, not an automatic
feature encoder. States outside that range can alias; replace `features` for
the problem at hand. Sparse feature IDs and action IDs both support all 32 bits.

### Exact arithmetic and policy

Q(s,a) is the right-associated F32 sum of feature value times weight, in the
authored list order. Duplicate IDs contribute every term. Update uses one
frozen error δ = reward + γ max_legal Q(next,a) − Q(s,chosen), then adds
αδ × feature value to each chosen-action weight sequentially left-to-right.
Repeated IDs therefore accumulate repeated increments. Floating-point
rounding can distinguish this from merging duplicates before updating.
Empty feature lists give zero predictions and no weight changes. No automatic
normalization, clipping, or finite-value filtering is applied to feature
outputs; authors must choose finite, appropriately scaled features and rates.

## Parameters

`alpha` (learning rate, 0.05), `gamma` (discount, 0.95) and `epsilon` (exploration, 0.125) are clamped to [0, 1]. Training exploration uses a 16-bit threshold and the existing mixed-word random-action helper. Evaluation selects the first maximal value in the supplied legal order. Domain separation does not imply statistical independence.

Weights reuse the existing immutable [weight tree](../../core/weights.bend). A full 32-bit action
path followed by a 32-bit feature path addresses a scalar in the row's left
slot; other slots are unused. This avoids aliasing arbitrary action IDs or
prefix collisions but costs up to 64 path nodes per touched pair before
sharing. It is a small-model baseline, not a high-throughput tensor library.
Model representation is new only for this custom agent; old archived agents
and checkpoints are unchanged. Semi-gradient off-policy Q-learning with
general features need not converge. The included plan is reproducible
comparison material, not evidence that shared features outperform tables.

## Episode ends

A terminal target has zero continuation. A truncated open state still bootstraps; there is no trajectory buffer to flush. An illegal action yields no transition update.

## Laws

The [four laws](laws.bend) cover scalar read-after-write, empty-gradient identity, no terminal bootstrap and greedy evaluation. The [proofs](proof.bend) do not establish convergence for arbitrary features or superiority to tabular Q-learning.

## Checks

The [Bend fixtures](checks.bend) cover signed and repeated features, empty features, full-width IDs, cross-action preservation, real observations, terminal/truncation targets and legal-order ties. The [Node integration test](checks.mjs) trains, verifies, replays and resumes a sealed run. From the repository root:

```sh
node --test agents/linear/checks.mjs
bend agents/linear/proof.bend --verdict
```

## Example plan

Run the [Cliff comparison](../../experiments/cliff-linear.json) from the repository root:

```sh
node experiment.mjs run experiments/cliff-linear.json runs/cliff-linear
```

On the shipped four-replicate, 128-episode study (Bend 2.0.40, Node 24.22.3),
all four linear final test means were −60, versus −6 for all four tabular
Q-learning replicates. Linear evaluation hit the 60-step limit; the table
reached the terminal in six steps. This deliberately reported failure shows
that the supplied shared-bias map and learning rate are not tuned for Cliff.
The library is useful for authoring and testing feature maps, not as a claim of
a better default learner.
