# On-policy SARSA(0)

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

Sampled, tabular SARSA(0). Save each open transition until the next accepted step supplies the **actual** next action, even when exploratory. The target is r + γQ(next, chosen), not a maximum. Training uses the table learner’s 25% exploration rule; evaluation is greedy.

## Parameters

`alpha` (learning rate, default 0.25) and `gamma` (discount, default 0.9) are clamped to [0, 1].

## Episode ends

A terminal transition has zero continuation. A time cutoff instead uses the expected training-policy value, including the U32 action-index bucket sizes; no extra action is sampled. An illegal action produces no new transition, but the training finish hook credits the last pending real reward with zero continuation. A partial checkpoint retains the pending transition.

## Laws

`terminal_clears`, `truncation_clears` and `finish_clears` concern the learner’s pending buffer. They do not prove convergence. See the [statements](laws.bend) and [proofs](proof.bend).

## Checks

The fixtures check a non-greedy successor action, terminal and cutoff targets, and that an illegal exit credits only the pending real reward. Run `bend agents/sarsa/checks.bend` for the [fixtures](checks.bend), or `bend agents/sarsa/proof.bend --verdict` for the independent proof check.

## Example plan

From the repository root, run the [shipped plan](../../experiments/cliff-sarsa.json):

```sh
node experiment.mjs run experiments/cliff-sarsa.json runs/cliff-sarsa
```
