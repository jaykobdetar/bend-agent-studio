# Expected TD(λ) with accumulating eligibility traces

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

Expected TD(λ) with accumulating eligibility traces. Form δ = r + γ E[Q(next,a)] − Q(s,a), add current features to the decayed trace, then apply αδe to active weights. The expectation uses the actual epsilon-greedy training policy. At λ=0 only the current gradient contributes.

## Parameters

`alpha` (0.1), `gamma` (0.9) and `lambda` (0.8) are clamped to [0, 1]. `linear` defaults to 0 (one parameter per observation/action); a value of at least 1 enables one shared bias per action plus 256 indicators keyed by the low eight observation bits. This can transfer credit or alias observations. Both modes accept arbitrary U32 action IDs.

## Episode ends

Terminals have zero continuation; open time cutoffs still bootstrap. Continuing traces decay by γλ. Terminal, truncated and illegal exits clear the traces. An illegal action generates no extra transition or reward. A scheduler pause does not clear traces. Memory grows with distinct active state-action features visited in an episode.

## Laws

`finish_reset`, `no_carry_zero_factor` and `one_step_weights` cover the reset, zero-carry case and one-step weight relation. See the [statements](laws.bend) and [proofs](proof.bend).

## Checks

Fixtures check backward credit on tabular and linear features, the λ=0 update in both modes, cutoff bootstrapping, and no carry across episode ends. Run `bend agents/td_lambda/checks.bend` for the [fixtures](checks.bend), or `bend agents/td_lambda/proof.bend --verdict` for the independent proof check.

## Example plan

From the repository root, run the [shipped plan](../../experiments/cliff-td-lambda.json):

```sh
node experiment.mjs run experiments/cliff-td-lambda.json runs/cliff-td-lambda
```
