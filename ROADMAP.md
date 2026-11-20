# Bend Agent Studio roadmap

This roadmap is for the agent continuing development. It turns the November 2026 review into ordered, self-contained work items. Each item has a goal, the files involved, steps, acceptance criteria, and the docs to update.

**Positioning.** The project is a verified sandbox for small, exactly solvable reinforcement-learning problems. Its advantages are machine-checked engine laws, bit-exact replay from sealed checkpoints, and exact oracles next to learned results. It does not compete on scale, deep RL, or ecosystem size. Gaps are narrowed by interoperating with mature tools where possible, and by native work only where exact oracles add something those tools cannot.

## Ground rules for every item

1. **Toolchain.** Bend 2.0.40 and Node 24.22.3 (the CI versions). Do not upgrade either as part of a feature.
2. **Dependencies.** Studio, the Node runner, and the default analysis use only standard libraries. Put anything needing third-party packages in its own folder with its own manifest, like `mcp/`. Examples: Gymnasium, MLflow, Minari, rliable, Matplotlib.
3. **Existing runs keep working.** Archived runs replay with the code stored in their `code/` folder, so engine changes affect only new runs. Do not change sealed file formats, the seed scheme, or the random-number generator without a schema bump. A changed generator produces different trajectories. It needs a new, separately identified design (see EXPERIMENTS.md).
4. **Laws before refactors.** When an item replaces a data structure or adds a learner, write the protecting laws first (phase 1), then make the change.
5. **Verification.** Each change passes `npm test`, `bend checks/checks.bend`, `bend checks/benchmark_checks.bend`, `bend checks/study_checks.bend`, and `bend laws/PROOF.bend`, plus the full CI workflow, including the BendTT verdict and the Windows job.
6. **Document the change alongside the code.** Use the documentation checklist below and update the status table when a roadmap item changes state.
7. **One item per change,** small enough to review. Items in the same phase can run in parallel unless a dependency is listed.

### Documentation checklist

- Update the matching [guide](README.md#guides) when user-visible behavior changes; keep worked examples and the [command reference](docs/commands.md) accurate.
- Run `node checks/docs_check.mjs` and the full tests. For direct-main changes, verify the exact hosted result. Explain any new documentation-check exception.

Effort: **S** is under a day, **M** is a few days, **L** is a week or more.

---

## Phase 0: completed foundations

| ID | Item | Implementation | Acceptance |
| --- | --- | --- | --- |
| P0.1 | Crash recovery for Studio training | [#2](https://github.com/jaykobdetar/bend-agent-studio/pull/2) | Force-killing Studio (`kill -9`) during training leaves no runner or `bend` process. A restart cannot start a second concurrent training. |
| P0.2 | MCP server | [#3](https://github.com/jaykobdetar/bend-agent-studio/pull/3) | See *MCP design reference* below. Tools return JSON without writing to the server's stdout. Long work runs in child processes. Paths are confined to a workspace root. |
| P0.3 | rliable-style statistics in `analysis/analyze.py` | [#7](https://github.com/jaykobdetar/bend-agent-studio/pull/7) | Adds IQM, the stratified bootstrap over replicates, and probability of improvement. Optional performance-profile data. Stays standard-library only, or uses an optional export in rliable's input layout. Docs state when each interval is appropriate. |
| P0.4 | Gymnasium wrapper for JSON finite worlds | [#4](https://github.com/jaykobdetar/bend-agent-studio/pull/4) | Exposes any `worldDefinition` as a Gymnasium environment with identical transition probabilities (same bucket arithmetic as `core/finite_world.mjs` `buckets`). An oracle-optimal policy reaches the oracle value within sampling error. Lives in its own folder with its own requirements. |

See [Studio crash recovery](README.md#if-studio-stops-during-training) for supervisor and compiler limits, and the [MCP trust boundary](mcp/README.md) before using archived runs.

---

## Phase 1: laws (do these first)

Context: `laws/LAWS.bend` declares <!-- count:core-laws -->63<!-- /count --> laws and `laws/PROOF.bend` proves each one. Laws should cover structure, accounting, and information flow. Do not attempt floating-point results (convergence, exact values, unbiasedness). Do not restate determinism, which purity gives, or hidden-state isolation, which the `Transition<O>` type already enforces. Host-side properties (seed blocks, storage, statistics) stay as Node tests.

If Bend's `law` syntax cannot express a hypothesis (for example "for a key different from…"), use an unconditional special case or a guard expression, and record the limitation in a comment.

### Changes to existing laws

**L1. Restate `rejection_preserves_progress` on the path the engine uses (S).**
`E.accept` is called only from `laws/LAWS.bend`. The engine goes `E.decide` → `E.attempt`. Restate the law on `E.attempt` with `valid = False{}`: the turn's run is `Stopped{Report{model, score, steps, Illegal{action}}}` and its event is `None{}`. Then delete the unused `E.accept`, `E.take_step`, and `E.record_step` from `core/engine.bend`. Confirm with `git grep` that nothing else uses them.

**L2. Make the evaluation and one-update laws cover whole episodes (M).**
The current `evaluation_freezes_model` and `training_uses_one_update` cover only the `E.update` helper. Keep them as lemmas. Add episode-level laws over any world and policy, using a counting learner (`M = Nat`, `learn = m => e => 1n+m`):
- In `Evaluate` mode, the model in the report from `E.roll` (or `E.drive`) equals the model in the starting run.
- In `Train` mode, the report's model equals the starting model plus the number of accepted steps taken: report steps minus starting steps.

Prove both by induction over `drive`, following the shape of `observer_invariant` in `laws/PROOF.bend`. These directly verify rule 3 in EXPERIMENTS.md.

**L3. Cover more worlds with the observer and pause laws (S per world).**
`observer_invariant` and `split_budget` are already proven generically in `laws/PROOF.bend`. The laws `ferry_observer_preserves_report` and `ferry_pause_composes` apply them only to Ferry. If `law` can quantify over the `~` parameters, state them generically. Otherwise add instantiations for Cliff (`U32` state), one authored finite world, and CartPole (`Pole.State`).

**L4. State Double Q's defining property (S).**
Rule 7 says Double Q chooses and values its bootstrap with different tables. The current laws only prove that the other table is untouched. Add, for a nonempty action list `a <> rest`:
`DQ.continuation(left, right, E.Open{obs, a <> rest}) == T.lookup(right, obs, T.best_action(T.choices(a <> rest, left, obs)))`.
The nonempty condition matters: with no choices, `evaluate_best` returns 0.0 rather than a lookup.

### New laws, in priority order

**L5. A paused episode finishes the same as an unpaused one (M).** Highest value.
For any hooks, model, seed, mode and limit:
`C.finished(C.advance(limit, mode, C.start(hooks, model, seed, limit))) == Some{E.episode(hooks, mode, model, seed, limit)}`.
Why: step-budget training runs episodes in cursor segments, but `replay` in `core/experiment.mjs` rebuilds earlier training episodes with `runner.episode`. Today only `checks/world_campaign.mjs` checks that equivalence, and only on finite worlds. Both paths apply `E.mixed_hooks` to the policy and step, and both reset through the unmixed world. Check that this holds when writing the proof.

**L6. Truncation happens only at the horizon (S).** `E.truncated(O, 1n+n, view) == False{}`.

**L7. Steps never exceed the remaining limit (M).** A report from `E.drive` or `E.roll` has steps at most the starting steps plus `fuel` (`Nat.le` or an equivalent). `verifyBody` in `core/experiment.mjs` checks this on the host side.

**L8. A table update changes exactly one entry (M). Required before T2.2.**
- Read-after-write: `T.lookup(T.adjust(t, s, a, rule, target), s, a) == value of T.revised(rule, s, a, U32.add(T.visits(t, s, a), 1), T.lookup(t, s, a), target)`. This single form covers both new and existing keys, because absent keys read as 0 visits and value 0.0.
- Visits after write: `T.visits(T.adjust(...), s, a) == U32.add(T.visits(t, s, a), 1)`.
- Other keys unchanged: `T.lookup` and `T.visits` are the same for any `(s', a') != (s, a)`.

Phrase these on an abstract interface so the same statements hold after T2.2 swaps the list for a tree.

**L9. History memory resets each episode (S).** `H.reset(S, Hid, start, initial, seed) == H.Remembered{start(seed), initial}`. EXPERIMENTS.md rule 6.

**L10. Monte Carlo self-play clears its episode buffer at episode end (S).** `Player.monte_ending(True{}, cfg, t, history, g, future)` has an empty episode list. Add a small accessor if needed.

**L11. The logging policy follows the 16-bit draw rule (S–M).**
- Unconditional: `Logged.choose(actions, preferred, 0, word) == preferred`.
- With a hypothesis, if expressible: `choose` returns `preferred` whenever `U32.and(word, 65535) >= buckets`.
- `Logged.base` always evaluates with word 0 in `Evaluate` mode. This holds by definition, so state it to pin it down.

The bucket-count formula stays host-tested, because `actionBuckets` in `offline/dataset.mjs` duplicates it.

**L12. Laws for each new learner.** See phase 5. Write them with the learner, not afterwards.

**Docs for phase 1:** the law count and "Formal Properties" list in README.md, and the paragraph in EXPERIMENTS.md that lists the propositions.

---

## Phase 2: throughput

**T2.1. `--jobs N` for local parallel trials (S).** No dependencies.
- Add `--jobs N` to `experiment.mjs run` and `resume`. The parent builds the backend and publishes the manifest once, as `run` does today. It then spawns N children running the archived runner, `node <out>/code/experiment.mjs resume <out> --shard i/N`, and aggregates their exit status and output.
- The no-clobber `immutable()` publication already makes concurrent shards safe. Do not compile once per child.
- Acceptance: a `--jobs 4` run produces checkpoint files byte-identical to a single-process run of the same plan, and `verify` passes. Wall-clock time is reported in the PR.
- Docs: the "Resume, reproduce, and inspect" section of EXPERIMENTS.md.

**T2.2. Key-addressed value tables (M). Depends on L8.**
- `T.Table` in `core/tabular.bend` is a `List<Entry>`, so every lookup is linear. Replace it with a tree keyed by (observation, action), for example a 32-bit observation path to an action path. Reuse the pattern and proofs of `core/weights.bend`, whose read-after-write is already proven.
- Check everything that touches tables: `core/study.bend`, `core/double_q.bend`, `core/dyna.bend` (values only; `Dyna.Model` stays a list because planning samples it by index), `core/offline.bend`, `agents/ucb/agent.bend` (`total` sums visits for one observation, so give the tree an equivalent), and `core/arena_table.bend`.
- Behavior must not change: greedy ties are decided by legal-list order, not table order, so action choices are unaffected. The model's JSON form and hash will change for new runs only.
- Acceptance: all L8 laws hold for the new implementation. `checks/benchmark_checks.bend` and `checks/study_checks.bend` pass unchanged. On a fixed plan such as `experiments/planning-budget.json`, train/validation/test metrics match the list version exactly. Report the speedup on one tabular plan.

**T2.3. Native or parallel Bend runtime spike (timeboxed to one day).**
- Find out whether Bend 2.0.40 can build `core/study.bend` for its native or parallel runtime (BendRT) in a form the Node host can call. The backend is currently the JavaScript module from compiling the generated study entry to an ES module.
- Adoption bar: episode reports and models must be **bit-identical** to the JS backend on the shipped plans. Watch `F32.cos`, `F32.tanh`, `F32.sqrt` and `F32.log`, which may differ between backends. Anything less breaks replay.
- Deliverable: a short findings note in the PR, with timings. Do not adopt unless the bar is met.

---

## Phase 3: benchmark worlds

Put generators in one script, where practical, that writes JSON worlds into `worlds/benchmarks/`. Commit the generated files, and add a check that regenerates and compares them, as `checks/memory_checks.mjs` does for the Tiger worlds. Record each world's oracle values in that check.

**B3.1. Gymnasium toy-text ports (M). Depends on P0.4 for acceptance.**
- FrozenLake 4×4 and 8×8, slippery and not. Taxi. CliffWalking 4×12 (the current `core/cliff.bend` is a smaller 5×3 variant, so its numbers are not comparable to published ones). Blackjack, with the dealer drawing to 17 and Gymnasium's default flags.
- These need the general state-machine format, not the `grid` shorthand. Gymnasium keeps every action legal and moves into a wall leave the agent in place, while the grid shorthand makes such moves illegal.
- Take step limits from Gymnasium's registered specs (`gymnasium.spec(id).max_episode_steps`). Do not hard-code them from memory.
- Acceptance: for FrozenLake, Taxi and CliffWalking, transition probabilities and rewards match Gymnasium's `env.unwrapped.P` exactly, compared as rationals. Blackjack matches a Monte Carlo estimate of the optimal-policy value within sampling error.
- Docs: a "Benchmark worlds" table in EXPERIMENTS.md and one example plan in `experiments/`.

**B3.2. bsuite-style diagnostic probes (M).**
- Deep sea (N×N, with a small cost for "right" and the action mapping fixed per generated world), umbrella length, memory length (reuse `tools/memory_world.mjs` where it fits), discounting chain, a noisy bandit, and catch.
- Acceptance: each world has a recorded oracle optimum and uniform baseline, plus a plan in `experiments/` sweeping the probe's size parameter. Plotting with `analysis/plot_curves.py` across sizes works.
- Docs: same table as B3.1, with one line per probe on what it tests.

---

## Phase 4: solvers and off-policy evaluation

**S4.1. Infinite-horizon discounted solvers (S).**
- `oracle` in `core/finite_world.mjs` is finite-horizon only. Add discounted value iteration (tolerance-based stop) and policy iteration, available as `node experiment.mjs oracle WORLD --discount G [--tolerance E]`.
- Acceptance: on Bridge and Detour, value iteration agrees with the finite-horizon oracle as the horizon grows, with discount 1 where terminal. Add a test in `checks/oracle_checks.mjs`.

**S4.2. Export to Cassandra `.pomdp` format (S–M).**
- Write finite worlds as `.pomdp` files so external solvers can run on them (SARSOP via APPL, or POMDPs.jl via POMDPFiles.jl).
- Documented mismatches:
  - Legal-action sets vary by state here, while the format assumes every action is available everywhere. Map illegal actions to a configurable large penalty plus an absorbing state, and document it.
  - Observations are deterministic functions of state, so the observation matrices are one-hot.
- Acceptance: for a fully observable world, an external solver's value matches S4.1 within tolerance (a manual check is acceptable; CI does not need SARSOP). The export is deterministic.

**S4.3. More off-policy estimators, scored against exact truth (M).**
- `offPolicy` in `offline/batch.mjs` currently computes trajectory-level importance sampling and its self-normalized form. Add:
  - per-decision importance sampling and its weighted version;
  - fitted Q evaluation, which backs up the **target** policy's action rather than the maximum (add an `Offline.Method` variant or a host-side implementation);
  - per-decision doubly robust estimates using the fitted Q evaluation values.
- Truth harness: for authored finite worlds, compute the target policy's exact value with `policyOracle` in `core/public_oracle.mjs`, using the fitted policy turned into data and the logging policy as `behavior`. Report each estimator's error.
- Acceptance: on the dispatch study, the scores CSV gains columns for each estimator and for the exact value. Over many independent datasets, the mean of each unbiased estimator lies within its confidence interval of the exact value.
- Docs: the "Fit from logs" section and the scoring description in EXPERIMENTS.md.

**S4.4. Minari dataset export (S–M, optional).** Export collected JSONL partitions to Minari's layout from an optional Python tool in its own folder. Its HDF5 format needs h5py. Acceptance: Minari loads the exported dataset, and episode counts and returns match the source.

---

## Phase 5: more learning algorithms

### A5.0. Decide how learners see episode ends (design decision; do first)

Finding: when an episode ends because of an illegal action, the engine produces no transition (`E.attempt` returns `None{}`), so `learn` is never told the episode ended. Learners that buffer within an episode would carry that buffer into the next episode. That includes pending SARSA updates, n-step buffers, eligibility traces, REINFORCE trajectories, and Monte Carlo histories. Episodes that end normally or at the limit are fine: their last transition has an `End` view or `truncated = True`.

Options:
- **(a) Recommended.** Add a `finish: M -> E.Stop -> M` hook, called once at every episode end. Provide a default that leaves the model unchanged, so existing agents need only a mechanical update. This changes the `E.Hooks` type and the generated adapter code in `core/experiment.mjs` (`bridgeFunctions`). Add a law: `finish` is called exactly once per report.
- (b) Document that buffering learners require worlds and policies that never produce illegal actions, and assert that in the host. Weaker.

Decision: implement the optional finish hook (a). Evaluation skips it; only completed training reports finalize. See [the lifecycle contract](EXPERIMENTS.md#learner-episode-completion).

### Learners

Implement each first as a **custom agent** in `agents/`, selected with `"method": "custom"` and `agentFile`. That avoids the string-built code generator in `core/experiment.mjs`. Promote to a built-in method only if needed. Each learner needs: a Bend unit check, a law where one fits, an example plan in `experiments/`, and a row in the README's algorithm list once in Studio.

| ID | Learner | Notes | Laws to add |
| --- | --- | --- | --- |
| A5.1 | SARSA(0) | The `learn` hook sees a transition but not the next chosen action. Buffer `(s, a, r)` in the model and apply it when the next transition reveals `a'`. At `End` use zero. At truncation, bootstrap with the expected value under the current policy, and document that choice. | Pending update cleared at `End` and truncation |
| A5.2 | n-step TD | Buffer of n transitions. Flush on `End` (no bootstrap) and on truncation (bootstrap). | Buffer empty after episode end; terminal targets have no bootstrap |
| A5.3 | TD(λ) with traces, tabular and linear | Traces live in the model. | Traces reset at episode end; `λ = 0` reduces to one-step TD on the same transition |
| A5.4 | REINFORCE with a baseline | Uses the episode buffer and needs A5.0's end signal. | Buffer cleared after the update |
| A5.5 | General linear function approximation | A feature function from observation to features. Reuse the `core/weights.bend` tree. | Read-after-write is already covered by the weight laws |
| A5.6 | Small clipped policy gradient (PPO-style, tiny networks) | Batches several episodes in the model. Keep the network small, as in `core/actor_critic.bend`. | Policy unchanged in `Evaluate` (covered by L2) |

Do not implement DQN-style deep networks or image observations. Use the P0.4 bridge to hand those experiments to Stable-Baselines3 or CleanRL.

---

## Phase 6: tracking, reports, and Studio

**V6.1. MLflow exporter (S).** An optional Python tool reads a verified, complete run folder and logs checkpoint metrics to a local MLflow tracking store.
- One MLflow run per (game, arm, replicate).
- Parameters come from the arm settings in the sealed plan. Metrics are logged per checkpoint, with `step` set to the budget.
- Tags record the run hash, backend hash and Bend version.

Acceptance: the MLflow UI shows learning curves that match `analysis/plot_curves.py` for the same run.

**V6.2. Run notes and tags (S).** A `notes.json` in the run root, outside the sealed files, holding free-text notes and tags. `verify` ignores it. The MCP `list_runs` tool and Studio display it.

**V6.3. Self-contained HTML report (S–M).** `node experiment.mjs report RUN OUT.html` writes one file with no external resources. It contains:
- validation and test curves with intervals, as inline SVG;
- the analysis summary table;
- for finite worlds, the oracle optimum and uniform baseline, plus a step-by-step explanation of the best and worst test episode from `explainDecisions`.

Acceptance: opens offline, and its numbers match `analysis/analyze.py`.

**V6.4. Studio comparison view and training queue (M).**
- Comparison: select several ready runs, or several arms within a run, and overlay validation curves with intervals. Add an endpoint such as `GET /api/runs/:id/summary` that reads checkpoints, not replays.
- Queue: first in, first out, one active job at a time. Queued jobs can be cancelled. Crash recovery (P0.1) must still hold for every job in the queue.

Acceptance: covered by `studio/studio_checks.mjs`, including a damaged run in the comparison set.

---

## Phase 7: optional

| ID | Item | Effort | Notes |
| --- | --- | --- | --- |
| O7.1 | MCP tools `env_reset` and `env_step` for playing a world interactively | S | Session state keyed per world. Same seeding as the engine, so a played episode can be compared with a replay. |
| O7.2 | More perfect-information arena games | S each | For example 4×4 connect-three, Nim variants, small dots-and-boxes. Each needs a `gameGraph` height check and exploitability results from `analysis/arena_tournament.mjs`. |
| O7.3 | Hidden-information arena, Kuhn poker, and counterfactual regret minimization (CFR) | L | Needs information sets in `core/arena.bend`. OpenSpiel stays far ahead. Do this only for a specific research question. |
| O7.4 | Exponent literals | S | `floatLiteral` in `core/finite_world.mjs` can emit `e+21`. Check that Bend 2.0.40 parses it by adding a reward of at least 1e21 to `checks/world_campaign.mjs`'s reward pool, or emit literals without `+`. |
| O7.5 | Multiple-comparison handling across many arms | S | Apply `analysis/sequential.mjs`'s `comparisons` parameter, or a Holm correction, in `analysis/analyze.py` when several arms are compared to one reference. |

## Follow-ups

| ID | Work |
| --- | --- |
| F8.1 | Give contextual learners only legal actions from the public world view. |
| F8.2 | Report the selected learning hook for every arm in CLI and MCP plan validation. |
| F8.3 | Run the full small-board arena check against a compiled self-play study in CI. |
| F8.4 | Document and recheck Studio's Node SQLite startup warning on each Node version bump. |

## Non-goals

- Deep RL at scale, image observations, or GPU training. Use the Gymnasium bridge to move ideas to mainstream libraries.
- A collaborative or hosted platform. The project stays local-first.
- Replacing the random-number generator for existing designs (see ground rule 3).
- Laws about floating-point results.

---

## MCP design reference (for P0.2 and O7.1)

- **Authoring (pure, fast):** `list_examples`, `validate_plan`, `validate_world`, `solve_world` (full, reactive, history or clock), `evaluate_policy_exact`, `build_memory_world`, `check_bend`.
- **Running (background jobs with an ID):** `start_run`, `resume_run` and `rerun`, `start_assessment`, `start_offline` (collect, fit or score), `job_status`, `cancel_job`. `select_confirmation` can run directly.
- **Inspection (read-only):** `list_runs`, `verify_run`, `summarize_results`, `learning_curve`, `get_checkpoint` (model only on request, with a size cap), `replay_episode` (paged frames), `explain_episode`, `sequential_test`, `arena_tournament`.
- **Play (process-local sessions):** `env_reset` and `env_step` for finite JSON worlds and public replay-compatible frames.
- **Constraints:**
  - Never write to stdout outside the protocol. `exportCsv`, `status`, `replay` and `executeTrials` must return values to the server, with only the CLI printing.
  - Run synchronous Bend work in child processes.
  - Map Node versions to executables for archived runs.
  - Keep every path inside one workspace root.
  - Treat only runs under that root as trusted.
  - One training job at a time, with timeouts and size caps.
  - No general command tool.
  - Annotate read-only tools as such.

---

## Status

Update this table in the same PR as each item.

**What remains.** The optional Minari export is available. The MLflow exporter is implemented under N9.10; the remaining Phase 7 items are tracked below. Phase 5 learners now ship with their own laws. Packed finite-world code generation enables bounded, compiled Taxi and Blackjack studies; [the measurements](tools/finite-layout/README.md) distinguish completed candidate runs from memory-censored baseline runs. Keep JavaScript as the production backend (T2.3).

| ID | Status | PR |
| --- | --- | --- |
| P0.1 | Implemented: interrupt and clean up supported local training processes | [#2](https://github.com/jaykobdetar/bend-agent-studio/pull/2) |
| P0.2 | Implemented: local MCP for the experiment lifecycle | [#3](https://github.com/jaykobdetar/bend-agent-studio/pull/3) |
| P0.3 | Implemented: Fixed-suite statistics and paired intervals | [#7](https://github.com/jaykobdetar/bend-agent-studio/pull/7) |
| P0.4 | Implemented: optional Gymnasium adapter for finite worlds | [#4](https://github.com/jaykobdetar/bend-agent-studio/pull/4) |
| L1 | Implemented: Rejection law on the live engine path | [#5](https://github.com/jaykobdetar/bend-agent-studio/pull/5) |
| L2 | Implemented: Whole-rollout evaluation and accepted-step accounting | [#8](https://github.com/jaykobdetar/bend-agent-studio/pull/8) |
| L3 | Implemented: Generic observer invariance and cursor splitting | [#9](https://github.com/jaykobdetar/bend-agent-studio/pull/9) |
| L4 | Implemented: Double Q separates bootstrap selection and valuation | [#6](https://github.com/jaykobdetar/bend-agent-studio/pull/6) |
| L5 | Implemented: Complete cursor and ordinary episode reports agree | [#10](https://github.com/jaykobdetar/bend-agent-studio/pull/10) |
| L6 | Implemented: Positive remaining fuel never truncates a transition | [#11](https://github.com/jaykobdetar/bend-agent-studio/pull/11) |
| L7 | Implemented: Accepted steps do not exceed starting steps plus fuel | [#12](https://github.com/jaykobdetar/bend-agent-studio/pull/12) |
| L8 | Implemented: Table updates preserve other keys | [#13](https://github.com/jaykobdetar/bend-agent-studio/pull/13) |
| L9 | Implemented: History reset restores initial memory and seeds the world | [#15](https://github.com/jaykobdetar/bend-agent-studio/pull/15) |
| L10 | Implemented: Completed Monte Carlo episode drops its decision buffer | [#14](https://github.com/jaykobdetar/bend-agent-studio/pull/14) |
| L11 | Implemented: Logging policy follows its exact 16-bit draw rule | [#16](https://github.com/jaykobdetar/bend-agent-studio/pull/16) |
| L12 | Add the relevant law with each new learner | See Phase 5 |
| T2.1 | Implemented: parallel archived trial workers | [#17](https://github.com/jaykobdetar/bend-agent-studio/pull/17) |
| T2.2 | Implemented: keyed tables with archive parity and workload-specific timing | [#26](https://github.com/jaykobdetar/bend-agent-studio/pull/26) |
| T2.3 | Spike complete; keep JS backend | [findings](tools/native-spike/README.md) |
| B3.1 | Toy-text ports verified; bounded Taxi/Blackjack studies and archived replays pass with packed code generation; non-dyadic probabilities quantized | [Methods and checks](integrations/gymnasium/toy_text/README.md) |
| B3.2 | Six diagnostic families with verified two-size sweeps and oracle baselines | [Probe definitions and reproduction](worlds/benchmarks/probes/README.md) |
| S4.1 | Implemented: discounted value and policy iteration; discount 1 restricted to acyclic worlds | [#19](https://github.com/jaykobdetar/bend-agent-studio/pull/19) |
| S4.2 | Implemented: Cassandra export; independent LP value checks on fully observable examples | [#20](https://github.com/jaykobdetar/bend-agent-studio/pull/20) |
| S4.3 | Implemented: additional off-policy estimators, exact finite-world scoring and dispatch diagnostics | [#21](https://github.com/jaykobdetar/bend-agent-studio/pull/21) |
| S4.4 | Implemented: verified local Minari HDF5 export with split isolation | [Guide and limits](integrations/minari/README.md) |
| A5.0 | Implemented: optional train-only episode completion hook and exactly-once laws | |
| A5.1 | Implemented: sampled SARSA(0), finish integration and three buffer laws | [Notes](agents/sarsa/README.md) |
| A5.2 | Implemented: bounded n-step expected TD and three flush laws | [Notes](agents/n_step/README.md) |
| A5.3 | Implemented: tabular and linear expected TD(λ) | [Notes](agents/td_lambda/README.md) |
| A5.4 | Implemented: softmax REINFORCE with frozen state baseline | [Notes](agents/reinforce/README.md) |
| A5.5 | Implemented: typed sparse feature maps and action-specific linear weights | [Notes and measured limitations](agents/linear/README.md) |
| A5.6 | Implemented: tiny clipped-ratio policy gradient with frozen batches | [Notes](agents/clipped_pg/README.md) |
| V6.1 | Merged with N9.10; [PR #40](https://github.com/jaykobdetar/bend-agent-studio/pull/40) | [Exporter](integrations/mlflow/README.md) |
| V6.2 | Implemented: unsealed notes and tags in Studio and MCP | [#23](https://github.com/jaykobdetar/bend-agent-studio/pull/23) |
| V6.3 | Implemented: self-contained offline reports | [#25](https://github.com/jaykobdetar/bend-agent-studio/pull/25) |
| V6.4 | Implemented: local FIFO training queue and validation-curve comparison | [#28](https://github.com/jaykobdetar/bend-agent-studio/pull/28) |
| O7.1 | Implemented: bounded seeded public finite-world sessions | [MCP guide](mcp/README.md#play-a-finite-world) |
| O7.2 | Implemented: bounded two-pile Nim, complete transition graph and exact exploitability checks | [Notes](docs/two-pile-nim.md) |
| O7.3 | Deferred: requires a concrete research question | |
| O7.4 | Verified: compiler campaign includes positive-exponent F32 rewards | [Campaign](checks/world_campaign.mjs) |
| O7.5 | Implemented: optional Holm-adjusted paired sign tests across arms | [Method](docs/analysis.md#multiple-arms-versus-one-reference) |
| Repository reorganization | Completed: flat runtime, grouped learners, compatible entry points, task guides and archive gates | [Implementation record and original plan](docs/history/reorganization.md) |
| F8.1 | Implemented: contextual learn shares the source view’s ordered actions with the policy | [Rule coverage](docs/laws.md) |
| F8.2 | Implemented: CLI and MCP validation report the selected hook for each arm | [Agent interface](docs/agents.md) |
| F8.3 | Implemented: Linux CI trains a bounded self-play study and checks both board encodings | [Test guide](docs/testing.md) |
| F8.4 | Documented: Studio lock uses Node SQLite; pinned Node 24.22.3 starts without the warning | [Startup and recovery](docs/studio.md#if-studio-stops-during-training) |

## Phase 9: overnight work order

Work in ID order, on one branch per item. Merge only after the full Linux and Windows workflow passes for the specific revision, including MCP, archive gates and all pinned proofs. Do not replace archive baselines. A core byte change needs a reviewed transition and passing G4. Leave an item unmerged after three failed CI attempts and record the blocker. See the [overnight handoff](docs/history/overnight-2026-11-19.md).

| ID | Work | Acceptance target | Status |
| --- | --- | --- | --- |
| N9.0 | Housekeeping | Remove the named pre-rewrite remote branch and record Phase 9. | Merged; [PR #30](https://github.com/jaykobdetar/bend-agent-studio/pull/30) |
| N9.1 | One-command setup | Idempotent pinned Linux/macOS setup, devcontainer and clean-runner verification. | Merged; [PR #31](https://github.com/jaykobdetar/bend-agent-studio/pull/31) |
| N9.2 | Flagship study | Run and verify the eight-learner toy-text/probe study; publish outputs, uncertainty and a deterministic CI slice. | Merged; [PR #32](https://github.com/jaykobdetar/bend-agent-studio/pull/32) |
| N9.3 | Studio manifests and grid rendering | Validate and queue training plans from experiments/; render layout metadata with text fallback and mobile coverage. | Merged; [PR #33](https://github.com/jaykobdetar/bend-agent-studio/pull/33) |
| N9.4 | Upgrade warning | Weekly non-blocking latest-Bend-2.x check and single failure issue; document the pin upgrade procedure. | Merged; [PR #34](https://github.com/jaykobdetar/bend-agent-studio/pull/34) |
| N9.5 | Scaffolding and sweeps | Add safe agent/world/plan initialization and seeded sweeps with matching MCP tools. | Merged; [PR #35](https://github.com/jaykobdetar/bend-agent-studio/pull/35) |
| N9.6 | Replicate planning | Estimate paired bootstrap precision and sign-test power from pilot exports, for planning only. | Merged; [PR #36](https://github.com/jaykobdetar/bend-agent-studio/pull/36) |
| N9.7 | Laws and generated cases | Check finite lookups, logging mass and hook pause/resume; exercise validation, export and MCP boundaries. | Merged; [PR #37](https://github.com/jaykobdetar/bend-agent-studio/pull/37) |
| N9.8 | Formatter | Pin an isolated formatter outside archive inputs; separate formatting-only commit from CI enforcement. | Merged; [PR #38](https://github.com/jaykobdetar/bend-agent-studio/pull/38) |
| N9.9 | More environments | Add tested Acrobot dynamics and simultaneous zero-sum games with exact values and exploitability. | Merged; [PR #39](https://github.com/jaykobdetar/bend-agent-studio/pull/39) |
| N9.10 | MLflow export | Isolated optional tracking exporter with checkpoint curves checked against the plotting data. | Merged; [PR #40](https://github.com/jaykobdetar/bend-agent-studio/pull/40) |
| N9.11 | MCP environment tools | Expose bounded seeded finite-world sessions and check public frames against replay. | Merged; [PR #41](https://github.com/jaykobdetar/bend-agent-studio/pull/41) |

Core files stay out of the formatter. Format any core file only when a future
change already needs a reviewed core transition, with the exact old-to-new
hashes and a passing old-archive replay gate (G4). Do not start a standalone
core formatting change.

## Phase 10: training tie-breaking and study verification

Work in ID order with one item per commit on `main`. Run the full local gates
before pushing each item, including old-archive replay and resume. Keep past
study artifacts and historical baselines intact. Fix red CI before the next
item; after three unsuccessful attempts, revert that item without rewriting history.

| ID | Work | Status |
| --- | --- | --- |
| R10.1 | Stop the Studio test compiler leaving output in the repo root; guard against untracked root files after tests. | Implemented; [test guide](docs/testing.md) |
| R10.2 | Sample among exact greedy ties during training only. | Implemented; [evaluation and regression checks](docs/testing.md) |
| R10.3 | Run a preregistered flagship v2 with fresh seeds, preserving v1. | Implemented; [400-trial report and reproduction](studies/flagship-toy-text-v2/README.md) |
| R10.4 | Rerun the primary challenge and Kart transfer studies without overwriting their evidence. | Implemented; [paired before/after results and reproduction](studies/complex-worlds/tie-breaking-fix/README.md); optional Storm factorial and Kart ablation not rerun |
| R10.5 | Check deterministic tie behavior in exact-evaluation tools against rollouts. | Implemented; [tied-policy checks](docs/testing.md#tied-policy-evaluation) |
| R10.6 | Verify and remove merged Phase 9 branches; summarize Phase 10. | Complete; [Phase 10 handoff](docs/history/phase-10.md) |

## Phase 11: speed and scale on Linux

See the [Phase 11 checkpoint](docs/history/phase-11.md) for measured results and what remains.

Preserve exact archived results by default. Compare each candidate with the
[fixed performance baseline](docs/performance.md) on the target machine before
adopting it. A timing claim needs five runs and a median, with parity checked
first. Track runs that hit memory or tool limits separately; do not count them
as equivalent measurements. Keep source and backend transitions explicit, and
do not regenerate historical baselines. Work in order on `main` only after the
local gates pass; fix any hosted failure before publishing another item.

| ID | Work | Adoption condition | Status |
| --- | --- | --- | --- |
| P11.0 | Baseline workloads, profiles and machine fingerprint | Fixed workload versions, repeat timing and explicit profiling limits | Baseline recorded; hardware counters unavailable on host |
| P11.1 | Analysis acceleration, Linux scope and Studio replay limits | Analysis parity with measured benefit; regressions pass | Replay limits and optional same-seed superiority speedup; unchanged platform support and CI; broader bootstrap not adopted |
| P11.2 | Resource-aware shards and parallel evaluation | Sealed-byte parity, bounded memory and measured benefit | Disposable Linux memory cap verified; two-worker evaluation matched seals but regressed Bridge. No automatic runtime change |
| P11.3 | Exact evaluation, sequential extension and reuse | Separate exact metrics and a prespecified stopping rule; verified reusable bytes | Partial: validation-only stopping implemented; exact annotation and cache drafts not adopted |
| P11.4 | Warm engine prototype | Local Unix socket, parity and direct fallback; measurable benefit | Pending |
| P11.5 | Fewer JavaScript–Bend calls | Episode and step checkpoints byte-identical, benchmark improvement | Not adopted: bounded episode benchmark regressed Dyna-Q; step budgets not tested |
| P11.6 | Bend parallel and CUDA population spike | Adopt only if exact and faster than the best comparable path | Bounded CPU diagnostic complete; CUDA case capped; not adopted |
| P11.7 | Cross-backend F32 operations | Correct rounding evidence and reviewed archive transition | Stock device mismatch reproduced; wider portable tanh resolved the two sampled midpoint refusals on CPU and CUDA. No exhaustive coverage or core change |
| P11.8 | Native twin for eligible finite environments | Local and generic builds match all eligible sealed checkpoints | Five-arm witness, threaded timing, original flagship cells and complete Bridge plan, archive handoff and Uniform AVX2; no production backend |
| P11.9 | Native compiler tuning | Retain exact parity and demonstrate additional speedup | Pending |
| P11.10 | CUDA population kernel | Local GPU parity and measured CPU/GPU crossover | One original flagship Q-learning cell matched all 90 checkpoints on the RTX 3060 Ti; no full matrix, GPU archive writer or crossover timing |
| P11.11 | JAX screening contingency | Use only if exact CUDA fails; outputs never sealed | Pending |
| P11.12 | Machine autotuner | Tune performance only, not results | Pending |
| P11.13 | Optional idle-time jobs | Explicit opt-in, owner activity stops jobs, resource limits | Pending |
| P11.14 | Self-hosted runner preparation | Documentation and inactive main-only template; owner registration required | [Example prepared](docs/self-hosted-runner.md); no registration or GPU job |
