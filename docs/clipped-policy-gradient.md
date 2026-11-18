# Small clipped policy gradient

`node experiment.mjs run experiments/clipped-pg-orchard.json OUT` trains
a PPO-style illustrative learner, **not a full PPO implementation**. One
trainable tanh unit reads (observation mod 16)/8−1; each legal action has its
own output slope and intercept. State aliasing is deliberate. Evaluation picks
the first maximal legal logit. No deep networks, GAE, entropy bonus or optimizer
dependency. All parameters are bounded to ±8 except the tabular value baseline.

During collection the policy and baseline are frozen. Each accepted decision
stores its public legal list, old action probability and baseline. At each
episode finish Monte Carlo returns form the advantages; truncations and illegal
stops have no artificial continuation. Empty episodes count toward a batch.
After the configured batch of episodes, make deterministic sample-wise ascent
passes over the batch (recent episodes first, chronological within each);
fit the critic separately by squared-error SGD against the returns. Advantages
and denominators are never recomputed during optimization. This is sequential
SGD, not a gradient averaged over a whole minibatch. An incomplete final batch
is deliberately retained in the checkpoint, not silently flushed on evaluation.

The objective is min(rA, clip(r,1−ε,1+ε)A), r = π_new/π_old. A positive
advantage above the upper clip and negative advantage below the lower clip
produce zero policy gradient; the opposite sides remain active. The policy
update includes the γᵗ occupancy weight and full tanh chain rule. Probability
uses F32 softmax and a discrete 24-bit draw. Batch size/epochs are 1–32,
rounded down; clip, gamma, alpha and beta are clamped to [0,1]. Reward scaling
matters. Run `bend clipped_pg_checks.bend` and `bend clipped_pg_proof.bend --verdict`.
