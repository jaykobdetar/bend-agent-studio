# Experiments

Run shell commands from the repository root.

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

The project defines 46 propositions in `laws/LAWS.bend` and `laws/PROOF.bend`. They also cover feature-tree readback, logged-support restrictions, terminal critic and bootstrap targets, and two-seat payoff rules. The engine applies the learner once per training transition and preserves the model during evaluation. The whole-rollout counting-learner laws prove evaluation freezes the counter and training changes it by exactly the accepted-step delta; the proof preserves the signed difference from an arbitrary starting counter. Updating one Double Q table preserves the other. With a nonempty legal-action list, Double Q selects the bootstrap action with the table being updated and values it with the other table. Dyna planning preserves recorded experience. Completing a Monte Carlo self-play episode clears its buffered decisions, not the learned table. On the engine’s actual decision path, rejecting an illegal action preserves model, score and accepted steps, produces no transition and ends the episode. Only an open view at zero remaining fuel is truncated; positive fuel never causes truncation. Each report increases the episode count by one, including illegal exits. From any starting run, the final step count is at most the initial count plus available fuel. The history wrapper preserves legal actions and rewards. At each reset it restores the configured memory and seeds the underlying world anew. For any typed world and agent hooks, observing decisions preserves the final report, and splitting an interaction budget gives the same cursor as advancing once, including model, seed and remaining horizon. These laws cover both training and evaluation. Completing a fresh cursor yields exactly the ordinary episode report for all worlds and policies, including the model, score, steps and stop reason.

The addressed observation/action key reads back the revised F32 value and its incremented U32 visit count. All other keys preserve both reads, even when a key was absent or input entries are not unique.

Zero exploration buckets always select the preferred action, as does every masked 16-bit draw at or above the threshold. The base action is computed in evaluation mode with word zero. The propensity formula is separately tested across all 65,536 draws.

Seed allocation, checkpoint storage, data partition separation and statistical procedures are enforced and tested by the host software.

## First run

Use Bend 2.0.40, Node 24 or newer, and Python 3 for analysis (standard library only). Run the following commands from the directory containing this file. Set `BEND` to the Bend executable when it is outside your PATH.

```sh
node experiment.mjs validate experiments/bridge.json
node experiment.mjs run experiments/bridge.json runs/bridge
node experiment.mjs verify runs/bridge
node experiment.mjs export runs/bridge > bridge.csv
python3 analysis/analyze.py bridge.csv --reference random
node runs/bridge/code/experiment.mjs replay runs/bridge bridge q 0 256 test 0
```

A complete run has 24 trials (three arms × eight replicates) and 72 checkpoints. `verify` reports these counts; `export` writes one row per checkpoint, plus the CSV header. With `--reference random`, the analysis estimates paired differences from the random arm, not absolute returns. It defaults to the final held-out test checkpoint; add `--phase validation` to compare at every checkpoint.

To save a standalone HTML report of absolute validation and test returns by arm, run `node experiment.mjs report runs/bridge bridge-report.html` and open the resulting file in a browser.

The bridge has two choices. The safe choice ends the game with one point. The risky choice leads to a second move and has expected return two. Run `node experiment.mjs oracle worlds/bridge.json 2` to compute the optimal full-state return and the uniform baseline from the transition probabilities.

### Run the same loop from an MCP client

The [local MCP adapter](../mcp/README.md) accepts either a plan path or a self-contained JSON plan in an empty workspace. Validate the world and plan, compare the game with its oracle, launch training, and poll the returned job ID. After training, use the stored run to summarize replicate estimates, replay an episode, or explain a finite-world decision. MCP and the CLI use the same validators, compiled runner, sealed checkpoints, and original phase/seed definitions. See [plan and spec fields](../mcp/FIELDS.md) for the typed inputs.

## Declare the comparison

Put the algorithms or hyperparameter choices in `arms`. The Cartesian product of training games, arms, and replicate numbers defines the trials. Within a replicate, all arms share the same starting episode seeds. Separate, nonoverlapping seed blocks cover training, validation, and test. Make the stride large enough for the longest block. The compiler records effective floating-point parameters and epsilon thresholds.

Choose `budgetUnit` as `episodes` or `steps`. Checkpoints start at zero and increase strictly. A step is an accepted environment action. In a step-budget study, an unfinished episode keeps its model, world state, RNG, cumulative score, and remaining horizon across checkpoints. Only a real horizon cutoff sets the transition's truncation flag. `maxTrainEpisodes` bounds the number of starts a step-budget run may use, including zero-step episodes.

Validation evaluates a frozen model at every checkpoint. The test block is used at the final checkpoint. Use `testEpisodes: 0` for screening. The engine counts terminal, limited, and illegal outcomes separately. Interpret these outcomes using the game's rules. For example, reaching the Mountain Car goal is terminal, while a successful 500-step CartPole episode ends at the limit.

## Resume, reproduce, and inspect

The runner still archives a JavaScript backend. See the [native runtime evaluation](../tools/native-spike/README.md) for the tested plan boundaries and why native execution is not a supported replay option.

```sh
node experiment.mjs run experiments/planning-budget.json runs/planning --until 256
node experiment.mjs status runs/planning
node runs/planning/code/experiment.mjs resume runs/planning
node runs/planning/code/experiment.mjs rerun runs/planning runs/planning-copy
node experiment.mjs verify runs/planning-copy
```

Choose a fresh destination for a new study. Resume with the runner saved in its `code` directory and the recorded Node version. A fresh rerun uses the sealed source bundle and compiled Bend backend. Each checkpoint includes its parent hash. Publication uses a no-clobber operation so two workers can safely compute the same checkpoint. Use `--shard 0/2` and `--shard 1/2` for two workers on shared storage.

To move a run, copy the whole directory, including `run.json`, `code/`, and `trials/`. Use the copied paths with the archived Node version; the original checkout and Bend compiler are not required for resume or replay. Use `status` to see how far an unfinished run got. Use `verify` after it finishes: it requires every declared checkpoint, so a missing future checkpoint in an unfinished run is expected, not evidence of corruption. Verification also reads the source and checkpoint hashes and checks accounting.

Replay prints one episode's seed, ordered public observations, legal actions, decisions, rewards, terminal and truncation flags, and initial and final model hashes. For a training replay supply a checkpoint immediately before or inside the episode of interest, and the zero-based training episode index. A partial final episode is labeled `Paused`. Validation and test episode indices are relative to their own seed blocks.

## Tune and confirm on fresh training runs

```sh
node experiment.mjs run experiments/car-screen.json runs/screen
node experiment.mjs select runs/screen experiments/car-confirmation.json runs/decision
node experiment.mjs run runs/decision/plan.json runs/confirmation
node experiment.mjs export runs/confirmation > confirmation.csv
python3 analysis/analyze.py confirmation.csv --phase test --reference q-a05-e00625
```

The confirmation specification declares a reference arm, selection metric, budget, sample size, and new seed allocations. Selection ranks final-checkpoint validation scores and records the overall winner. Confirmation retrains the reference and the highest-ranked distinct challenger from scratch, including when the reference wins the screen. Ties follow the screen's arm order. Finish all screen trials before running `select`; it rejects an unfinished screen rather than comparing only the trials that finished first.

The last command estimates the paired difference on the confirmation run's final held-out test block. In a raw export, `test_seed` is a seed allocation: only rows with a populated `test_episodes` field contain held-out results. Use `--phase validation` to analyze a validation-only screen. An offline report labels validation and held-out test results separately but does not link the two runs. Keep `runs/decision/selection.json` with your confirmation results; it records the source run, ranking, and generated plan hash.

`analysis/analyze.py` reports a pointwise 95% percentile bootstrap interval. It resamples trained replicate blocks, keeping paired arms together when a reference is specified. With one replicate the interval is blank. With a few replicates or identical observed values, the interval can be narrow and its coverage can be poor. Report the replicate count and inspect the individual paired differences. Increasing bootstrap draws only refines the resampling calculation. [Hesterberg, 2015](https://doi.org/10.1080/00031305.2015.1089789)

The engine advances a 32-bit linear congruential generator. Its mixed hooks use separate constants and a mixing function for the policy and world draws. Episode starts within a seed block are consecutive. These choices reproduce trajectories and pair comparisons across arms. Statistical independence is an assumption about the experimental design. Changing the generator changes trajectories and would require a separately identified design.

## Transfer and checkpoint selection

Declare additional test-only worlds in `evaluationGames`. Specify which training game and arm supply each model, the target games, and a fresh assessment seed block. A comparison can choose a fixed checkpoint, `final`, or `best-validation`. The latter compares mean source validation returns within each replicate and chooses the earliest tied checkpoint. `minimumBudget` can limit the candidates. Targets must use compatible observation and action meanings.

A fixed-checkpoint assessment can run from a paused source as soon as every requested trial has reached that checkpoint. `final` needs the final source checkpoints, and `best-validation` needs the complete source checkpoint chains so earlier finishes cannot bias selection. If assessment stops at a missing source checkpoint, finish the source run and repeat the same assessment command with the same output directory. It reuses already saved results and only writes `assessment.csv` when complete. Use a fresh output directory if changing the assessment specification.

```sh
node experiment.mjs run experiments/ledge-transfer.json runs/ledge
node experiment.mjs assess runs/ledge experiments/ledge-assessment.json runs/ledge-assessment
python3 analysis/analyze.py runs/ledge-assessment/assessment.csv --reference calm-planner
```

## Choose a manifest or specification

The <!-- count:experiment-files -->39<!-- /count --> names below refer to JSON files in [experiments](../experiments). A training manifest contains `games` and `arms`. The other commands take specifications that refer to an existing run or dataset.

| Command | Files |
| --- | --- |
| `experiment.mjs run` — finite games and learners | `bridge`, `cliff-exploration`, `cue-memory`, `custom-bandit`, `inventory`, `maximization-bias`, `planning-budget`, `reward-memory`, `tiger` |
| `experiment.mjs run` — control and screening | `cartpole`, `mountain-car`, `car-screen`, `pole-screen` |
| `experiment.mjs run` — source runs, transfer and arenas | `dispatch-source`, `ledge-transfer`, `self-play`, `self-play-long` |
| `experiment.mjs run` — additional learners | `cliff-linear`, `cliff-n-step`, `cliff-sarsa`, `cliff-td-lambda`, `clipped-pg-orchard`, `reinforce-orchard` |
| `experiment.mjs run` — benchmark worlds and games | `probe-bandit`, `probe-catch`, `probe-deep-sea`, `probe-discount`, `probe-memory`, `probe-umbrella`, `toy-text`, `two-pile-nim` |
| `experiment.mjs select` | `car-confirmation`, `pole-confirmation` |
| `experiment.mjs assess` | `ledge-assessment`, `pole-checkpoint-assessment` |
| `batch.mjs collect` | `dispatch-exploring`, `dispatch-narrow` |
| `batch.mjs fit` and `batch.mjs score` | `dispatch-fit` and `dispatch-score`, respectively |

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

## Design an experiment

See the [command reference](commands.md) for CLI purposes and examples.

The commands below use Node 24 or newer and Bend 2.0.40; the analysis step also requires Python 3 (standard library only). Run them from the repository root.

The visual presets train one model and evaluate eight episodes per split. For comparisons across independently trained models, use an experiment manifest. Bend owns the world, model, policy and update rule. The Node runner schedules replicates, keeps seed blocks disjoint, freezes models during evaluation, and stores immutable checkpoints.

```sh
node experiment.mjs run experiments/bridge.json runs/bridge
node experiment.mjs verify runs/bridge
node experiment.mjs export runs/bridge > bridge.csv
python3 analysis/analyze.py bridge.csv --reference random
npm start -- --run runs/bridge
```

Use `--run` to open a trusted, locally generated study in Studio. Replays execute the runner stored with that study and require its recorded Node version. Custom environments display their public observations and action telemetry. The four featured environments have dedicated renderers.

An **Attached run** may be unfinished. Studio shows the planned checkpoints but checks replay availability when you request one. If the final checkpoint is missing, select an earlier saved checkpoint and **Validation**. Use `node experiment.mjs status RUN` to see progress and `node experiment.mjs verify RUN` after completion. Validation comparisons require complete checkpoint series.

After upgrading Node, you can keep Studio on the newer version and point it to an installed copy of the archived version. For example, run `npm start -- --replay-node /path/to/older/node`. Studio checks the executable’s version and uses it for matching runs. Repeat the option for additional versions. If a runtime is missing, the replay error identifies the version you need.

If the path passed to `--replay-node` is missing or cannot run, correct it before restarting Studio. You can also omit the option to inspect or compare the saved checkpoints without replaying them.

Studio runs up to two replay processes at once. A third request receives HTTP 429 and can be retried when a slot opens. Closing the replay dialog or disconnecting the client cancels its pending replay. Each runner has 30 seconds to return a trace before Studio stops it and responds with HTTP 504. Set `BEND_STUDIO_REPLAY_TIMEOUT_MS` to a positive number of milliseconds at startup for longer studies.

Start with [worlds/bridge.json](../worlds/bridge.json) for a finite game, [worlds/inventory.bend](../worlds/inventory.bend) for a custom Bend world, or [agents/ucb/agent.bend](../agents/ucb/agent.bend) for a learning algorithm. The [experiment guide](experiments.md) covers authoring, offline learning, evaluation, and resuming studies. It also explains how to [regenerate the three Tiger worlds](worlds.md#regenerate-the-tiger-worlds).
