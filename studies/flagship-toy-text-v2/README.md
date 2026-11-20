# Flagship toy-text study (v2)

## Design locked before training

This fixed-suite demonstration follows [v1](../flagship-toy-text/README.md). It is not a controlled estimate of the tie-breaking change: the suite, seeds and training horizon also changed. The [manifest](../../experiments/flagship-toy-text-v2.json) was fixed before any v2 outcomes were inspected.

| Choice | Why it was made before the run |
| --- | --- |
| Use the Phase 10 R10.2 runner | A policy's greedy branch breaks exact value ties at random during training, but evaluation still uses the first maximal legal move. This removes the old preference for the first action during training without changing how saved policies are evaluated. |
| Keep both FrozenLakes, CliffWalking and the two-action bandit | Preserve the old grid tasks and one fast immediate-reward probe. The two v1 bandits did not separate the learning arms, and including both gave that family twice the weight. |
| Add the size-3 Deep Sea probe | Its terminal bonus requires staying on the correct path for all three moves, so it probes sustained exploration rather than immediate reward; the smaller size tests a short, interpretable path. |
| Extend the same episode checkpoints through 1,024 | Give the sparse lake rewards time to propagate. A common schedule across all five worlds makes fixed-budget suite IQM and paired comparisons possible. Episode budgets do not equalize transitions or compute. |
| Keep ten trained replicates per world and arm | Preserve the matched-seed design from v1 while using fresh train, validation and test seed blocks that do not overlap any v1 block. There are eight validation episodes at each checkpoint and 16 held-out episodes at 1,024 only. |

The eight arms, learning settings, and validation/test split sizes match v1. Each of five worlds has equal suite weight. [Uniform and optimal anchors](anchors.json) are exact oracle outputs from the existing [toy-text](../../integrations/gymnasium/toy_text/baselines.json) and [probe](../../worlds/benchmarks/probes/baselines.json) baselines. The normalized IQM takes each game's uniform and optimal expected returns as 0 and 1 without clamping.

## Prespecified descriptions

- Report how many worlds show any spread in final held-out mean return across the seven learning arms, and how many have any pointwise paired interval that excludes zero versus Q-learning. Count the random baseline separately; it is not a learner.
- Report the Dyna-Q versus Q-learning paired mean and interval by world, plus suite IQM and probability of improvement. Report zero-spread worlds as well as any that separate the learners; do not select worlds, arms, training checkpoints or replicates afterward.
- Intervals use 2,000 bootstrap resamples of trained replicate blocks; they are pointwise, not a multiple-comparison test. Suite probability of improvement includes ties as half. A zero-width interval or equality of means is not evidence of equivalent learning procedures.

## Artifacts

- [Checkpoint export](checkpoints.csv) and [sealed identity and toolchain hashes](identity.json).
- [Validation returns](validation-return.svg) and [validation terminal fractions](validation-completion.svg). A terminal state can be a failure, such as a FrozenLake hole; it is not a success measure.
- Paired differences: validation versus [random](paired-validation-vs-random.csv) or [Q-learning](paired-validation-vs-q_learning.csv); held-out test versus [random](paired-test-vs-random.csv) or [Q-learning](paired-test-vs-q_learning.csv).
- Suite IQM: [validation](iqm-validation.csv) and [test](iqm-test.csv). Probability of improvement: validation versus [random](pi-validation-vs-random.csv) or [Q-learning](pi-validation-vs-q_learning.csv); test versus [random](pi-test-vs-random.csv) or [Q-learning](pi-test-vs-q_learning.csv).
- [Standalone HTML report](report.html), to download and open in a browser. It embeds analysis and replay data, not the archived runner.
- [Checkpoint hashes](checkpoint-hashes.json) checked by the [Linux byte-replay slice](../../checks/flagship_v2_slice.mjs).

## Results and limits

All **400 trials and 3,600 checkpoints** verified. Four of five worlds showed some spread in the final held-out mean return among the seven learning arms. Only **two of five**, CliffWalking and slippery FrozenLake, had a pointwise paired interval excluding zero for at least one comparison with Q-learning. Every learning arm reached the same mean on Deep Sea. The dry lake and the bandit showed small mean differences but no paired interval excluding zero.

| World | Q-learning | Dyna-Q | Paired difference (pointwise 95% interval) |
| --- | ---: | ---: | ---: |
| Slippery FrozenLake | 0.325 | 0.58125 | +0.25625 (+0.075 to +0.425) |
| Dry FrozenLake | 1 | 1 | 0 (0 to 0) |
| CliffWalking | −13 | −13 | 0 (0 to 0) |
| Two-action bandit | 0.600 | 0.600 | 0 (0 to 0) |
| Deep Sea (3) | 0.990 | 0.990 | 0 (0 to 0) |

The normalized held-out IQM was **1.000** for both Dyna-Q and Q-learning (rounded; random baseline **0.019**). Suite probability of improvement for Dyna-Q was **0.556** against Q-learning (pointwise 95% interval 0.510–0.596) and **0.993** against random (0.976–1.000). The Dyna-Q versus Q-learning difference in matched means comes entirely from the slippery lake.

On the dry lake, v1 reached 0.000 with Q-learning and 0.100 with Dyna-Q at 128 episodes; on the slippery lake both were 0.000. Those old results do not isolate the cause of the difference: v2 used fresh seeds, a larger budget, a changed suite, and changed training tie-breaking. Likewise, a handful of benchmark tasks with small replicate blocks and unadjusted intervals cannot support a general learner ranking.

## Reproduce

Use Bend 2.0.40 and Node 24.22.3. For the charts, use Python with Matplotlib; the numerical tables use the standard library. The runner was [R10.2](https://github.com/jaykobdetar/bend-agent-studio/tree/87b8ef403a8317528455c2d4cbff6367a6d527ba); reproduce from this study's checkout or apply the exact manifest to that runner. Use fresh output directories, and do not commit the run archive.

```sh
node experiment.mjs validate experiments/flagship-toy-text-v2.json
node experiment.mjs run experiments/flagship-toy-text-v2.json runs/flagship-toy-text-v2 --jobs 4
node experiment.mjs verify runs/flagship-toy-text-v2
bash studies/flagship-toy-text-v2/render.sh runs/flagship-toy-text-v2 flagship-v2-export
node checks/flagship_v2_slice.mjs
```

The slice checks two original archived checkpoints at budget 64 (random and Q-learning, slippery lake, replicate 1) by recreating both shards from the full unchanged plan. This exercises trained Q-learning rather than checking only the untrained model.
