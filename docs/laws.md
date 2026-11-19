# Laws

Run shell commands from the repository root.

## Formal Properties

The <!-- count:core-laws -->46<!-- /count --> core laws are stated in [laws/LAWS.bend](../laws/LAWS.bend) and proved in [laws/PROOF.bend](../laws/PROOF.bend). The learners declare <!-- count:learner-laws -->15<!-- /count --> additional laws in their own modules:

| Learner | Statements | Proofs |
| --- | --- | --- |
| SARSA | [Laws](../agents/sarsa/laws.bend) | [Proofs](../agents/sarsa/proof.bend) |
| n-step TD | [Laws](../agents/n_step/laws.bend) | [Proofs](../agents/n_step/proof.bend) |
| TD(λ) | [Laws](../agents/td_lambda/laws.bend) | [Proofs](../agents/td_lambda/proof.bend) |
| REINFORCE | [Laws](../agents/reinforce/laws.bend) | [Proofs](../agents/reinforce/proof.bend) |
| Sparse linear Q-learning | [Laws](../agents/linear/laws.bend) | [Proofs](../agents/linear/proof.bend) |
| Clipped policy gradient | [Laws](../agents/clipped_pg/laws.bend) | [Proofs](../agents/clipped_pg/proof.bend) |

- **Learning.** The engine applies the learner once per training transition and preserves the model during evaluation. The whole-rollout counting-learner laws prove evaluation freezes the counter and training changes it by exactly the accepted-step delta; the proof preserves the signed difference from an arbitrary starting counter. Updating one Double Q table preserves the other. With a nonempty legal-action list, Double Q selects the bootstrap action with the table being updated and values it with the other table. Dyna planning preserves recorded experience. Completing a Monte Carlo self-play episode clears its buffered decisions, not the learned table.
- **Episode completion.** A training report applies the optional finish callback once, without changing its score, step count or reason. Evaluation skips it; reading a completed segment again cannot apply it twice.
- **Episode boundaries.** On the engine’s actual decision path, rejecting an illegal action preserves model, score and accepted steps, produces no transition and ends the episode. Only an open view at zero remaining fuel is truncated; positive fuel never causes truncation. Each report increases the episode count by one, including illegal exits. From any starting run, the final step count is at most the initial count plus available fuel.
- **Observations and replay.** The history wrapper preserves legal actions and rewards. At each reset it restores the configured memory and seeds the underlying world anew. For any typed world and agent hooks, observing decisions preserves the final report, and splitting an interaction budget gives the same cursor as advancing once, including model, seed and remaining horizon. These laws cover both training and evaluation. With legacy identity-finish hooks, completing a fresh raw cursor yields exactly the ordinary episode report for all worlds and policies, including the model, score, steps and stop reason.
- **Sparse table updates.** The addressed observation/action key reads back the revised F32 value and its incremented U32 visit count. All other keys preserve both reads, even when a key was absent or input entries are not unique.
- **Offline logging.** Zero exploration buckets always select the preferred action, as does every masked 16-bit draw at or above the threshold. The base action is computed in evaluation mode with word zero. The propensity formula is separately tested across all 65,536 draws.

The [native runtime spike](../tools/native-spike/README.md) reports sampled CPU/JS replay parity and timings; the supported backend remains JavaScript.
