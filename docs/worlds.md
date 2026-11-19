# Worlds

Run shell commands from the repository root.

## Author a world

* **A finite state machine** can be written as JSON. Each state has a unique numeric ID, an optional public observation ID, and a list of legal actions. Each action lists possible destination IDs, positive integer weights, and finite rewards. An empty action list marks a terminal state. Start from `worlds/bridge.json`.
* **A grid game** uses `S` for start, `G` for goal, `P` for pit, `#` for wall, and `.` for traversable space. A slip replaces the intended direction with a uniform legal direction. Multiple starts are sampled uniformly. See `worlds/detour.json`.
* **A Bend world** exports `State`, `Observation`, and `world(parameters)`. Its world provides reset, a public view, and a transition. The inventory example keeps opening stock, days left, and costs in the world. Its agent sees just the observation and legal order sizes. See `worlds/inventory.bend` and `experiments/inventory.json`.
## Play a finite world in Gymnasium

The optional [Gymnasium adapter](../integrations/gymnasium/README.md) uses the same JSON validator, grid expansion and exact integer sampling buckets as the runner. Supply a positive horizon and an explicit U32 seed to reproduce a Bend episode with the same actions. Gym action indices map to potentially sparse Bend IDs; consult the legal-action IDs in the public info. Natural terminal states win over time-limit truncation. For the exact undiscounted report score, use `info["bend_episode_score"]`, which rounds after each accepted move just as Bend does. Run the adapter's Python unittest suite for the Gym checker, sampling comparison, and optional compiled Bend replay comparison.

## Benchmark worlds

The benchmark suites contain <!-- count:benchmark-worlds -->19<!-- /count --> world definitions.

The first seven benchmarks are [Gymnasium 1.4.0 ports](../integrations/gymnasium/toy_text/README.md); all benchmarks use the general state-machine schema. Values below are expected **undiscounted episode scores**, computed on the Bend integer sampling buckets. “Optimal” is a finite-horizon optimal policy; “uniform” chooses uniformly among all available action IDs. They are not fitted scores.

| World | Horizon | Optimal | Uniform | What it tests |
| --- | ---: | ---: | ---: | --- |
| [FrozenLake 4×4 dry](../worlds/benchmarks/toy-text/lake4-dry.json) | 100 | 1 | 0.013940 | Sparse goal; wall actions do not advance the agent. |
| [FrozenLake 4×4 slippery](../worlds/benchmarks/toy-text/lake4-slip.json) | 100 | 0.744190 | 0.013940 | Same map, with stochastic directional slips. |
| [FrozenLake 8×8 dry](../worlds/benchmarks/toy-text/lake8-dry.json) | 200 | 1 | 0.001901 | Longer sparse-reward search. |
| [FrozenLake 8×8 slippery](../worlds/benchmarks/toy-text/lake8-slip.json) | 200 | 0.913220 | 0.001901 | Navigation under slip over the larger fixed map. |
| [Taxi-v4](../worlds/benchmarks/toy-text/taxi.json) | 200 | 7.930000 | −771.090999 | Plan pickup and delivery despite costly invalid attempts. |
| [CliffWalking 4×12](../worlds/benchmarks/toy-text/cliff4x12.json) | 200* | −13 | −2079.115971 | Cliff falls reset position and incur a penalty; not the smaller built-in Cliff. |
| [Blackjack-v1](../worlds/benchmarks/toy-text/blackjack.json) | 32* | −0.043113 | −0.394175 | Hit or stick with a hidden dealer card and the registered natural-hand rule. |
| [Deep Sea, N=3/5](../experiments/probe-deep-sea.json) | 3 / 5 | 0.99 / 0.99 | 0.12000 / 0.02625 | Directed exploration with a fixed per-cell action map and costly right moves. |
| [Umbrella, N=3/5](../experiments/probe-umbrella.json) | 3 / 5 | 1 / 1 | 0 / 0 | Delayed credit for the first choice, masked by zero-mean reward noise. |
| [Memory, N=3/5](../experiments/probe-memory.json) | 3 / 5 | 1 / 1 | 0 / 0 | Recall an initial cue after a delay; reactive optimal value is zero. |
| [Discount chain, N=3/6](../experiments/probe-discount.json) | 3 / 6 | 1.25 / 1.25 | 1.125 / 1.125 | Changing the delay changes which choice a discounted learner prefers. |
| [Noisy bandit, N=2/4](../experiments/probe-bandit.json) | 1 / 1 | 0.5 / 0.5 | 0 / −0.25 | Identify a better arm amid stochastic positive and negative payoffs. |
| [Catch, N=2/4](../experiments/probe-catch.json) | 2 / 2 | 1 / 1 | 0 / −0.5 | Move a paddle to intercept a visible falling ball across grid widths. |

For the six diagnostic families, slash-separated values follow their two sizes in order. They are [bsuite-style probes, not upstream replications](../worlds/benchmarks/probes/README.md); each link runs both sizes and produces one plot panel per size.

The Lakes and Taxi use their registered episode limits; *Gymnasium registers no limit for CliffWalking or Blackjack, so these are explicit study budgets.* Authored tabular rows preserve the intended rational probabilities; sampling uses the existing one-word approximation for non-dyadic probabilities, not Gym's RNG. See [generation, numerical precision and Blackjack checks](../integrations/gymnasium/toy_text/README.md) and [full-precision baselines](../integrations/gymnasium/toy_text/baselines.json). Run the [example plan](../experiments/toy-text.json) with `node experiment.mjs run experiments/toy-text.json runs/toy-text`.

## Regenerate the Tiger worlds

The Tiger experiment reads three generated JSON files. Each starts from the same seven-state world and uses a different rule file to determine what the agent can observe after listening. Sound exposes the latest sound. Clock adds the number of listens. Evidence exposes a memory state encoding the listen count and the difference between the two sound counts. See the [base Tiger world](../worlds/tiger.json) and [experiment manifest](../experiments/tiger.json).

The generator enumerates reachable combinations of underlying world state, memory state, and step number. It copies each action's outcome order, weights, and rewards. At depth eight it emits a terminal state with an empty action list. Explicitly storing these states and transitions produces 42 states for Sound, 42 for Clock, and 182 for Evidence. The [observation-memory generator](../tools/memory_world.mjs) builds these worlds.

To rebuild all three files after editing the base world or a `worlds/tiger-*-rules.json` file, run this from the repository root with Node 24:

```sh
for variant in sound clock evidence; do
  node tools/memory_world.mjs worlds/tiger.json "worlds/tiger-${variant}-rules.json" \
    --task-horizon 8 > "worlds/tiger-${variant}-h8.json" || exit 1
done
```

Run `node checks/memory_checks.mjs` to rebuild the worlds in memory, compare them with the checked-in JSON, and verify that always listening ends the task after eight steps with a return of −8.

### Discounted full-state planning

See [Discounted full-state planning](analysis.md#discounted-full-state-planning).

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

## Acrobot and simultaneous matrix games

[Acrobot](../worlds/acrobot.bend) uses the standard book equations, two unit links and masses, half-link centers of mass, gravity 9.8 and a fourth-order Runge–Kutta update every 0.2 s. Public observations are the two angles and angular velocities, in radians and radians per second. Actions 0, 1 and 2 apply torques −1, 0 and +1 to the second joint. Reset jitters all four coordinates deterministically in [−0.1, 0.1). The update wraps angles, caps angular velocities at 4π and 9π, and uses the standard tip-height terminal condition. The reward is −1 per nonterminal step and zero on success; the plan stops at 500 steps. The authored `acrobot` domain uses two offset coarse tilings and a bias with the existing [sparse linear learner](../agents/linear/README.md). The [plan](../experiments/acrobot.json) demonstrates training and replay, not a solved-criterion result.

The [matrix catalog](../worlds/benchmarks/matrix-games/games.json) has RPS, weighted RPS, Matching Pennies, a rectangular game and a degenerately tied negative saddle. Each integer entry is a row payoff; the column payoff is its negative. The [generated Bend world](../worlds/benchmarks/matrix-games/world.bend) commits the other seat to a private salted draw at reset. The learning seat sees only a constant observation and the fixed legal actions for its own seat. It then commits without seeing the other action. The one terminal transition reveals the pair and settles from the correct seat's perspective. Neither decision is conditioned on the other. The fixed opponent uses a U32 modulo draw (at most one word of imbalance per action); the exact analysis uses the payoff matrix without this sampling approximation.

The [matrix plan](../experiments/matrix-games.json) trains the two seats separately against the private random opponent. It does not present the game as alternating-play self-play. See [matrix analysis](analysis.md#matrix-game-values-and-exploitability) for measuring the resulting seat policies together.
