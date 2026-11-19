# Storm Reserve: overlap is not agreement

Take the Dyna-5 policy at checkpoint 1,024 in the 12-period Storm Reserve
study. Log the policy as-is or with 25% uniform exploration. Each scheme
uses eight matched seed blocks, with separate 256-episode fit, 512-episode
holdout and 512-episode fresh simulator phases per replicate. The offline
targets are learned separately from each scheme's fit partition, so this
compares two pipelines, not the isolated effect of logging on a fixed target.

| Logger and target | Exact overlap, reps | Full held-out matches / 4,096 | Exact mean return | Fresh simulator mean |
| --- | ---: | ---: | ---: | ---: |
| Deterministic, clone | 1/8 | 4,053 | 14.331 | 14.269 |
| Deterministic, fitted Q | 0/8 | 2,137 | 11.924 | 11.895 |
| Deterministic, supported fitted Q | 1/8 | 4,053 | 14.331 | 14.269 |
| Exploring, clone | 8/8 | 502 | 14.217 | 14.160 |
| Exploring, fitted Q | 8/8 | 2 | 8.145 | 7.906 |
| Exploring, supported fitted Q | 8/8 | 13 | 11.302 | 11.178 |

**High match counts can hide missing support.** For the deterministic clone,
one replicate matched all 512 logged episodes yet the exact oracle still
found a target path with no logging support. Importance estimates are not
identified by those logs, so the scorer leaves them blank.

**Full support can still be too thin.** For the exploring logger and its cloned
policy, matched prefixes fall from 3,372 at step 1 to 2,394, 1,429, 858 and
502 at steps 3, 6, 9 and 12. Median per-replicate effective sample size
goes from 418.5 at step 1 to 59.2 at step 12, out of 512 episodes each.
This follows the same policy and logs as more decisions must agree.
Exploratory fitted Q has support in all eight replicates but only two full
matches total, so normalized trajectory estimates are absent in six. Its
FQE mean absolute error was 11.426 relative to the exact finite-model value.
Neither model-based nor importance-weighted estimates are trustworthy merely
because a coverage flag passes. These are diagnostic results, not estimates
for other workloads. Exact support and values use the authored finite-world
probabilities and logging buckets, not enumeration of all PRNG seed streams.

## Reproduce

Use pinned Node/Bend from the repository root. If you already have a complete
trusted Storm Reserve archive, use it instead of retraining.

```sh
node experiment.mjs run experiments/storm-reserve.json runs/reserve
node experiment.mjs verify runs/reserve
for mode in narrow exploring; do
  dir="runs/reserve-offline-$mode"
  node batch.mjs collect runs/reserve "studies/complex-worlds/offline/$mode.json" "$dir/data"
  node batch.mjs verify "$dir/data"
  node batch.mjs fit "$dir/data" experiments/dispatch-fit.json "$dir/models"
  node batch.mjs score runs/reserve "$dir/data" "$dir/models" studies/complex-worlds/offline/score.json "$dir/scores"
done
node studies/complex-worlds/offline/prefix.mjs runs/reserve-offline-exploring/data runs/reserve-offline-exploring/models clone
```

The [offline guide](../../../docs/offline.md) explains every estimator and
why columns can be blank. The reusable fit spec specifies clone, fitted Q
iteration and fitted Q iteration restricted to observed actions.
