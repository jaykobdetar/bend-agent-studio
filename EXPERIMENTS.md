# Running experiments in Bend

The simulation, policy, learning updates, and action-by-action replay run in Bend. The Node runner schedules independent replicates and saves their checkpoints. Python analyzes the exported measurements. A replicate is a separately trained model.

## Rules for experiments

1. The world owns private simulation state. Its public view contains an observation and legal action IDs, or a terminal observation.
2. The engine checks legality before calling the world transition or the learner. A rejected action preserves the model, score, and accepted-step count and ends the episode.
3. Every accepted training move generates exactly one public transition. A learner may use that transition for a TD update, planning, or a deferred episode-return update. Evaluation freezes the model.
4. An episode has a declared horizon. Natural termination takes precedence at the horizon. An open next state at the limit carries a truncation flag. A scheduler pause retains the live cursor and the original horizon.
5. All randomness is seeded. Policy and world draws are domain-separated, and paired arms receive matching episode seed blocks. Training, validation, test, and declared follow-up assessment blocks must be disjoint within their design.
6. World, policy, and learner are independently replaceable through typed interfaces. Observers can see only the public action history. The observation-memory wrapper preserves legal actions and rewards.
7. A model update uses the meaning of the next view. A true terminal state has zero continuation. Double Q chooses and values its bootstrap with different tables. Planning can update values using real observations and cannot invent new observations in its experience store.
8. A comparison declares its budget unit, metrics, replicate blocks, and evaluation conditions. Frozen evaluation decisions, saved weights, code fingerprints, and seed blocks remain traceable to their checkpoint. Hyperparameter selection uses validation. A confirmatory comparison retrains on fresh seeds.
9. Offline fitting reads only the fit partition. Logging records the behavior probability of every taken action. The held-out log and fresh-simulator score have distinct seeds. Unsupported actions are explicitly reported.

The project defines 26 propositions in `LAWS.bend` and `PROOF.bend`. They include update and rejection semantics, report accounting, untouched Double Q estimators, feature-tree read after write, public-history preservation, Dyna experience preservation, terminal critic targets and the exclusion of unsupported actions from restricted backups, and the two-seat payoff and terminal bootstrap rules. The observer and split-budget propositions instantiate generic proofs on the ferry world. Seed allocation, checkpoint storage, data partition separation and statistical procedures are enforced and tested by the host software.

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
