# Agents

Run shell commands from the repository root.

## Change the world, policy, or learner

For finite JSON, grid and custom Bend environments, see [world authoring](worlds.md#author-a-world).

* **A Bend agent** exports `Model`, `initial(seed, parameters)`, `act(model, observation, legal, mode, word)`, and `learn(model, transition)`. An experiment arm selects it with `"method": "custom"` and `agentFile`. The UCB1 example implements exploration in its policy and updates reward estimates in its learner. See `agents/ucb/agent.bend` and `experiments/custom-bandit.json`.

A manifest binds a game file using `file` for JSON or `worldFile` for Bend. Paths are relative to the manifest. Set the same observation domain on a custom game and agent when using a custom observation type. Local Bend dependencies and parameter values are included in the saved source identity. A game can also be assembled directly with `E.Hooks{world, act, learn}`.

### Learner episode completion

A custom agent may add a top-level `def finish(model: Model, reason: E.Stop) -> Model` to its entry module. The existing `initial`, `act` and `learn` contract is unchanged. Omit `finish` for the identity behavior. The compiler checks the optional function's type.

In training, an accepted action calls `learn` first; a completed episode then calls `finish` exactly once. Reasons are `E.Terminal{}`, `E.Limit{}`, or `E.Illegal{action}`. An illegal action has no transition: clear or flush pending state in `finish`, not by inventing a terminal sample. Initially terminal worlds and zero-step open horizons also finish. A mid-episode segment or checkpoint does not finish; resuming it preserves any pending buffer. Evaluation, including validation and test replay, skips both learner callbacks. Training replay re-executes learning and episode completion on a temporary model; it does not modify saved checkpoints. Archived studies continue to use their sealed original backend. For direct Bend callers, use `E.episode`, `E.fold_episode`/`E.trace`, or `C.segment` as completion boundaries. The lower-level `E.drive`, `E.roll`, and `C.advance` return raw state and do not call `finish`.

For two complete discrete custom-agent examples, run the [sampled SARSA(0) plan](../experiments/cliff-sarsa.json) or [n-step expected TD plan](../experiments/cliff-n-step.json). Their [SARSA notes](../agents/sarsa/README.md) and [n-step notes](../agents/n_step/README.md) describe the different targets at truncation.

The [TD(λ) study](../experiments/cliff-td-lambda.json) compares tabular and sparse linear accumulating traces. See [update and reset semantics](../agents/td_lambda/README.md).

[REINFORCE with a state baseline](../agents/reinforce/README.md) uses `learn_context(model,legal,event)` with `finish` to record the ordered public action set at each accepted decision. Try the [Orchard experiment](../experiments/reinforce-orchard.json).

The [sparse linear study](../experiments/cliff-linear.json) compares a typed authored feature map with tabular Q-learning. The [feature API and results](../agents/linear/README.md) document duplicate coefficients, signed weights and the untuned baseline’s limitations.

The [tiny clipped policy-gradient plan](../experiments/clipped-pg-orchard.json) demonstrates frozen behavior probabilities across a multi-episode batch. See the [objective, limits, and replay notes](../agents/clipped_pg/README.md).

### Agent access over MCP

See the [local MCP server](../mcp/README.md) for typed authoring, training jobs, replay, and statistical analysis. The [field reference](../mcp/FIELDS.md) covers input plans and specs. Installing the adapter does not add dependencies to the main project.

For fixed-suite comparisons, [the analyzer supports IQM, probability of improvement, and performance profiles](analysis.md#comparing-a-fixed-suite-of-games), with replicate bootstrap intervals and no extra dependencies. Per-game analysis remains the default.

New tabular learners index observation/action IDs with a persistent digital
search tree. Legal-list order still breaks ties. See the
[archive parity and timing procedure](experiments.md#compare-keyed-tabular-training-against-list-backed-archives)
for the benchmark and its limits.

Custom learners may export `finish(model: Model, reason: E.Stop) -> Model` to flush episode-local state. It runs once per training episode, never on a partial checkpoint or during evaluation. Omitting it keeps the original behavior. See [the learner lifecycle](agents.md#learner-episode-completion).

For many-arm comparisons against one reference, [Holm-adjusted paired sign tests](analysis.md#multiple-arms-versus-one-reference) are opt-in; default mean intervals remain pointwise.

[Two-pile Nim](two-pile-nim.md) is a small CLI self-play arena with an independently checked optimal policy and exact exploitability comparisons.

See [offline datasets and Minari export](offline.md#minari-export) for logged-trajectory workflows.