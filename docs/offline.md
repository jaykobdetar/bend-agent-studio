# Offline

Run shell commands from the repository root.

## Teach a policy by playing

Use the [local demonstration and coaching guide](../integrations/demonstrations/README.md) to drive a finite world, record the actions you deliberately save, train a Bend behavior clone, or label states while the clone drives. No accounts, background collection, or action propensities. This is a separate data format from the randomized logger below.

## Fit from logs

```sh
node experiment.mjs run experiments/dispatch-source.json runs/dispatch
node batch.mjs collect runs/dispatch experiments/dispatch-exploring.json runs/data
node batch.mjs verify runs/data
node batch.mjs fit runs/data experiments/dispatch-fit.json runs/models
node batch.mjs score runs/dispatch runs/data runs/models experiments/dispatch-score.json runs/scores
python3 analysis/analyze.py runs/scores/scores.csv --reference clone
```

The logger freezes the selected checkpoint and evaluates its preferred move with policy word zero. A 16-bit draw mixes that decision with exploration. Each logged move records its exact number of probability buckets out of 65,536. The JSONL files contain public transitions, trajectory boundaries, and actual returns. Fit and holdout partitions use different seeds. The tabular fitter reads the fit partition independently of the simulator. Its methods are behavior cloning, synchronous fitted Q iteration, and fitted Q iteration restricted to observed actions. When a state has no supported legal move, the restricted policy falls back to its first legal action.

Scoring reports independent simulator returns, ordinary and self-normalized trajectory importance estimates, matched trajectories, unsupported choices encountered on target-consistent prefixes, and effective sample size. Empty estimates mean an overlap failure, a lack of matched trajectories, or a numerical overflow in the ordinary estimate. Even positive probabilities can yield very small effective samples. The scoring design checks its seeds against the training run and both dataset partitions. Bucket counts characterize a uniformly drawn policy word. The seeded generator advances from a shared 32-bit starting word. A claim about conditional randomization or unbiased estimation must specify the randomness model.

### Off-policy score columns

The estimand is the undiscounted finite-episode value of the frozen target
policy. `pdis` weights each reward by the target/logging likelihood ratio
through that decision. `weighted_pdis` normalizes separately at each time;
early terminal episodes contribute zero rewards and keep their final weight
in later denominators. `fqe` estimates time-indexed observation/legal-list/action
values by backward empirical means on **fit**, following the target action,
not the maximizing action. Unseen cells default to zero. `doubly_robust`
starts from the fitted initial prediction and applies prefix-weighted residual
corrections on **holdout**. FQE can extrapolate badly under poor support or
aliased observations. Self-normalized estimators need not be unbiased.

For authored finite worlds `exact_value` uses the independent policy oracle
and `coverage_complete` checks the archived logger across target paths.
Each `*_error` is estimate minus exact value. Missing coverage blanks IS
and doubly robust estimates, not FQE; a zero normalization denominator also
gives a blank. Unknown global support on other worlds is not evidence of
coverage. Compare errors across independent dataset replicates, not frames.

## Minari export

An optional [local Minari exporter](../integrations/minari/README.md) converts collected trajectories to a reload-verified HDF5 dataset. It does not register or upload data.
