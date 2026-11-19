# Analysis

Run shell commands from the repository root.

## Paired intervals and their limits

`analysis/analyze.py` reports a pointwise 95% percentile bootstrap interval. It resamples trained replicate blocks, keeping paired arms together when a reference is specified. With one replicate the interval is blank. With a few replicates or identical observed values, the interval can be narrow and its coverage can be poor. Report the replicate count and inspect the individual paired differences. Increasing bootstrap draws only refines the resampling calculation. [Hesterberg, 2015](https://doi.org/10.1080/00031305.2015.1089789)

### Comparing a fixed suite of games

Per-game means above remain the default. Opt into suite statistics for a balanced export (training, assessment, or offline scores). For each selected phase and budget, the suite requires the same arms and trained replicate IDs for every game. It never pools checkpoints or counts evaluation episodes as fresh trained replicates. These examples use a CSV with at least two arms, one named `random`:

```sh
python3 analysis/analyze.py study.csv --aggregate probability-of-improvement --reference random
python3 analysis/analyze.py study.csv --aggregate iqm --metric completion
python3 analysis/analyze.py study.csv --aggregate profile --metric completion --threshold 0.8
```

**IQM** sorts the balanced game-by-replicate scores and trims `floor(N/4)` values off each tail before averaging. With a reference it reports the difference of the two IQMs (not the IQM of individual differences). A **profile** reports the fraction of oriented scores *strictly* above a prespecified threshold; with a reference the output is the difference in fractions. **Probability of improvement** averages, with equal weight per game, the probability that a candidate draw beats a reference draw; ties receive half credit. It compares all cross-arm pairs within each game, so this is not the fraction of matched seeds won. It needs no common reward scale.

For multi-game IQM and profiles, normalize unlike task scales using `--anchors anchors.json`, or declare that native score units are comparable with `--comparable`. Completion, timeout and illegal fractions already share units. The anchor file maps **every** game to `[bad, good]`, for example `{"bridge":[0,2],"detour":[-10,0]}`. Set these before examining test performance. The transform is `(score-bad)/(good-bad)`; it permits reversed anchors, does not clip, and rejects equal endpoints. Without anchors, higher returns/completion and lower timeout/illegal rates count as better; `steps` requires an explicit `--direction higher|lower`. For lower-is-better metrics the oriented score is the negative raw value, so a threshold of `-0.1` for timeout means fewer than 10% timeouts. The output retains phase, budget unit, game count, replicates per game and resampling scheme.

The suite reports *pointwise*, nominal 95% percentile intervals. The default (`--blocks within-game`) holds the game suite fixed, resamples trained replicates within each game and uses the same indices for paired arms. With a shared cross-game replicate effect, choose `--blocks across-games` to move whole replicate vectors together. Neither estimates uncertainty over newly sampled games. Matched Studio arms should not be bootstrapped independently; independent, unrelated arm designs are not supported by this paired interface. A single replicate per game gives a blank interval. Few replicates or tied outcomes can cause severe undercoverage or a zero-width interval; more bootstrap draws do not replace more runs. Repeated thresholds/checkpoints are not simultaneous confidence bands. See [rliable's evaluation methodology](https://github.com/google-research/rliable) for the reference metrics.

## Plan the number of training replicates

Use a completed, verified pilot export and choose one comparison, game, checkpoint, phase and metric. The planner uses only those matched blocks from the export; it does not pool checkpoints, games or evaluation episodes. Validation is the default for planning. Do not reuse confirmatory test data to revise that same study's design.

```sh
python3 analysis/replicates.py studies/flagship-toy-text/checkpoints.csv --game cliff4x12 --budget 128 --phase validation --metric return --reference random --challenger q_learning --target-half-width 50
```

The target is in units of the metric: here, 50 reward units for the **mean challenger-minus-reference return**. `completion`, `timeout` and `illegal` use fractions, not percentage points. Supported metrics match the training-export analysis; compressed CSV files also work. The planner checks episode/step accounting, unique checkpoint rows and matched seed blocks. A pilot needs at least two paired training replicates. Replicate IDs are sorted, so changing CSV row order does not change a seeded result.

- **Precision:** resample the pilot paired differences and measure the half-width of their 95% percentile interval. Multiply by `sqrt(n/(n-1))` to adjust for the empirical resampling distribution's denominator, then project by `sqrt(n/N)` and round up the smallest total `N` meeting the target, never below the pilot count. The default is 4,000 draws with seed 0. A zero observed half-width keeps the pilot count as a floor and emits a warning, not a claim of precise inference. Estimates above 2,000 replicates are rejected rather than silently capped.
- **Power:** at that planned count, estimate the exact two-sided sign test's rejection probability at 0.05, using pilot positive, negative and tie rates as plug-in probabilities. Differences exactly equal to zero are ties. The sign test discards them, so power averages over the random remaining count. This tests sign balance, not a mean effect, and does not implement Holm or any other multiplicity adjustment.

These are **planning estimates, not evidence**. They assume independent paired training replicates and a future design with a similar difference distribution, variance and tie rate. Small or unrepresentative pilots can substantially underestimate how many runs you need. Treat very low or high plug-in power as a prompt to examine the pilot, not a guarantee. Use a new, prospectively declared confirmation with independent seeds.

## Analysis tools and checks

| Question | Command from the repository root |
| --- | --- |
| How well can a stationary observation-based policy perform? | `node experiment.mjs oracle worlds/remember-the-cue.json 2 --reactive` compares the optimum with the full-state result. |
| What can a policy infer from public history or the clock? | `node public_oracle.mjs worlds/tiger.json 8 --class history` or `--class clock`. With the history solver, add `--trace REPLAY.json` to inspect the actions in a recorded episode. |
| How does performance change during training? | `python3 analysis/plot_curves.py bridge.csv bridge.svg --reference random` plots validation curves from a run export. Install Matplotlib for plotting. |
| How does paired evidence accumulate? | `node analysis/sequential.mjs paired.json` reads `design` with fixed bounds `lower` and `upper` on the candidate-minus-reference difference, and `rows` with `replicate`, `candidate`, and `reference`. Its confidence sequence assumes a prospectively fixed replicate order starting at zero and a common conditional mean. |
| How do archived self-play policies perform in each seat? | `node analysis/arena_tournament.mjs runs/self-play runs/tournament` scores a completed self-play run and writes `ratings.csv` and `crossplay.csv`. |
| Do the board encodings, oracles and memory worlds match their independent checks? | `node checks/arena_checks.mjs runs/self-play` uses the compiled self-play snapshot. `node checks/oracle_checks.mjs` and `node checks/memory_checks.mjs` run directly and are included in `npm test`. |

The fixed benchmark helpers `tabular.q_learning` and `tabular.expected_sarsa` use a learning rate of 0.25 and a discount of 0.9. Their benchmark policy explores on one quarter of training draws. For configurable built-in learners, set `alpha`, `gamma`, and `epsilon` on the manifest arm. [Benchmark helpers](../core/tabular.bend) · [Study settings](../core/study.bend)

### Multiple arms versus one reference

Use `python analysis/analyze.py results.csv --phase test --reference baseline --multiple holm-sign`
for exact paired, two-sided **sign** tests followed by Holm's step-down
adjustment. Each family contains all non-reference arms in **one game at one
budget**, within the requested phase/metric. Reference sharing across arms
is allowed. The replicate pairs within each comparison must be independent.
The null is equal probabilities of positive and negative differences among
non-ties. Ties are removed; no non-ties yields p=1. This is not a test of a
zero **mean**: differences of mixed sizes can give a different conclusion.
The leading CSV columns remain descriptive paired mean differences and their
original **pointwise**, not simultaneous, bootstrap intervals. Added columns
record family size, non-tie count, raw sign p and Holm-adjusted p. Compare
the latter with your prespecified family alpha. No adjustment across games,
checkpoints, metrics, phases, or repeated looks is implied. Preselect the
family before inspecting results. Without the option CSV output is unchanged.

For a small two-player perfect-information game, run the [two-pile Nim study](../experiments/two-pile-nim.json) and [exhaustive graph and exploitability checks](two-pile-nim.md).

Larger finite worlds can use a packed compiled representation. [Taxi and Blackjack measurement details](../tools/finite-layout/README.md) cover compiler memory, exhaustive transition probes, bounded learning studies and archived reruns; the old full-size baseline did not complete under the same memory cap.

[Export a collected dataset to local Minari/HDF5](../integrations/minari/README.md). Select fit or holdout explicitly for separate artifacts, or all for a complete copy. The exporter preserves observations, actions, stop flags and rewards, verifies the result by loading it, and refuses unsupported lossless conversions.

To inspect per-replicate checkpoints in MLflow, use the optional [local tracking-store exporter](../integrations/mlflow/README.md). It uses the same metric definitions and budget steps as the learning curves.

### Share an offline report

From the current checkout run `node experiment.mjs report RUN OUT.html` using
the Node version recorded by the run and Python 3 (override with `PYTHON`).
For complete runs this writes one new file with inline validation/test charts,
per-arm return estimates and pointwise bootstrap intervals, and authored
finite-world oracle baselines. The report labels the training budget unit and
shows absolute returns; use `analysis/analyze.py --reference` after exporting for paired
differences. For each authored finite world it scans every final test score
across arms and replicates and explains the highest and lowest
episode from its archived backend. Ties use plan order, replicate, then episode
index. The public-history explanation is distinct from the full-state optimum.
Unrecorded phases are marked. Large test sets take longer; an oracle budget
failure aborts generation rather than silently omitting an explanation.

Only generate a report from a **trusted local run**: generation verifies its
archive but executes that archive's backend. Open or share the resulting HTML
offline: it contains plain escaped text and static SVG, no scripts or external
assets. It includes run identity, test seeds and results; review before sharing.

### Discounted full-state planning

Run `node experiment.mjs oracle worlds/detour.json --discount 0.95 --tolerance 1e-9`.
This returns two independent planning results: value iteration, and policy iteration
with iterative policy evaluation. Both see the underlying state, even when the
agent's observations do not distinguish states. Rewards on entering a terminal
state count; its continuation value is zero. With discount below 1 the stopping
residual is at most tolerance × (1 − discount), before floating-point roundoff.
An iteration limit raises an error rather than returning an unconverged estimate.

Discount 1 is supported only for acyclic positive-probability transition graphs,
where exact backward propagation terminates. Merely having a goal is insufficient:
Detour permits circling, and even an almost-surely terminating stochastic loop is
outside this conservative undiscounted solver. Choose a discount below 1 or use
the original finite-horizon oracle for such worlds.

## Matrix game values and exploitability

After running and verifying [the matrix study](../experiments/matrix-games.json), use the exact recorded Node version:

```sh
node experiment.mjs run experiments/matrix-games.json runs/matrix-games
node experiment.mjs verify runs/matrix-games
node analysis/matrix_report.mjs runs/matrix-games
```

The standard-library [solver](../analysis/matrix_games.mjs) enumerates the active constraints of the small primal and dual linear programs and solves each candidate vertex using exact BigInt rational arithmetic. It rejects infeasible or singular candidates, tests both seat strategies, and checks that their values agree. It supports rectangular games, degeneracy and negative values, with at most six actions per seat. Nash values are 0 for both RPS variants and Matching Pennies, 2/3 for the rectangular game and −2 for the negative saddle.

For each learner, the [report](../analysis/matrix_report.mjs) reads accepted choices at the fixed final checkpoint from the archived, frozen validation models. It reports the row and column action counts, exact expected payoff under the product of their empirical distributions, each seat's best response and regret, NashConv (sum of regrets), and exploitability (NashConv/2). The column best response is shown in **row-payoff units**, so a smaller value favors column. A checked-in plan run gives Q-learning exploitability 0 on the negative saddle but 3/4 on weighted RPS. This demonstrates the difference between learning against a fixed random opponent and learning an equilibrium. The arithmetic is exact for the profile of measured choices; 16 validation decisions per seat and arm are not a precise estimate of every seed or a general convergence claim. Open only trusted local archives.
