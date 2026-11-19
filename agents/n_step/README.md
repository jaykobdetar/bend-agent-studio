# n-step expected TD control

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

Tabular n-step expected TD. On a full window, update the oldest pair from the discounted rewards plus γⁿ times the expected training-policy value. Exploitation goes to the greedy action; the exploratory quarter follows the U32 modulo selector. With n=1 this is one-step expected TD, not sampled SARSA.

## Parameters

`n` (default 3) is clamped to 1–32 and rounded down. `alpha` (learning rate, default 0.25) and `gamma` (discount, default 0.9) are clamped to [0, 1].

## Episode ends

A true terminal flushes every remaining suffix, oldest first, with zero continuation. All suffixes at a truncated open state use the same expected value measured before the flush. An illegal exit credits pending real rewards only. An interrupted model holds at most n−1 unfinished transitions; evaluating it does not drain its buffer.

## Laws

`terminal_flush`, `truncated_empty` and `finish_empty` specify that the pending history is empty at the respective boundaries. See the [statements](laws.bend) and [proofs](proof.bend).

## Checks

The fixtures check a two-reward target with γ² continuation, suffix values on terminal/truncated flushes, and an illegal exit before a full window. Run `bend agents/n_step/checks.bend` for the [fixtures](checks.bend), or `bend agents/n_step/proof.bend --verdict` for the independent proof check.

## Example plan

From the repository root, run the [shipped plan](../../experiments/cliff-n-step.json):

```sh
node experiment.mjs run experiments/cliff-n-step.json runs/cliff-n-step
```
