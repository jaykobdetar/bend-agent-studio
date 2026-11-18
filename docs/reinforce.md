# REINFORCE with a state baseline

Run `node experiment.mjs run experiments/reinforce-orchard.json OUT`. Training
samples a categorical softmax over **the current public legal actions** (max
logit subtracted for stability, top 24 random bits used for the F32 draw).
Evaluation chooses the first highest-logit legal action. Numeric F32 probabilities
and sampling are approximations to the continuous softmax policy.

Accepted steps buffer the pre-update probabilities, choice, reward, current
state baseline and γᵗ. No policy or baseline changes mid-episode. At finish,
compute backward discounted returns G and apply α γᵗ (G−b(s)) (1[action=chosen]−p)
to each legal action's logit. Update the baseline with β (G−b(s)); advantages
use the frozen episode baseline, not a value learned from this episode. Both
limits and illegal stops use zero continuation for the finite observed episode.
There is no fabricated reward or gradient for a rejected action. Empty episodes
do nothing, and finishing resets the buffer and discount power.

The optional custom-agent method `learn_context(model, legal, event)` in the
entry module opts into a public-context hook and requires `finish`. Its ordered
legal action list comes from the source state's public view, not the next state,
and never exposes hidden simulator state. This is useful when learning needs
the action probabilities that were available at a particular decision. The
ordinary `learn(model,event)` contract, transition/replay data schema, and
archived runners are unchanged. Only contextual learners pay for an extra view
lookup. Built-in and existing custom agents need no migration.
