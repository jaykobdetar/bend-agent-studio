# REINFORCE with a state baseline

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

REINFORCE learns softmax policy logits and a state baseline. Training samples from the **current public legal action list** using max-subtracted logits and a 24-bit F32 draw; evaluation picks the first highest-logit legal action. The finite draw and F32 probabilities approximate continuous softmax.

The optional `learn_context(model, legal, event)` callback receives the source view’s public action list, not the next state’s. It requires `finish`; ordinary agents can keep `learn(model,event)` and do not pay for the extra view lookup.

## Parameters

`alpha` (policy rate, default 0.05), `beta` (baseline rate, default 0.1), and `gamma` (discount, default 1) are clamped to [0, 1].

## Episode ends

During an episode, buffer the chosen action, ordered probabilities, reward, baseline and γᵗ; neither policy nor baseline changes mid-episode. At finish, compute discounted returns backward, then apply α γᵗ (G−b(s)) (1[action=chosen]−p) and update the baseline by β(G−b(s)), using the frozen baseline. Time limits and illegal stops have zero continuation; an illegal choice itself gets no reward or gradient. An empty episode does nothing, and finish resets the history and discount power.

## Laws

`episode_buffer_empty` proves the post-finish history is empty. It does not establish unbiasedness for a truncated trajectory. See the [statements](laws.bend) and [proofs](proof.bend).

## Checks

Fixtures check a two-action gradient, the learned baseline, a singleton legal set, policy draw boundaries and an illegal finish with prior accepted work. The [contextual learner integration test](../../checks/experiment_checks.mjs) also checks archived policy snapshots and frozen replay. Run `bend agents/reinforce/checks.bend` for the [fixtures](checks.bend), or `bend agents/reinforce/proof.bend --verdict` for the independent proof check.

## Example plan

From the repository root, run the [shipped plan](../../experiments/reinforce-orchard.json):

```sh
node experiment.mjs run experiments/reinforce-orchard.json runs/reinforce-orchard
```
