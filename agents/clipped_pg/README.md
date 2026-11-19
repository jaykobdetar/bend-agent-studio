# Small clipped policy gradient

[Agent interface](../../docs/agents.md) · [Implementation](agent.bend)

## What it learns

A small clipped policy-gradient example, **not full PPO**. One trainable tanh unit reads (observation mod 16)/8−1; each legal action has an output slope and intercept. This deliberately aliases states. Evaluation takes the first maximum legal logit. There is no GAE, entropy bonus, deep network or external optimizer.

The objective is min(rA, clip(r, 1−ε, 1+ε)A), r = π_new/π_old. High ratios with positive advantages and low ratios with negative advantages give zero gradient; opposite sides remain active. Updates carry the γᵗ occupancy weight and differentiate the tanh unit. Softmax uses F32 and a discrete 24-bit draw.

## Parameters

`alpha` (policy rate, 0.02), `beta` (critic rate, 0.1), `gamma` (discount, 1) and `clip` (ratio clip width, 0.2) are clamped to [0, 1]. `batch` (episodes, 4) and `epochs` (passes, 2) are clamped to 1–32 and rounded down. Network parameters are bounded to ±8; the tabular value baseline is not. Reward scaling matters.

## Episode ends

Freeze policy and baseline while collecting. Each accepted choice stores its legal list, old action probability and baseline. At episode finish, Monte Carlo returns define advantages, with no artificial continuation on cuts or illegal stops. Empty episodes count toward a batch. At the batch boundary, ascend sample by sample (recent episodes first, chronological within each) with fixed old probabilities and advantages; train the critic separately by squared-error SGD. This is not an averaged minibatch gradient. Partial batches persist through checkpoints and are not flushed by evaluation.

## Laws

`evaluating_preserves_policy_and_pending_batch` states what happens to the model on the evaluation update path; it does not prove a trust-region or performance bound. See the [statements](laws.bend) and [proofs](proof.bend).

## Checks

The fixtures cover the hidden-unit chain rule, clipped and unclipped gradient directions, zero old probabilities, a two-action network gradient, and a frozen batch until its boundary. Run `bend agents/clipped_pg/checks.bend` for the [fixtures](checks.bend), or `bend agents/clipped_pg/proof.bend --verdict` for the independent proof check.

## Example plan

From the repository root, run the [shipped plan](../../experiments/clipped-pg-orchard.json):

```sh
node experiment.mjs run experiments/clipped-pg-orchard.json runs/clipped-pg-orchard
```
