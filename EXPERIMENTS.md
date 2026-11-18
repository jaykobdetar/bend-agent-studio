# Running experiments in Bend

The simulation, policy, learning updates, and action-by-action replay run in Bend. The Node runner schedules independent replicates and saves their checkpoints. Python analyzes the exported measurements. A replicate is a separately trained model.

## Rules for experiments

1. The world owns private simulation state. Its public view contains an observation and legal action IDs, or a terminal observation.
2. The engine checks legality before calling the world transition or the learner. The rejection law on the engine’s decision path proves that an invalid action preserves the model, score, and accepted-step count, produces no transition, and ends the episode.
3. Every accepted training move generates exactly one public transition. A learner may use that transition for a TD update, planning, or a deferred episode-return update. Evaluation freezes the model.
4. An episode has a declared horizon. Natural termination takes precedence at the horizon. An open next state at the limit carries a truncation flag. A scheduler pause retains the live cursor and the original horizon.
5. All randomness is seeded. Policy and world draws are domain-separated, and paired arms receive matching episode seed blocks. Training, validation, test, and declared follow-up assessment blocks must be disjoint within their design.
6. World, policy, and learner are independently replaceable through typed interfaces. Observers can see only the public action history. The observation-memory wrapper preserves legal actions and rewards.
7. A model update uses the meaning of the next view. A true terminal state has zero continuation. Double Q chooses and values its bootstrap with different tables. Planning can update values using real observations and cannot invent new observations in its experience store.
8. A comparison declares its budget unit, metrics, replicate blocks, and evaluation conditions. Frozen evaluation decisions, saved weights, code fingerprints, and seed blocks remain traceable to their checkpoint. Hyperparameter selection uses validation. A confirmatory comparison retrains on fresh seeds.
9. Offline fitting reads only the fit partition. Logging records the behavior probability of every taken action. The held-out log and fresh-simulator score have distinct seeds. Unsupported actions are explicitly reported.

The project defines 46 propositions in `LAWS.bend` and `PROOF.bend`. They also cover feature-tree readback, logged-support restrictions, terminal critic and bootstrap targets, and two-seat payoff rules. The engine applies the learner once per training transition and preserves the model during evaluation. The whole-rollout counting-learner laws prove evaluation freezes the counter and training changes it by exactly the accepted-step delta; the proof preserves the signed difference from an arbitrary starting counter. Updating one Double Q table preserves the other. With a nonempty legal-action list, Double Q selects the bootstrap action with the table being updated and values it with the other table. Dyna planning preserves recorded experience. Completing a Monte Carlo self-play episode clears its buffered decisions, not the learned table. On the engine’s actual decision path, rejecting an illegal action preserves model, score and accepted steps, produces no transition and ends the episode. Only an open view at zero remaining fuel is truncated; positive fuel never causes truncation. Each report increases the episode count by one, including illegal exits. From any starting run, the final step count is at most the initial count plus available fuel. The history wrapper preserves legal actions and rewards. At each reset it restores the configured memory and seeds the underlying world anew. For any typed world and agent hooks, observing decisions preserves the final report, and splitting an interaction budget gives the same cursor as advancing once, including model, seed and remaining horizon. These laws cover both training and evaluation. Completing a fresh cursor yields exactly the ordinary episode report for all worlds and policies, including the model, score, steps and stop reason.

The addressed observation/action key reads back the revised F32 value and its incremented U32 visit count. All other keys preserve both reads, even when a key was absent or input entries are not unique.

Zero exploration buckets always select the preferred action, as does every masked 16-bit draw at or above the threshold. The base action is computed in evaluation mode with word zero. The propensity formula is separately tested across all 65,536 draws.

Seed allocation, checkpoint storage, data partition separation and statistical procedures are enforced and tested by the host software.

## First run

Use Bend 2.0.40 and Node 24. Run the following commands from the directory containing this file. Set `BEND` to the Bend executable when it is outside your PATH.

```sh
node experiment.mjs validate experiments/bridge.json
node experiment.mjs run experiments/bridge.json runs/bridge
node experiment.mjs verify runs/bridge
node experiment.mjs export runs/bridge > bridge.csv
python3 analyze.py bridge.csv --reference random
node runs/bridge/code/experiment.mjs replay runs/bridge bridge q 0 256 test 0
```

The bridge has two choices. The safe choice ends the game with one point. The risky choice leads to a second move and has expected return two. Run `node experiment.mjs oracle worlds/bridge.json 2` to compute the optimal full-state return and the uniform baseline from the transition probabilities.

### Run the same loop from an MCP client

The [local MCP adapter](mcp/README.md) accepts either a plan path or a self-contained JSON plan in an empty workspace. Validate the world and plan, compare the game with its oracle, launch training, and poll the returned job ID. After training, use the stored run to summarize replicate estimates, replay an episode, or explain a finite-world decision. MCP and the CLI use the same validators, compiled runner, sealed checkpoints, and original phase/seed definitions. See [plan and spec fields](mcp/FIELDS.md) for the typed inputs.

## Play a finite world in Gymnasium

The optional [Gymnasium adapter](integrations/gymnasium/README.md) uses the same JSON validator, grid expansion and exact integer sampling buckets as the runner. Supply a positive horizon and an explicit U32 seed to reproduce a Bend episode with the same actions. Gym action indices map to potentially sparse Bend IDs; consult the legal-action IDs in the public info. Natural terminal states win over time-limit truncation. For the exact undiscounted report score, use `info["bend_episode_score"]`, which rounds after each accepted move just as Bend does. Run the adapter's Python unittest suite for the Gym checker, sampling comparison, and optional compiled Bend replay comparison.

## Benchmark worlds

The first seven benchmarks are [Gymnasium 1.4.0 ports](integrations/gymnasium/toy_text/README.md); all benchmarks use the general state-machine schema. Values below are expected **undiscounted episode scores**, computed on the Bend integer sampling buckets. “Optimal” is a finite-horizon optimal policy; “uniform” chooses uniformly among all available action IDs. They are not fitted scores.

| World | Horizon | Optimal | Uniform | What it tests |
| --- | ---: | ---: | ---: | --- |
| [FrozenLake 4×4 dry](worlds/benchmarks/toy-text/lake4-dry.json) | 100 | 1 | 0.013940 | Sparse goal; wall actions do not advance the agent. |
| [FrozenLake 4×4 slippery](worlds/benchmarks/toy-text/lake4-slip.json) | 100 | 0.744190 | 0.013940 | Same map, with stochastic directional slips. |
| [FrozenLake 8×8 dry](worlds/benchmarks/toy-text/lake8-dry.json) | 200 | 1 | 0.001901 | Longer sparse-reward search. |
| [FrozenLake 8×8 slippery](worlds/benchmarks/toy-text/lake8-slip.json) | 200 | 0.913220 | 0.001901 | Navigation under slip over the larger fixed map. |
| [Taxi-v4](worlds/benchmarks/toy-text/taxi.json) | 200 | 7.930000 | −771.090999 | Plan pickup and delivery despite costly invalid attempts. |
| [CliffWalking 4×12](worlds/benchmarks/toy-text/cliff4x12.json) | 200* | −13 | −2079.115971 | Cliff falls reset position and incur a penalty; not the smaller built-in Cliff. |
| [Blackjack-v1](worlds/benchmarks/toy-text/blackjack.json) | 32* | −0.043113 | −0.394175 | Hit or stick with a hidden dealer card and the registered natural-hand rule. |
| [Deep Sea, N=3/5](experiments/probe-deep-sea.json) | 3 / 5 | 0.99 / 0.99 | 0.12000 / 0.02625 | Directed exploration with a fixed per-cell action map and costly right moves. |
| [Umbrella, N=3/5](experiments/probe-umbrella.json) | 3 / 5 | 1 / 1 | 0 / 0 | Delayed credit for the first choice, masked by zero-mean reward noise. |
| [Memory, N=3/5](experiments/probe-memory.json) | 3 / 5 | 1 / 1 | 0 / 0 | Recall an initial cue after a delay; reactive optimal value is zero. |
| [Discount chain, N=3/6](experiments/probe-discount.json) | 3 / 6 | 1.25 / 1.25 | 1.125 / 1.125 | Changing the delay changes which choice a discounted learner prefers. |
| [Noisy bandit, N=2/4](experiments/probe-bandit.json) | 1 / 1 | 0.5 / 0.5 | 0 / −0.25 | Identify a better arm amid stochastic positive and negative payoffs. |
| [Catch, N=2/4](experiments/probe-catch.json) | 2 / 2 | 1 / 1 | 0 / −0.5 | Move a paddle to intercept a visible falling ball across grid widths. |

For the six diagnostic families, slash-separated values follow their two sizes in order. They are [bsuite-style probes, not upstream replications](worlds/benchmarks/probes/README.md); each link runs both sizes and produces one plot panel per size.

The Lakes and Taxi use their registered episode limits; *Gymnasium registers no limit for CliffWalking or Blackjack, so these are explicit study budgets.* Authored tabular rows preserve the intended rational probabilities; sampling uses the existing one-word approximation for non-dyadic probabilities, not Gym's RNG. See [generation, numerical precision and Blackjack checks](integrations/gymnasium/toy_text/README.md) and [full-precision baselines](integrations/gymnasium/toy_text/baselines.json). Run the [example plan](experiments/toy-text.json) with `node experiment.mjs run experiments/toy-text.json runs/toy-text`.

## Change the world, policy, or learner

* **A finite state machine** can be written as JSON. Each state has a unique numeric ID, an optional public observation ID, and a list of legal actions. Each action lists possible destination IDs, positive integer weights, and finite rewards. An empty action list marks a terminal state. Start from `worlds/bridge.json`.
* **A grid game** uses `S` for start, `G` for goal, `P` for pit, `#` for wall, and `.` for traversable space. A slip replaces the intended direction with a uniform legal direction. Multiple starts are sampled uniformly. See `worlds/detour.json`.
* **A Bend world** exports `State`, `Observation`, and `world(parameters)`. Its world provides reset, a public view, and a transition. The inventory example keeps opening stock, days left, and costs in the world. Its agent sees just the observation and legal order sizes. See `worlds/inventory.bend` and `experiments/inventory.json`.
* **A Bend agent** exports `Model`, `initial(seed, parameters)`, `act(model, observation, legal, mode, word)`, and `learn(model, transition)`. An experiment arm selects it with `"method": "custom"` and `agentFile`. The UCB1 example implements exploration in its policy and updates reward estimates in its learner. See `agents/ucb.bend` and `experiments/custom-bandit.json`.

A manifest binds a game file using `file` for JSON or `worldFile` for Bend. Paths are relative to the manifest. Set the same observation domain on a custom game and agent when using a custom observation type. Local Bend dependencies and parameter values are included in the saved source identity. A game can also be assembled directly with `E.Hooks{world, act, learn}`.

## Regenerate the Tiger worlds

The Tiger experiment reads three generated JSON files. Each starts from the same seven-state world and uses a different rule file to determine what the agent can observe after listening. Sound exposes the latest sound. Clock adds the number of listens. Evidence exposes a memory state encoding the listen count and the difference between the two sound counts. See the [base Tiger world](worlds/tiger.json) and [experiment manifest](experiments/tiger.json).

The generator enumerates reachable combinations of underlying world state, memory state, and step number. It copies each action's outcome order, weights, and rewards. At depth eight it emits a terminal state with an empty action list. Explicitly storing these states and transitions produces 42 states for Sound, 42 for Clock, and 182 for Evidence. The generator is [memory_world.mjs](memory_world.mjs).

To rebuild all three files after editing the base world or a `worlds/tiger-*-rules.json` file, run this from the repository root with Node 24:

```sh
for variant in sound clock evidence; do
  node memory_world.mjs worlds/tiger.json "worlds/tiger-${variant}-rules.json" \
    --task-horizon 8 > "worlds/tiger-${variant}-h8.json" || exit 1
done
```

Run `node memory_checks.mjs` to rebuild the worlds in memory, compare them with the checked-in JSON, and verify that always listening ends the task after eight steps with a return of −8.

## Declare the comparison

Put the algorithms or hyperparameter choices in `arms`. The Cartesian product of training games, arms, and replicate numbers defines the trials. Within a replicate, all arms share the same starting episode seeds. Separate, nonoverlapping seed blocks cover training, validation, and test. Make the stride large enough for the longest block. The compiler records effective floating-point parameters and epsilon thresholds.

Choose `budgetUnit` as `episodes` or `steps`. Checkpoints start at zero and increase strictly. A step is an accepted environment action. In a step-budget study, an unfinished episode keeps its model, world state, RNG, cumulative score, and remaining horizon across checkpoints. Only a real horizon cutoff sets the transition's truncation flag. `maxTrainEpisodes` bounds the number of starts a step-budget run may use, including zero-step episodes.

Validation evaluates a frozen model at every checkpoint. The test block is used at the final checkpoint. Use `testEpisodes: 0` for screening. The engine counts terminal, limited, and illegal outcomes separately. Interpret these outcomes using the game's rules. For example, reaching the Mountain Car goal is terminal, while a successful 500-step CartPole episode ends at the limit.

## Resume, reproduce, and inspect

The runner still archives a JavaScript backend. See the [native runtime evaluation](tools/native-spike/README.md) for the tested plan boundaries and why native execution is not a supported replay option.

```sh
node experiment.mjs run experiments/planning-budget.json runs/planning --until 256
node experiment.mjs status runs/planning
node runs/planning/code/experiment.mjs resume runs/planning
node runs/planning/code/experiment.mjs rerun runs/planning runs/planning-copy
node experiment.mjs verify runs/planning-copy
```

Choose a fresh destination for a new study. Resume with the runner saved in its `code` directory and the recorded Node version. A fresh rerun uses the sealed source bundle and compiled Bend backend. Each checkpoint includes its parent hash. Publication uses a no-clobber operation so two workers can safely compute the same checkpoint. Use `--shard 0/2` and `--shard 1/2` for two workers on shared storage. Status lists progress. Verification reads the source and checkpoint hashes and checks accounting.

Replay prints one episode's seed, ordered public observations, legal actions, decisions, rewards, terminal and truncation flags, and initial and final model hashes. For a training replay supply a checkpoint immediately before or inside the episode of interest, and the zero-based training episode index. A partial final episode is labeled `Paused`. Validation and test episode indices are relative to their own seed blocks.

## Tune and confirm on fresh training runs

```sh
node experiment.mjs run experiments/car-screen.json runs/screen
node experiment.mjs select runs/screen experiments/car-confirmation.json runs/decision
node experiment.mjs run runs/decision/plan.json runs/confirmation
node experiment.mjs export runs/confirmation > confirmation.csv
python3 analyze.py confirmation.csv --reference q-a05-e00625
```

The confirmation specification declares a reference arm, selection metric, budget, sample size, and new seed allocations. Selection ranks final-checkpoint validation scores and records the overall winner. Confirmation retrains the reference and the highest-ranked distinct challenger from scratch, including when the reference wins the screen. Ties follow the screen's arm order.

`analyze.py` reports a pointwise 95% percentile bootstrap interval. It resamples trained replicate blocks, keeping paired arms together when a reference is specified. With one replicate the interval is blank. With a few replicates or identical observed values, the interval can be narrow and its coverage can be poor. Report the replicate count and inspect the individual paired differences. Increasing bootstrap draws only refines the resampling calculation. [Hesterberg, 2015](https://doi.org/10.1080/00031305.2015.1089789)

The engine advances a 32-bit linear congruential generator. Its mixed hooks use separate constants and a mixing function for the policy and world draws. Episode starts within a seed block are consecutive. These choices reproduce trajectories and pair comparisons across arms. Statistical independence is an assumption about the experimental design. Changing the generator changes trajectories and would require a separately identified design.

### Comparing a fixed suite of games

Per-game means above remain the default. Opt into suite statistics for a balanced export (training, assessment, or offline scores). For each selected phase and budget, the suite requires the same arms and trained replicate IDs for every game. It never pools checkpoints or counts evaluation episodes as fresh trained replicates. These examples use a CSV with at least two arms, one named `random`:

```sh
python3 analyze.py study.csv --aggregate probability-of-improvement --reference random
python3 analyze.py study.csv --aggregate iqm --metric completion
python3 analyze.py study.csv --aggregate profile --metric completion --threshold 0.8
```

**IQM** sorts the balanced game-by-replicate scores and trims `floor(N/4)` values off each tail before averaging. With a reference it reports the difference of the two IQMs (not the IQM of individual differences). A **profile** reports the fraction of oriented scores *strictly* above a prespecified threshold; with a reference the output is the difference in fractions. **Probability of improvement** averages, with equal weight per game, the probability that a candidate draw beats a reference draw; ties receive half credit. It compares all cross-arm pairs within each game, so this is not the fraction of matched seeds won. It needs no common reward scale.

For multi-game IQM and profiles, normalize unlike task scales using `--anchors anchors.json`, or declare that native score units are comparable with `--comparable`. Completion, timeout and illegal fractions already share units. The anchor file maps **every** game to `[bad, good]`, for example `{"bridge":[0,2],"detour":[-10,0]}`. Set these before examining test performance. The transform is `(score-bad)/(good-bad)`; it permits reversed anchors, does not clip, and rejects equal endpoints. Without anchors, higher returns/completion and lower timeout/illegal rates count as better; `steps` requires an explicit `--direction higher|lower`. For lower-is-better metrics the oriented score is the negative raw value, so a threshold of `-0.1` for timeout means fewer than 10% timeouts. The output retains phase, budget unit, game count, replicates per game and resampling scheme.

The suite reports *pointwise*, nominal 95% percentile intervals. The default (`--blocks within-game`) holds the game suite fixed, resamples trained replicates within each game and uses the same indices for paired arms. With a shared cross-game replicate effect, choose `--blocks across-games` to move whole replicate vectors together. Neither estimates uncertainty over newly sampled games. Matched Studio arms should not be bootstrapped independently; independent, unrelated arm designs are not supported by this paired interface. A single replicate per game gives a blank interval. Few replicates or tied outcomes can cause severe undercoverage or a zero-width interval; more bootstrap draws do not replace more runs. Repeated thresholds/checkpoints are not simultaneous confidence bands. See [rliable's evaluation methodology](https://github.com/google-research/rliable) for the reference metrics.

## Transfer and checkpoint selection

Declare additional test-only worlds in `evaluationGames`. Specify which training game and arm supply each model, the target games, and a fresh assessment seed block. A comparison can choose a fixed checkpoint, `final`, or `best-validation`. The latter compares mean source validation returns within each replicate and chooses the earliest tied checkpoint. `minimumBudget` can limit the candidates. Targets must use compatible observation and action meanings.

```sh
node experiment.mjs run experiments/ledge-transfer.json runs/ledge
node experiment.mjs assess runs/ledge experiments/ledge-assessment.json runs/ledge-assessment
python3 analyze.py runs/ledge-assessment/assessment.csv --reference calm-planner
```

## Fit from logs

```sh
node experiment.mjs run experiments/dispatch-source.json runs/dispatch
node batch.mjs collect runs/dispatch experiments/dispatch-exploring.json runs/data
node batch.mjs verify runs/data
node batch.mjs fit runs/data experiments/dispatch-fit.json runs/models
node batch.mjs score runs/dispatch runs/data runs/models experiments/dispatch-score.json runs/scores
python3 analyze.py runs/scores/scores.csv --reference clone
```

The logger freezes the selected checkpoint and evaluates its preferred move with policy word zero. A 16-bit draw mixes that decision with exploration. Each logged move records its exact number of probability buckets out of 65,536. The JSONL files contain public transitions, trajectory boundaries, and actual returns. Fit and holdout partitions use different seeds. The tabular fitter reads the fit partition independently of the simulator. Its methods are behavior cloning, synchronous fitted Q iteration, and fitted Q iteration restricted to observed actions. When a state has no supported legal move, the restricted policy falls back to its first legal action.

Scoring reports independent simulator returns, ordinary and self-normalized trajectory importance estimates, matched trajectories, unsupported choices encountered on target-consistent prefixes, and effective sample size. Empty estimates mean an overlap failure, a lack of matched trajectories, or a numerical overflow in the ordinary estimate. Even positive probabilities can yield very small effective samples. The scoring design checks its seeds against the training run and both dataset partitions. Bucket counts characterize a uniformly drawn policy word. The seeded generator advances from a shared 32-bit starting word. A claim about conditional randomization or unbiased estimation must specify the randomness model.

## Choose a manifest or specification

All names below refer to JSON files in [experiments](experiments/). A training manifest contains `games` and `arms`. The other commands take specifications that refer to an existing run or dataset.

| Command | Files |
| --- | --- |
| `experiment.mjs run` — finite games and learners | `bridge`, `cliff-exploration`, `cue-memory`, `custom-bandit`, `inventory`, `maximization-bias`, `planning-budget`, `reward-memory`, `tiger` |
| `experiment.mjs run` — control and screening | `cartpole`, `mountain-car`, `car-screen`, `pole-screen` |
| `experiment.mjs run` — source runs, transfer and arenas | `dispatch-source`, `ledge-transfer`, `self-play`, `self-play-long` |
| `experiment.mjs select` | `car-confirmation`, `pole-confirmation` |
| `experiment.mjs assess` | `ledge-assessment`, `pole-checkpoint-assessment` |
| `batch.mjs collect` | `dispatch-exploring`, `dispatch-narrow` |
| `batch.mjs fit` and `batch.mjs score` | `dispatch-fit` and `dispatch-score`, respectively |

## Analysis tools and checks

| Question | Command from the repository root |
| --- | --- |
| How well can a stationary observation-based policy perform? | `node experiment.mjs oracle worlds/remember-the-cue.json 2 --reactive` compares the optimum with the full-state result. |
| What can a policy infer from public history or the clock? | `node public_oracle.mjs worlds/tiger.json 8 --class history` or `--class clock`. With the history solver, add `--trace REPLAY.json` to inspect the actions in a recorded episode. |
| How does performance change during training? | `python3 plot_curves.py bridge.csv bridge.svg --reference random` plots validation curves from a run export. Install Matplotlib for plotting. |
| How does paired evidence accumulate? | `node sequential.mjs paired.json` reads `design` with fixed bounds `lower` and `upper` on the candidate-minus-reference difference, and `rows` with `replicate`, `candidate`, and `reference`. Its confidence sequence assumes a prospectively fixed replicate order starting at zero and a common conditional mean. |
| How do archived self-play policies perform in each seat? | `node arena_tournament.mjs runs/self-play runs/tournament` scores a completed self-play run and writes `ratings.csv` and `crossplay.csv`. |
| Do the board encodings, oracles and memory worlds match their independent checks? | `node arena_checks.mjs runs/self-play` uses the compiled self-play snapshot. `node oracle_checks.mjs` and `node memory_checks.mjs` run directly and are included in `npm test`. |

The fixed benchmark helpers `tabular.q_learning` and `tabular.expected_sarsa` use a learning rate of 0.25 and a discount of 0.9. Their benchmark policy explores on one quarter of training draws. For configurable built-in learners, set `alpha`, `gamma`, and `epsilon` on the manifest arm. [Benchmark helpers](tabular.bend) · [Study settings](study.bend)

## Test the implementation

```sh
bend checks.bend
bend benchmark_checks.bend
bend study_checks.bend
bend PROOF.bend --verdict
node experiment_checks.mjs
node batch_checks.mjs
node world_campaign.mjs --bend bend --seed 30000 --worlds 4 --episodes 128 --batches 1
```

The independent verdict needs a matching BendTT kernel available to Bend. The randomized campaign compiles newly generated games and compares boundary transitions, episode reports, and paused execution with an independent simulator. Its output lists the seed and source fingerprints so a failing batch can be repeated.

### Notes and tags

To annotate a run, create or edit `notes.json` beside its `run.json`:

```json
{"notes":"Baseline before the reward change.","tags":["baseline","pilot"]}
```

Both fields are optional. Use at most 4,096 characters for notes, and up to 16
nonempty tags of at most 64 characters each (16 KiB file limit). Studio shows
these as plain text on ready run cards. MCP `list_runs` returns them under
`annotations` separately from verified metadata. Notes can be changed or
removed without changing any checkpoint, run identity, or verification result.
Local readers with access to the run can see them; do not store secrets here.

### Share an offline report

From the current checkout run `node experiment.mjs report RUN OUT.html` using
the Node version recorded by the run and Python 3 (override with `PYTHON`).
For complete runs this writes one new file with inline validation/test charts,
the corresponding `analyze.py` return estimates and bootstrap intervals, and
authored finite-world oracle baselines. For each such game it scans every final
test score across arms and replicates and explains the highest and lowest
episode from its archived backend. Ties use plan order, replicate, then episode
index. The public-history explanation is distinct from the full-state optimum.
Unrecorded phases are marked. Large test sets take longer; an oracle budget
failure aborts generation rather than silently omitting an explanation.

Only generate a report from a **trusted local run**: generation verifies its
archive but executes that archive's backend. Open or share the resulting HTML
offline: it contains plain escaped text and static SVG, no scripts or external
assets. It includes run identity, test seeds and results; review before sharing.

### Parallel trials on one machine

Add `--jobs 4` to `node experiment.mjs run PLAN OUT` to compile once and
distribute independent trials to up to four archived Node workers. Each owns
an ordinary disjoint shard; checkpoint contents and seeds are unchanged.
Choose 1–32 workers, allowing for a model and backend in memory per worker.
Use `--until N` to stop at a declared checkpoint. Resume without Bend with
`node OUT/code/experiment.mjs resume OUT --jobs 4`. The worker count may
change on resume. Do not combine this option with an explicit `--shard`.
A failed worker stops its peers; resume from the last published checkpoints.
Use `node OUT/code/experiment.mjs verify OUT` after completion.

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

### Export a finite world for another solver

`node tools/export_pomdp.mjs worlds/bridge.json bridge.pomdp --discount 0.95 --illegal-penalty -1000000`
writes a new [Cassandra file](https://www.pomdp.org/code/pomdp-file-spec.html)
without replacing existing files. Transitions use the Bend U32 buckets; observations
are one-hot functions of the resulting state. Terminal states absorb with zero
future reward. Globally available but locally illegal actions pay the chosen
penalty once and enter a distinct absorbing sink. Select a penalty below the value
of legal continuations; this is not a hard legality constraint.

This exports expected reward, not the complete interaction history: outcomes
with the same next state use their conditional mean reward. Solvers do not
automatically see Bend's public legal list, sampled reward, or reset observation
before choosing their first action. Results can therefore differ for partially
observable games. For a deterministic initial state and fully observable model,
`python tools/check_pomdp_lp.py bridge.pomdp` optionally checks the discounted
value using SciPy's HiGHS linear-program solver, independent of the JS oracle.

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

### Learner episode completion

A custom agent may add a top-level `def finish(model: Model, reason: E.Stop) -> Model` to its entry module. The existing `initial`, `act` and `learn` contract is unchanged. Omit `finish` for the identity behavior. The compiler checks the optional function's type.

In training, an accepted action calls `learn` first; a completed episode then calls `finish` exactly once. Reasons are `E.Terminal{}`, `E.Limit{}`, or `E.Illegal{action}`. An illegal action has no transition: clear or flush pending state in `finish`, not by inventing a terminal sample. Initially terminal worlds and zero-step open horizons also finish. A mid-episode segment or checkpoint does not finish; resuming it preserves any pending buffer. Evaluation and replay do not call either learner callback. Archived studies continue to use their sealed original backend. For direct Bend callers, use `E.episode`, `E.fold_episode`/`E.trace`, or `C.segment` as completion boundaries. The lower-level `E.drive`, `E.roll`, and `C.advance` return raw state and do not call `finish`.

For two complete discrete custom-agent examples, run the [sampled SARSA(0) plan](experiments/cliff-sarsa.json) or [n-step expected TD plan](experiments/cliff-n-step.json). Their [SARSA notes](docs/sarsa.md) and [n-step notes](docs/n-step.md) describe the different targets at truncation.

The [TD(λ) study](experiments/cliff-td-lambda.json) compares tabular and sparse linear accumulating traces. See [update and reset semantics](docs/td-lambda.md).

[REINFORCE with a state baseline](docs/reinforce.md) uses `learn_context(model,legal,event)` with `finish` to record the ordered public action set at each accepted decision. Try the [Orchard experiment](experiments/reinforce-orchard.json).

The [sparse linear study](experiments/cliff-linear.json) compares a typed authored feature map with tabular Q-learning. The [feature API and results](docs/linear.md) document duplicate coefficients, signed weights and the untuned baseline’s limitations.

The [tiny clipped policy-gradient plan](experiments/clipped-pg-orchard.json) demonstrates frozen behavior probabilities across a multi-episode batch. See the [objective, limits, and replay notes](docs/clipped-policy-gradient.md).
