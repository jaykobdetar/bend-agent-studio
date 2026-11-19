# Command reference

Run examples from the **repository root**, not from the directory containing this page. Use Node 24+ and Bend 2.0.40 for new studies. Python analysis uses the standard library unless noted. Paths under `runs/` are example local outputs; use fresh, distinct destinations rather than overwriting evidence. Commands below are examples, not one script to run in order.

## Studio and studies

| Task | Example |
| --- | --- |
| Open the four included visual replays; no compiler is needed until you train. | `npm start` |
| Open a trusted local study in Studio. | `npm start -- --run runs/bridge` |
| Validate a training manifest without running it. | `node experiment.mjs validate experiments/bridge.json` |
| Compute the finite-horizon optimum and uniform baseline. | `node experiment.mjs oracle worlds/bridge.json 2` |
| Compare stationary observation-based and full-state policies. | `node experiment.mjs oracle worlds/remember-the-cue.json 2 --reactive` |
| Solve an infinite-horizon discounted finite world. | `node experiment.mjs oracle worlds/detour.json --discount 0.95 --tolerance 1e-9` |
| Compile a plan and save its source, backend and checkpoints. | `node experiment.mjs run experiments/bridge.json runs/bridge` |
| Read progress; unfinished trials are allowed. | `node experiment.mjs status runs/bridge` |
| Check that every declared trial and checkpoint is complete and valid. | `node experiment.mjs verify runs/bridge` |
| Resume an unfinished study; do not create a second run. | `node runs/bridge/code/experiment.mjs resume runs/bridge` |
| Independently repeat a saved study into a new directory, using its archived backend. | `node runs/bridge/code/experiment.mjs rerun runs/bridge runs/bridge-copy` |
| Replay one recorded episode; print its observations, actions, model hashes and score. | `node runs/bridge/code/experiment.mjs replay runs/bridge bridge q 0 256 test 0` |
| Export one CSV row per checkpoint. | `node experiment.mjs export runs/bridge > bridge.csv` |
| Create a new standalone HTML report of a completed study. | `node experiment.mjs report runs/bridge bridge-report.html` |
| Select a reference and challenger from a completed screen for a fresh confirmation plan. | `node experiment.mjs select runs/screen experiments/car-confirmation.json runs/decision` |
| Evaluate frozen models on the transfer worlds declared by a study and specification. | `node experiment.mjs assess runs/ledge experiments/ledge-assessment.json runs/ledge-assessment` |

For the last two examples, create `runs/screen` from `experiments/car-screen.json` and `runs/ledge` from `experiments/ledge-transfer.json`. Selection writes a plan; it does not train the confirmation. To demonstrate resume on Bridge, stop the original run at checkpoint 32 with `--until 32`. The budget is in the plan’s units (episodes or accepted steps). For parallel trials choose either `--jobs 2` or manual `--shard 0/2` and `--shard 1/2`, not both.

Use only trusted local archives. Run saved code with its recorded Node version; keep the entire run directory when moving it. CLI replay takes zero-based replicate and episode indices; Studio displays them starting at 1. Test uses the final checkpoint, and a validation-only screen has no held-out test results. Use the **current checkout** to generate reports; the offline HTML itself does not execute code.

## Offline learning

First create `runs/dispatch` with `node experiment.mjs run experiments/dispatch-source.json runs/dispatch`.

| Task | Example |
| --- | --- |
| Collect trajectories from frozen behavior policies, separating fitting and holdout seeds. | `node batch.mjs collect runs/dispatch experiments/dispatch-exploring.json runs/data` |
| Verify the collected dataset. | `node batch.mjs verify runs/data` |
| Train offline models on the fit partition. | `node batch.mjs fit runs/data experiments/dispatch-fit.json runs/models` |
| Score the fitted models against held-out logs and fresh simulator episodes. | `node batch.mjs score runs/dispatch runs/data runs/models experiments/dispatch-score.json runs/scores` |

## Analysis and authoring

| Task | Example |
| --- | --- |
| Estimate an arm’s paired difference from a reference on a completed training export. | `python3 analyze.py bridge.csv --reference random` |
| Plot a validation learning curve (Matplotlib). | `python3 plot_curves.py bridge.csv bridge.svg --phase validation --reference random` |
| Check sequential evidence in prospectively ordered paired replicates. Supply a design with fixed difference bounds and one row per replicate. | `node sequential.mjs paired.json` |
| Evaluate trained self-play agents in both seats; writes cross-play and ratings CSVs. First run the self-play plan. | `node arena_tournament.mjs runs/self-play runs/tournament` |
| Compare history-aware decisions in a finite world; use `--class clock` for the clock-only policy class. | `node public_oracle.mjs worlds/remember-the-cue.json 2 --class history` |
| Generate a finite world whose state includes specified observation memory. | `node memory_world.mjs worlds/tiger.json worlds/tiger-sound-rules.json --task-horizon 8 > tiger-sound.json` |
| Export a finite world to Cassandra format. | `node tools/export_pomdp.mjs worlds/bridge.json bridge.pomdp --discount 0.95` |
| Independently check the exported discounted fully observable model (SciPy and NumPy). | `python3 tools/check_pomdp_lp.py bridge.pomdp` |

For `sequential.mjs`, a minimal input shape is `{"design":{"lower":-1,"upper":1},"rows":[{"replicate":0,"candidate":1,"reference":0}]}`. A single example block illustrates the file format, not persuasive evidence.

## Optional tools and checks

| Task | Example |
| --- | --- |
| Start the local MCP server after installing its isolated dependencies. Use a directory you control. | `node mcp/server.mjs --workspace /absolute/path/to/workspace` |
| Export a verified logged dataset locally with the optional Minari environment active. | `python3 integrations/minari/export_minari.py runs/data runs/minari-fit --split fit` |
| Check that generated diagnostic probe worlds/plans match the checked-in files. | `node worlds/benchmarks/probes/generate.mjs --check` |
| Compare toy-text transition/oracle references; see the adapter guide for pinned Gymnasium regeneration. | `node integrations/gymnasium/toy_text/oracles.mjs` |
| Run the normal Node suite; compiler-backed checks require Bend. | `npm test` |
| Run a bounded generated-world/compiler cross-check. | `node world_campaign.mjs --bend bend --seed 30000 --worlds 2 --episodes 12 --batches 1` |
| Check the core proof with BendTT and Lean 4.34.0. | `bend PROOF.bend --verdict` |

The [experiment guide](../EXPERIMENTS.md) covers designs, file schemas and statistical assumptions. See the [MCP](../mcp/README.md), [Gymnasium](../integrations/gymnasium/README.md) and [Minari](../integrations/minari/README.md) guides for optional setup. The [table-timing procedure](../EXPERIMENTS.md#compare-keyed-tabular-training-against-list-backed-archives), [large-world compiler measurements](../tools/finite-layout/README.md) and [historical native experiment](../tools/native-spike/README.md) have specific prerequisites; none is a normal install or training step.
