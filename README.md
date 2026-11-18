# Bend Agent Studio

Train reinforcement-learning agents in Bend and watch how their decisions change. The local Studio opens with a playable episode. You can scrub through each move, inspect rewards, change learners, and keep a recording of a trained policy.

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

**Training queue.** Submit more jobs while one trains. Up to 32 waiting jobs are stored in FIFO order; their positions and cancel buttons appear in **Experiments**. Cancelling a waiting job never starts it or stops the active run. At normal shutdown or after a crash the active job is interrupted, not rerun. Reopening the same Studio home resumes the remaining queued jobs in order, only after the prior supervisor has released ownership. A leftover ambiguous ownership marker still blocks training until reviewed. Recovered jobs rebuild their plans from validated catalog settings.

**Compare validation returns.** In **Experiments**, select up to eight run/agent combinations and choose **Compare validation**. Curves overlay only for the same sealed game specification and budget unit; check simulator revisions before comparing runs from different toolchains. The line is the mean of the per-replicate validation episode means. Shading is a deterministic, pointwise 95% percentile bootstrap over separately trained replicates (1,000 draws), not evaluation episodes or a joint confidence band. With one replicate only a line is shown. **Exact validation points** exposes the plotted numbers. A damaged selection reports its own error without suppressing healthy curves.

The read-only local endpoint `GET /api/runs/:id/summary` reads the sealed manifest and checkpoint chains, without executing archived code, replaying episodes or changing the run. It is a validation-return view, not a substitute for full `verify`. Readers are isolated from the HTTP event loop (two at once); a run is limited to 8,192 checkpoint rows, 64 MiB of inputs and a 20-second read. Use offline export/analysis for larger studies.

4. **Keep a recording.** **Record GIF** renders the entire episode at the selected speed, even while playback is paused. Open **Recordings** to preview or download the animation. **Download trace** exports the observations, legal actions, choices, rewards, and stop flags as JSON.

The browser saves recordings locally for the Studio address you used. Download a GIF for a portable copy. Studio saves training runs under `.bend-studio/`. Set `BEND_STUDIO_HOME` to choose another location. To use another port, run `npm start -- --port 4180`. The server binds to the loopback interface.

### If Studio stops during training

A separate training process holds an exclusive SQLite lock on the Studio home. If the server crashes or is force-quit, its private connection closes. The training process stops its JavaScript worker and its Bend compiler, removes temporary build files, and releases the lock. On restart, Studio marks unfinished training as **interrupted** and keeps completed checkpoints. A second Studio using the same home waits up to five seconds for cleanup. Use a different home to run two instances side by side.

Use a local filesystem with working SQLite file locks, and point `BEND` directly at the compiler. If the training supervisor itself is forcibly terminated, a compiler may survive. Studio keeps existing runs available but blocks new training while `training-active.json` remains in the Studio home. Verify that the previous training and compiler have stopped before removing that file. An older run still marked as training at upgrade gets the same protection. Stop earlier Studio versions before opening their home with this version. Independent processes launched by custom compiler wrappers are outside this supervision. A restart never uses a saved PID to terminate a process.

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

The project declares 26 laws. Their statements and proofs are in [LAWS.bend](LAWS.bend) and [PROOF.bend](PROOF.bend).

- **Learning.** The engine applies the learner once per training transition and preserves the model during evaluation. Updating one Double Q table preserves the other. Dyna planning preserves the recorded experience.
- **Episode boundaries.** Rejecting an illegal action preserves the model, score, and accepted-step count. An open state at the horizon is truncated. A terminal state ends the episode even on the last step. Each report increases the episode count by one, including illegal exits.
- **Observations and replay.** The history wrapper preserves legal actions and rewards. For the Ferry world, recording a trace preserves the final report, and splitting a step budget produces the same cursor, including the model, random seed, and remaining horizon.

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

### Agent access over MCP

See the [local MCP server](mcp/README.md) for typed authoring, training jobs, replay, and statistical analysis. The [field reference](mcp/FIELDS.md) covers input plans and specs. Installing the adapter does not add dependencies to the main project.
