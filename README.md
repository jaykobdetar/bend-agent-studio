# Bend Agent Studio

Train reinforcement-learning agents in Bend and watch how their decisions change. The local Studio opens with a playable episode. You can scrub through each move, inspect rewards, change learners, and keep a recording of a trained policy.

A separate [Gymnasium adapter](integrations/gymnasium/README.md) lets Python agents play the same JSON finite and grid worlds without changing Studio or its dependencies.

## Start Studio

Install Node.js 24 or newer, open a terminal in this directory, and run:

```sh
npm start
```

Open **http://127.0.0.1:4173**. The four included replays work immediately. Studio uses only Node's standard library and browser APIs.

For training, install [Bend 2.0.40](https://github.com/bendlang/bend/releases/tag/v2.0.40) and check that `bend version` prints `bend 2.0.40`. If the executable lives elsewhere, start Studio with `BEND=/path/to/bend npm start` on macOS or Linux. In PowerShell, set `$env:BEND` to the executable path before running `npm start`.

| Environment | What to watch | Available agents |
| --- | --- | --- |
| Mountain Car | The car builds momentum on both slopes to reach the flag. | Tile Expected SARSA, tile Q-learning, coarse Q-learning, random |
| CartPole | The cart corrects the leaning pole until it falls or reaches the 500-step limit. | Neural actor–critic, linear actor–critic, random |
| Cliff Walk | A fall costs 100 reward and returns the walker to the start. | Q-learning, Expected SARSA, Dyna-Q, random |
| Tic-Tac-Toe | A policy plays both seats on the same physical board. | Negamax Q-learning, Expected TD, Monte Carlo, random |

1. **Watch an example.** Choose a world and press **Play**. Use the timeline, step buttons, or speed selector to inspect the episode. Telemetry follows the selected step.
2. **Train an agent.** Pick a learning algorithm, episode budget, and seed. Select **Train agent**. When training finishes, the simulator opens a held-out test episode. To stop early, open **Experiments** and choose **Cancel training** on that run.
3. **Inspect a checkpoint.** In **Experiments**, choose **Open replay**. Select a checkpoint, replicate, evaluation split, and episode. Validation is available at intermediate checkpoints. Test episodes use the final checkpoint.
4. **Keep a recording.** **Record GIF** renders the entire episode at the selected speed, even while playback is paused. Open **Recordings** to preview or download the animation. **Download trace** exports the observations, legal actions, choices, rewards, and stop flags as JSON.

The browser saves recordings locally for the Studio address you used. Download a GIF for a portable copy. Studio saves training runs under `.bend-studio/`. Set `BEND_STUDIO_HOME` to choose another location. To use another port, run `npm start -- --port 4180`. The server binds to the loopback interface.

## Design an experiment

The visual presets train one model and evaluate eight episodes per split. For comparisons across independently trained models, use an experiment manifest. Bend owns the world, model, policy and update rule. The Node runner schedules replicates, keeps seed blocks disjoint, freezes models during evaluation, and stores immutable checkpoints.

```sh
node experiment.mjs run experiments/bridge.json runs/bridge
node experiment.mjs verify runs/bridge
node experiment.mjs export runs/bridge > bridge.csv
python3 analyze.py bridge.csv --reference random
npm start -- --run runs/bridge
```

Use `--run` to open a trusted, locally generated study in Studio. Replays execute the runner stored with that study and require its recorded Node version. Custom environments display their public observations and action telemetry. The four featured environments have dedicated renderers.

After upgrading Node, you can keep Studio on the newer version and point it to an installed copy of the archived version. For example, run `npm start -- --replay-node /path/to/older/node`. Studio checks the executable’s version and uses it for matching runs. Repeat the option for additional versions. If a runtime is missing, the replay error identifies the version you need.

Studio runs up to two replay processes at once. A third request receives HTTP 429 and can be retried when a slot opens. Closing the replay dialog or disconnecting the client cancels its pending replay. Each runner has 30 seconds to return a trace before Studio stops it and responds with HTTP 504. Set `BEND_STUDIO_REPLAY_TIMEOUT_MS` to a positive number of milliseconds at startup for longer studies.

Start with [worlds/bridge.json](worlds/bridge.json) for a finite game, [worlds/inventory.bend](worlds/inventory.bend) for a custom Bend world, or [agents/ucb.bend](agents/ucb.bend) for a learning algorithm. The [experiment guide](EXPERIMENTS.md) covers authoring, offline learning, evaluation, and resuming studies. It also explains how to [regenerate the three Tiger worlds](EXPERIMENTS.md#regenerate-the-tiger-worlds).

## Formal Properties

The project declares 41 laws. Their statements and proofs are in [LAWS.bend](LAWS.bend) and [PROOF.bend](PROOF.bend).

- **Learning.** The engine applies the learner once per training transition and preserves the model during evaluation. The whole-rollout counting-learner laws prove evaluation freezes the counter and training changes it by exactly the accepted-step delta; the proof preserves the signed difference from an arbitrary starting counter. Updating one Double Q table preserves the other. With a nonempty legal-action list, Double Q selects the bootstrap action with the table being updated and values it with the other table. Dyna planning preserves recorded experience. Completing a Monte Carlo self-play episode clears its buffered decisions, not the learned table.
- **Episode boundaries.** On the engine’s actual decision path, rejecting an illegal action preserves model, score and accepted steps, produces no transition and ends the episode. Only an open view at zero remaining fuel is truncated; positive fuel never causes truncation. Each report increases the episode count by one, including illegal exits. From any starting run, the final step count is at most the initial count plus available fuel.
- **Observations and replay.** The history wrapper preserves legal actions and rewards. At each reset it restores the configured memory and seeds the underlying world anew. For any typed world and agent hooks, observing decisions preserves the final report, and splitting an interaction budget gives the same cursor as advancing once, including model, seed and remaining horizon. These laws cover both training and evaluation. Completing a fresh cursor yields exactly the ordinary episode report for all worlds and policies, including the model, score, steps and stop reason.
- **Sparse table updates.** The addressed observation/action key reads back the revised F32 value and its incremented U32 visit count. All other keys preserve both reads, even when a key was absent or input entries are not unique.
- **Offline logging.** Zero exploration buckets always select the preferred action, as does every masked 16-bit draw at or above the threshold. The base action is computed in evaluation mode with word zero. The propensity formula is separately tested across all 65,536 draws.

The [native runtime spike](tools/native-spike/README.md) reports sampled CPU/JS replay parity and timings; the supported backend remains JavaScript.

## Run the checks

With Bend 2.0.40 and Node 24 installed:

```sh
npm test
bend checks.bend
bend benchmark_checks.bend
bend study_checks.bend
bend PROOF.bend
```

`npm test` runs the Node checks, including public-policy oracles and generated memory worlds. If the Bend executable is absent, the six compiler integration tests are marked skipped. With Bend installed, they exercise training, replay, checkpoint persistence, and offline evaluation.

For an independent proof verdict, install Lean 4.34.0 (for example, `elan toolchain install leanprover/lean4:v4.34.0`) and run `bend PROOF.bend --verdict`. Bend 2.0.40 builds and caches its bundled BendTT kernel on first use. You can also set `BENDTT` to a kernel built from the same release.

For fixed-suite comparisons, [analyze.py supports IQM, probability of improvement, and performance profiles](EXPERIMENTS.md#comparing-a-fixed-suite-of-games), with replicate bootstrap intervals and no extra dependencies. Per-game analysis remains the default.
