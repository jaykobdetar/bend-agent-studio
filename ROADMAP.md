# Bend Agent Studio roadmap

This roadmap is for the agent continuing development. It turns the November 2026 review into ordered, self-contained work items. Each item has a goal, the files involved, steps, acceptance criteria, and the docs to update.

**Positioning.** The project is a verified sandbox for small, exactly solvable reinforcement-learning problems. Its advantages are machine-checked engine laws, bit-exact replay from sealed checkpoints, and exact oracles next to learned results. It does not compete on scale, deep RL, or ecosystem size. Gaps are narrowed by interoperating with mature tools where possible, and by native work only where exact oracles add something those tools cannot.

## Ground rules for every item

1. **Toolchain.** Bend 2.0.40 and Node 24.22.3 (the CI versions). Do not upgrade either as part of a feature.
2. **Dependencies.** Studio, the Node runner, and `analyze.py` use only standard libraries. Put anything needing third-party packages in its own folder with its own manifest, like `mcp/`. Examples: Gymnasium, MLflow, Minari, rliable, Matplotlib.
3. **Existing runs keep working.** Archived runs replay with the code stored in their `code/` folder, so engine changes affect only new runs. Do not change sealed file formats, the seed scheme, or the random-number generator without a schema bump. A changed generator produces different trajectories. It needs a new, separately identified design (see EXPERIMENTS.md).
4. **Laws before refactors.** When an item replaces a data structure or adds a learner, write the protecting laws first (phase 1), then make the change.
5. **Verification.** Each PR passes `npm test`, `bend checks.bend`, `bend benchmark_checks.bend`, `bend study_checks.bend`, and `bend PROOF.bend`, plus the full CI workflow, including the BendTT verdict and the Windows job.
6. **Docs in the same PR.** Update README.md and EXPERIMENTS.md with every user-visible change. That includes command and analysis-tool tables, the law count ("26"), and the README "Formal Properties" list. Then update the status table at the end of this file.
7. **One item per PR,** small enough to review. Items in the same phase can run in parallel unless a dependency is listed.

Effort: **S** is under a day, **M** is a few days, **L** is a week or more.

---

## Phase 0: in flight (confirm before starting phase 1)

| ID | Item | State at writing | Acceptance |
| --- | --- | --- | --- |
| P0.1 | Crash recovery for Studio training | Branch `studio/recover-training-after-crash` | Force-killing Studio (`kill -9`) during training leaves no runner or `bend` process. A restart cannot start a second concurrent training. |
| P0.2 | MCP server | Branch `feat/studio-mcp` | See *MCP design reference* below. Tools return JSON without writing to the server's stdout. Long work runs in child processes. Paths are confined to a workspace root. |
| P0.3 | rliable-style statistics in `analyze.py` | Assigned | Adds IQM, the stratified bootstrap over replicates, and probability of improvement. Optional performance-profile data. Stays standard-library only, or uses an optional export in rliable's input layout. Docs state when each interval is appropriate. |
| P0.4 | Gymnasium wrapper for JSON finite worlds | Assigned | Exposes any `worldDefinition` as a Gymnasium environment with identical transition probabilities (same bucket arithmetic as `finite_world.mjs` `buckets`). An oracle-optimal policy reaches the oracle value within sampling error. Lives in its own folder with its own requirements. |

Leftover from the review: delete the duplicate training check at `studio/server.mjs` (`jobs.size && ... status === 'training'`) if P0.1 has not already removed it.

---

## Phase 1: laws (do these first)

Context: `LAWS.bend` declares 26 laws and `PROOF.bend` proves each one. Laws should cover structure, accounting, and information flow. Do not attempt floating-point results (convergence, exact values, unbiasedness). Do not restate determinism, which purity gives, or hidden-state isolation, which the `Transition<O>` type already enforces. Host-side properties (seed blocks, storage, statistics) stay as Node tests.

If Bend's `law` syntax cannot express a hypothesis (for example "for a key different from…"), use an unconditional special case or a guard expression, and record the limitation in a comment.

### Changes to existing laws

**L1. Restate `rejection_preserves_progress` on the path the engine uses (S).**
`E.accept` is called only from `LAWS.bend`. The engine goes `E.decide` → `E.attempt`. Restate the law on `E.attempt` with `valid = False{}`: the turn's run is `Stopped{Report{model, score, steps, Illegal{action}}}` and its event is `None{}`. Then delete the unused `E.accept`, `E.take_step`, and `E.record_step` from `engine.bend`. Confirm with `git grep` that nothing else uses them.

**L2. Make the evaluation and one-update laws cover whole episodes (M).**
The current `evaluation_freezes_model` and `training_uses_one_update` cover only the `E.update` helper. Keep them as lemmas. Add episode-level laws over any world and policy, using a counting learner (`M = Nat`, `learn = m => e => 1n+m`):
- In `Evaluate` mode, the model in the report from `E.roll` (or `E.drive`) equals the model in the starting run.
- In `Train` mode, the report's model equals the starting model plus the number of accepted steps taken: report steps minus starting steps.

Prove both by induction over `drive`, following the shape of `observer_invariant` in `PROOF.bend`. These directly verify rule 3 in EXPERIMENTS.md.

**L3. Cover more worlds with the observer and pause laws (S per world).**
`observer_invariant` and `split_budget` are already proven generically in `PROOF.bend`. The laws `ferry_observer_preserves_report` and `ferry_pause_composes` apply them only to Ferry. If `law` can quantify over the `~` parameters, state them generically. Otherwise add instantiations for Cliff (`U32` state), one authored finite world, and CartPole (`Pole.State`).

**L4. State Double Q's defining property (S).**
Rule 7 says Double Q chooses and values its bootstrap with different tables. The current laws only prove that the other table is untouched. Add, for a nonempty action list `a <> rest`:
`DQ.continuation(left, right, E.Open{obs, a <> rest}) == T.lookup(right, obs, T.best_action(T.choices(a <> rest, left, obs)))`.
The nonempty condition matters: with no choices, `evaluate_best` returns 0.0 rather than a lookup.

### New laws, in priority order

**L5. A paused episode finishes the same as an unpaused one (M).** Highest value.
For any hooks, model, seed, mode and limit:
`C.finished(C.advance(limit, mode, C.start(hooks, model, seed, limit))) == Some{E.episode(hooks, mode, model, seed, limit)}`.
Why: step-budget training runs episodes in cursor segments, but `replay` in `experiment.mjs` rebuilds earlier training episodes with `runner.episode`. Today only `world_campaign.mjs` checks that equivalence, and only on finite worlds. Both paths apply `E.mixed_hooks` to the policy and step, and both reset through the unmixed world. Check that this holds when writing the proof.

**L6. Truncation happens only at the horizon (S).** `E.truncated(O, 1n+n, view) == False{}`.

**L7. Steps never exceed the remaining limit (M).** A report from `E.drive` or `E.roll` has steps at most the starting steps plus `fuel` (`Nat.le` or an equivalent). `verifyBody` in `experiment.mjs` checks this on the host side.

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

The bucket-count formula stays host-tested, because `actionBuckets` in `dataset.mjs` duplicates it.

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
- `T.Table` in `tabular.bend` is a `List<Entry>`, so every lookup is linear. Replace it with a tree keyed by (observation, action), for example a 32-bit observation path to an action path. Reuse the pattern and proofs of `weights.bend`, whose read-after-write is already proven.
- Check everything that touches tables: `study.bend`, `double_q.bend`, `dyna.bend` (values only; `Dyna.Model` stays a list because planning samples it by index), `offline.bend`, `agents/ucb.bend` (`total` sums visits for one observation, so give the tree an equivalent), and `arena_table.bend`.
- Behavior must not change: greedy ties are decided by legal-list order, not table order, so action choices are unaffected. The model's JSON form and hash will change for new runs only.
- Acceptance: all L8 laws hold for the new implementation. `benchmark_checks.bend` and `study_checks.bend` pass unchanged. On a fixed plan such as `experiments/planning-budget.json`, train/validation/test metrics match the list version exactly. Report the speedup on one tabular plan.

**T2.3. Native or parallel Bend runtime spike (timeboxed to one day).**
- Find out whether Bend 2.0.40 can build `study.bend` for its native or parallel runtime (BendRT) in a form the Node host can call. The backend is currently the JavaScript module from `bend study.bend -o study.mjs`.
- Adoption bar: episode reports and models must be **bit-identical** to the JS backend on the shipped plans. Watch `F32.cos`, `F32.tanh`, `F32.sqrt` and `F32.log`, which may differ between backends. Anything less breaks replay.
- Deliverable: a short findings note in the PR, with timings. Do not adopt unless the bar is met.

---

## Phase 3: benchmark worlds

Put generators in one script, for example `tools/benchmarks.mjs`, that writes JSON worlds into `worlds/benchmarks/`. Commit the generated files, and add a check that regenerates and compares them, as `memory_checks.mjs` does for the Tiger worlds. Record each world's oracle values in that check.

**B3.1. Gymnasium toy-text ports (M). Depends on P0.4 for acceptance.**
- FrozenLake 4×4 and 8×8, slippery and not. Taxi. CliffWalking 4×12 (the current `cliff.bend` is a smaller 5×3 variant, so its numbers are not comparable to published ones). Blackjack, with the dealer drawing to 17 and Gymnasium's default flags.
- These need the general state-machine format, not the `grid` shorthand. Gymnasium keeps every action legal and moves into a wall leave the agent in place, while the grid shorthand makes such moves illegal.
- Take step limits from Gymnasium's registered specs (`gymnasium.spec(id).max_episode_steps`). Do not hard-code them from memory.
- Acceptance: for FrozenLake, Taxi and CliffWalking, transition probabilities and rewards match Gymnasium's `env.unwrapped.P` exactly, compared as rationals. Blackjack matches a Monte Carlo estimate of the optimal-policy value within sampling error.
- Docs: a "Benchmark worlds" table in EXPERIMENTS.md and one example plan in `experiments/`.

**B3.2. bsuite-style diagnostic probes (M).**
- Deep sea (N×N, with a small cost for "right" and the action mapping fixed per generated world), umbrella length, memory length (reuse `memory_world.mjs` where it fits), discounting chain, a noisy bandit, and catch.
- Acceptance: each world has a recorded oracle optimum and uniform baseline, plus a plan in `experiments/` sweeping the probe's size parameter. Plotting with `plot_curves.py` across sizes works.
- Docs: same table as B3.1, with one line per probe on what it tests.

---

## Phase 4: solvers and off-policy evaluation

**S4.1. Infinite-horizon discounted solvers (S).**
- `oracle` in `finite_world.mjs` is finite-horizon only. Add discounted value iteration (tolerance-based stop) and policy iteration, available as `node experiment.mjs oracle WORLD --discount G [--tolerance E]`.
- Acceptance: on Bridge and Detour, value iteration agrees with the finite-horizon oracle as the horizon grows, with discount 1 where terminal. Add a test in `oracle_checks.mjs`.

**S4.2. Export to Cassandra `.pomdp` format (S–M).**
- Write finite worlds as `.pomdp` files so external solvers can run on them (SARSOP via APPL, or POMDPs.jl via POMDPFiles.jl).
- Documented mismatches:
  - Legal-action sets vary by state here, while the format assumes every action is available everywhere. Map illegal actions to a configurable large penalty plus an absorbing state, and document it.
  - Observations are deterministic functions of state, so the observation matrices are one-hot.
- Acceptance: for a fully observable world, an external solver's value matches S4.1 within tolerance (a manual check is acceptable; CI does not need SARSOP). The export is deterministic.

**S4.3. More off-policy estimators, scored against exact truth (M).**
- `offPolicy` in `batch.mjs` currently computes trajectory-level importance sampling and its self-normalized form. Add:
  - per-decision importance sampling and its weighted version;
  - fitted Q evaluation, which backs up the **target** policy's action rather than the maximum (add an `Offline.Method` variant or a host-side implementation);
  - per-decision doubly robust estimates using the fitted Q evaluation values.
- Truth harness: for authored finite worlds, compute the target policy's exact value with `policyOracle` in `public_oracle.mjs`, using the fitted policy turned into data and the logging policy as `behavior`. Report each estimator's error.
- Acceptance: on the dispatch study, the scores CSV gains columns for each estimator and for the exact value. Over many independent datasets, the mean of each unbiased estimator lies within its confidence interval of the exact value.
- Docs: the "Fit from logs" section and the scoring description in EXPERIMENTS.md.

**S4.4. Minari dataset export (S–M, optional).** Export collected JSONL partitions to Minari's layout from an optional Python tool in its own folder. Its HDF5 format needs h5py. Acceptance: Minari loads the exported dataset, and episode counts and returns match the source.

---

## Phase 5: more learning algorithms

### A5.0. Decide how learners see episode ends (design decision; do first)

Finding: when an episode ends because of an illegal action, the engine produces no transition (`E.attempt` returns `None{}`), so `learn` is never told the episode ended. Learners that buffer within an episode would carry that buffer into the next episode. That includes pending SARSA updates, n-step buffers, eligibility traces, REINFORCE trajectories, and Monte Carlo histories. Episodes that end normally or at the limit are fine: their last transition has an `End` view or `truncated = True`.

Options:
- **(a) Recommended.** Add a `finish: M -> E.Stop -> M` hook, called once at every episode end. Provide a default that leaves the model unchanged, so existing agents need only a mechanical update. This changes the `E.Hooks` type and the generated adapter code in `experiment.mjs` (`bridgeFunctions`). Add a law: `finish` is called exactly once per report.
- (b) Document that buffering learners require worlds and policies that never produce illegal actions, and assert that in the host. Weaker.

Ask the project owner before choosing. The decision affects every learner below.

### Learners

Implement each first as a **custom agent** in `agents/`, selected with `"method": "custom"` and `agentFile`. That avoids the string-built code generator in `experiment.mjs`. Promote to a built-in method only if needed. Each learner needs: a Bend unit check, a law where one fits, an example plan in `experiments/`, and a row in the README's algorithm list once in Studio.

| ID | Learner | Notes | Laws to add |
| --- | --- | --- | --- |
| A5.1 | SARSA(0) | The `learn` hook sees a transition but not the next chosen action. Buffer `(s, a, r)` in the model and apply it when the next transition reveals `a'`. At `End` use zero. At truncation, bootstrap with the expected value under the current policy, and document that choice. | Pending update cleared at `End` and truncation |
| A5.2 | n-step TD | Buffer of n transitions. Flush on `End` (no bootstrap) and on truncation (bootstrap). | Buffer empty after episode end; terminal targets have no bootstrap |
| A5.3 | TD(λ) with traces, tabular and linear | Traces live in the model. | Traces reset at episode end; `λ = 0` reduces to one-step TD on the same transition |
| A5.4 | REINFORCE with a baseline | Uses the episode buffer and needs A5.0's end signal. | Buffer cleared after the update |
| A5.5 | General linear function approximation | A feature function from observation to features. Reuse the `weights.bend` tree. | Read-after-write is already covered by the weight laws |
| A5.6 | Small clipped policy gradient (PPO-style, tiny networks) | Batches several episodes in the model. Keep the network small, as in `actor_critic.bend`. | Policy unchanged in `Evaluate` (covered by L2) |

Do not implement DQN-style deep networks or image observations. Use the P0.4 bridge to hand those experiments to Stable-Baselines3 or CleanRL.

---

## Phase 6: tracking, reports, and Studio

**V6.1. MLflow exporter (S).** An optional Python tool reads an `experiment.mjs export` CSV, or a run folder directly, and logs to a local MLflow tracking store.
- One MLflow run per (game, arm, replicate).
- Parameters come from the arm settings in the sealed plan. Metrics are logged per checkpoint, with `step` set to the budget.
- Tags record the run hash, backend hash and Bend version.

Acceptance: the MLflow UI shows learning curves that match `plot_curves.py` for the same run.

**V6.2. Run notes and tags (S).** A `notes.json` in the run root, outside the sealed files, holding free-text notes and tags. `verify` ignores it. The MCP `list_runs` tool and Studio display it.

**V6.3. Self-contained HTML report (S–M).** `node experiment.mjs report RUN OUT.html` writes one file with no external resources. It contains:
- validation and test curves with intervals, as inline SVG;
- the analysis summary table;
- for finite worlds, the oracle optimum and uniform baseline, plus a step-by-step explanation of the best and worst test episode from `explainDecisions`.

Acceptance: opens offline, and its numbers match `analyze.py`.

**V6.4. Studio comparison view and training queue (M).**
- Comparison: select several ready runs, or several arms within a run, and overlay validation curves with intervals. Add an endpoint such as `GET /api/runs/:id/summary` that reads checkpoints, not replays.
- Queue: first in, first out, one active job at a time. Queued jobs can be cancelled. Crash recovery (P0.1) must still hold for every job in the queue.

Acceptance: covered by `studio/studio_checks.mjs`, including a damaged run in the comparison set.

---

## Phase 7: optional

| ID | Item | Effort | Notes |
| --- | --- | --- | --- |
| O7.1 | MCP tools `env_reset` and `env_step` for playing a world interactively | S | Session state keyed per world. Same seeding as the engine, so a played episode can be compared with a replay. |
| O7.2 | More perfect-information arena games | S each | For example 4×4 connect-three, Nim variants, small dots-and-boxes. Each needs a `gameGraph` height check and exploitability results from `arena_tournament.mjs`. |
| O7.3 | Hidden-information arena, Kuhn poker, and counterfactual regret minimization (CFR) | L | Needs information sets in `arena.bend`. OpenSpiel stays far ahead. Do this only for a specific research question. |
| O7.4 | Exponent literals | S | `floatLiteral` in `finite_world.mjs` can emit `e+21`. Check that Bend 2.0.40 parses it by adding a reward of at least 1e21 to `world_campaign.mjs`'s reward pool, or emit literals without `+`. |
| O7.5 | Multiple-comparison handling across many arms | S | Apply `sequential.mjs`'s `comparisons` parameter, or a Holm correction, in `analyze.py` when several arms are compared to one reference. |

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

| ID | Status | PR |
| --- | --- | --- |
| P0.1 | In progress | |
| P0.2 | In progress | |
| P0.3 | Assigned | |
| P0.4 | Assigned | |
| L1–L3 | Not started | |
| L4 | Implemented: nonempty Double Q bootstrap law and proof | [#6](https://github.com/jaykobdetar/bend-agent-studio/pull/6) |
| L5–L12 | Not started | |
| T2.1–T2.3 | Not started | |
| B3.1–B3.2 | Not started | |
| S4.1–S4.4 | Not started | |
| A5.0–A5.6 | Not started | |
| V6.1–V6.4 | Not started | |
| O7.1–O7.5 | Not started | |
