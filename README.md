# Bend Agent Studio

Train reinforcement-learning agents in Bend and watch how their decisions change. The local Studio opens with a playable episode. Scrub through each move, inspect rewards, change learners, and keep a recording of a trained policy.

![Bend Studio showing step 44 of the included Mountain Car replay, with playback controls and episode telemetry.](docs/studio-simulator.png)

## Start Studio

For development, [set up a machine with the pinned toolchain](docs/testing.md#set-up-a-machine).

Install Node.js 24 or newer, open a terminal in the repository root, and run:

```sh
npm start
```

Open **http://127.0.0.1:4173**. Four included replays work immediately, without a compiler or package installation. Training requires [Bend 2.0.40](https://github.com/bendlang/bend/releases/tag/v2.0.40). The [Studio guide](docs/studio.md) covers training, recordings, comparisons, attached runs, runtime versions and configuration.

### If Studio stops during training

See [Studio interruption and recovery](docs/studio.md#if-studio-stops-during-training), including the limits of process supervision and how recovered jobs are handled.

## Design an experiment

For comparisons across independently trained models, start with the Bridge plan. With Node 24+, Bend 2.0.40 and Python 3 installed, run these five commands from the repository root. Use a fresh output directory:

```sh
node experiment.mjs run experiments/bridge.json runs/bridge
node experiment.mjs verify runs/bridge
node experiment.mjs export runs/bridge > bridge.csv
python3 analysis/analyze.py bridge.csv --reference random
npm start -- --run runs/bridge
```

The [experiment guide](docs/experiments.md) explains seed blocks, validation, checkpoints, confirmation and archives. Open only trusted local runs: replay executes their archived code with the recorded Node version.

Try the [flagship toy-text study](studies/flagship-toy-text/README.md) for a worked example with five worlds, eight learners, verified checkpoint exports, uncertainty tables and learning curves.

![Studio chart of flagship CliffWalking validation returns: Dyna-Q improves earlier than Q-learning and Expected SARSA. Shaded regions show pointwise intervals across ten trained replicates per learner.](docs/studio-comparison.png)

On this CliffWalking run, Dyna-Q reached a mean validation return of −13 by 64 training episodes; Q-learning reached the same value by 128. The plot shows a difference in when the agents learned on this task, not an overall ranking or an equal-compute comparison. The study page shows how to replay a learned route.

## Guides

| Guide | Find |
| --- | --- |
| [Studio](docs/studio.md) | Visual training, comparisons, recordings, recovery and replay configuration |
| [Experiments](docs/experiments.md) | First run, manifests, resume, parallel trials, selection and archive compatibility |
| [Worlds](docs/worlds.md) | JSON and Bend environments, benchmarks, Gymnasium and solver export |
| [Agents](docs/agents.md) | Custom learner interfaces, episode completion and learner guides |
| [Analysis](docs/analysis.md) | Paired statistics, oracles, curves, sequential evidence and HTML reports |
| [Offline learning](docs/offline.md) | Collect, fit, score, behavior support and Minari export |
| [Formal laws](docs/laws.md) | Proven properties, proof files and the scope of their guarantees |
| [Testing](docs/testing.md) | Local checks, compiler tests and independent proof verification |
| [Command reference](docs/commands.md) | CLI purposes, arguments and examples |

A separate [Gymnasium adapter](integrations/gymnasium/README.md) lets Python agents play the same JSON finite and grid worlds without changing Studio or its dependencies. Seven [toy-text benchmark worlds](docs/worlds.md#benchmark-worlds) include FrozenLake, Taxi, CliffWalking and Blackjack. See [large-world compile measurements and replay checks](tools/finite-layout/README.md).

For a harder test, try the [three complex challenges](studies/complex-worlds/README.md): route a courier, recall a surprise query, or trade under a reserve deadline. Each comes with a reference solution and a matched-seed study.

For a racing example, [watch a trained driver in Apex Kart](worlds/challenges/apex-kart/README.md) or [drive a course in the terminal and train a policy from your examples](integrations/demonstrations/README.md).

### Agent access over MCP

The [local MCP server](mcp/README.md) exposes typed authoring, training jobs, replay and analysis. Its [field reference](mcp/FIELDS.md) describes plans and specifications; the adapter has its own dependencies.

## Repository layout

- [core/](core/): runner and shared Bend runtime. Root [experiment.mjs](experiment.mjs) remains the public study CLI, and [public_oracle.mjs](public_oracle.mjs) is the oracle compatibility shim.
- [offline/](offline/): dataset collection and fitting. Root [batch.mjs](batch.mjs) remains the public offline CLI.
- [studio/](studio/): local browser application and training supervision.
- [worlds/](worlds/), [agents/](agents/) and [experiments/](experiments/): environments, learners and runnable plans.
- [analysis/](analysis/): statistics and reporting; [tools/](tools/): authoring and measurement utilities.
- [laws/](laws/) and [checks/](checks/): core proofs and verification. Each learner keeps its own laws and checks alongside its agent.

Two standalone Bend programs serve different purposes:

- `bend examples/main.bend` prints a small two-door learner's held-out score before and after training. [Its learner](examples/bandit.bend) is a helper, not a second entry point.
- `bend checks/benchmark.bend` prints a CSV header plus 100 data rows: five worlds × four algorithms × five seeded replicates. This is benchmark data, not the pass/fail [benchmark check](checks/benchmark_checks.bend) or a Studio study archive.

## Formal Properties

See [formal laws and their limits](docs/laws.md). Proofs and tests cover different claims; neither establishes that an arbitrary learner will perform well.

## Run the checks

See the [testing guide](docs/testing.md) for `npm test`, Bend checks and independent proof verification. Compiler-backed Node tests are skipped when Bend is absent.

## License

[MIT](LICENSE).
