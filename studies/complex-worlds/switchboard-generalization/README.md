# Switchboard: learning on cue patterns never seen in training

The earlier [memory-capacity study](../memory-capacity/README.md) showed that
tabular Q-learning struggles to use all 16 remembered cues because there are
1,048,576 distinct query observations. Here a small opt-in feature adapter
keeps the full public memory and uses the existing sparse linear Q learner
to share experience across cue patterns.

## What changes

The agent receives the **same public observations** as tabular Q and does not
receive the correct cue or answer as a separate observation. At a query it
represents that query using one bias and **all 16 signed public cue bits**.
Each query/action has its own linear weights. Nothing in the agent says which
cue is relevant or whether it should be inverted. Learning uses the ordinary
chosen-action TD error and the game's terminal reward of +1 or −1. The adapter stores
no features on a cue frame: the only legal action is Continue. The
query-only control keeps the same linear learner and removes the bits. Both
linear arms normalize their learning rate by the number of unit features.

The [published direct world](../../../worlds/challenges/switchboard/switchboard.bend)
is paired with a [remapped world](remapped.bend) that emits identical public
observations, cue patterns and legal actions. It changes only the final
reward rule, to a different cue for every query and the opposite label for
half the queries. Knowing the original mapping would not solve that control.

## What happened

| World | Training episodes | Tabular exact accuracy | Linear exact accuracy | Linear accuracy on never-seen contexts |
| --- | ---: | ---: | ---: | ---: |
| Direct | 128 | 50.006% | 76.25% | 76.25% |
| Direct | 512 | 50.024% | 94.41% | 94.41% |
| Direct | 2,048 | 50.098% | 99.997% | 99.997% |
| Remapped | 128 | 50.006% | 76.18% | 76.18% |
| Remapped | 512 | 50.024% | 93.71% | 93.71% |
| Remapped | 2,048 | 50.097% | 99.999% | 99.999% |

After 512 episodes, each fit had seen about 512 of 1,048,576 possible
query observations, less than 0.05%. At 8,192 episodes, all eight linear
fits per world answered every context correctly, including the roughly
99.22% of contexts unseen in training. With 1,024 fresh test episodes per
fit, both controls still averaged roughly chance while every linear fit scored
100%. Query-only is exactly 50% under each full model at every budget.
Testing a final linear policy on the **other** answer rule gives exactly
50%. It learned each mapping separately; it did not learn to transfer.

The [aggregate results](results.json) record all budgets, ranges, coverage,
paired descriptive t intervals, held-out scores and archive sizes. The
unit of comparison is one trained model: eight matched seeds per world.
Exact scores count every mask/query pair once under the uniform world model,
not every possible 32-bit pseudorandom seed. The scorer reconstructs the
rounded F32 action scores from sparse weights and checks them against the
compiled policy on 46,080 observations; 384 compiled trajectories check
the seeded context generator and reward mapping.

This demonstrates generalization to unseen cue patterns **within a fixed,
linearly separable target rule**, using a hand-designed public representation.
It does not establish accuracy on arbitrary nonlinear rules, transfer to a
new query or reward map, or an advantage for arbitrary environments. The
primary experiment matched interactions, not CPU time. In a small local
profiling check (first and last seed in each world), median training-segment
CPU at 512 episodes was 0.21 s for cue-linear versus 0.16 s for tabular and
0.10 s for query-only. At 8,192 it was 1.46, 1.64 and 0.53 s respectively.
This includes model updates and environment steps, but not evaluation,
snapshot serialization or compilation; it is not a performance guarantee.

## Reproduce

Node 24.22.3 and Bend 2.0.40 were used. The [plan](plan.json) fixes the
three phase bases (617,000,000 / 1,846,000,000 / 3,069,000,000; stride
100,000) and matches seed blocks within each fit across worlds and arms.
Its 48 trials and 240 checkpoints passed archive verification; a stock
uninterrupted remapped-linear rerun reproduced all five checkpoint files
byte-for-byte. Run these commands from the repository root with a fresh
output directory:

```sh
study=studies/complex-worlds/switchboard-generalization
node experiment.mjs run "$study/plan.json" runs/cue-generalization --until 512
node runs/cue-generalization/code/experiment.mjs resume runs/cue-generalization
node experiment.mjs verify runs/cue-generalization
node "$study/audit.mjs" runs/cue-generalization > runs/cue-generalization-results.json
cmp "$study/results.json" runs/cue-generalization-results.json
```

Allow roughly 140 MiB for the archive. The audit and resume load archived
code, so use a trusted archive. No existing learner, world or archive schema
is changed by this study.
