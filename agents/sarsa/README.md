# On-policy SARSA(0)

[Experiment guide](../../EXPERIMENTS.md#change-the-world-policy-or-learner) · [Implementation](agent.bend) · [Checks](checks.bend) · [Laws](laws.bend) · [Proofs](proof.bend)

Run commands from the repository root.

Run `node experiment.mjs run experiments/cliff-sarsa.json runs/cliff-sarsa`
from a checkout with the once-per-episode training finish hook. This discrete
custom learner uses the same 25% exploration rule as the table agent; evaluation
is greedy. Alpha and gamma default to 0.25 and 0.9 and are clamped to [0,1].

For an ordinary open transition SARSA saves the state, action and reward.
The next accepted transition supplies the **actual** next action, even when it
was exploratory. The update is Q ← Q + α(r + γ Q(next,chosen) − Q). Terminal
uses zero continuation. Time truncation uses the expected training-policy
value (including U32 action-index bucket sizes), not a sampled extra action.
A rejected action ends training without an artificial transition: finish credits
the last pending real reward with zero continuation. A partial checkpoint is
not an episode end; its pending transition is part of the saved model. Old
archives keep their old agent code. Run `bend agents/sarsa/checks.bend` for exact
numeric cases and `bend agents/sarsa/proof.bend --verdict` for buffer-clearing laws.
