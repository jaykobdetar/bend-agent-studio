# Expected TD(λ) with accumulating eligibility traces

Run `node experiment.mjs run experiments/cliff-td-lambda.json OUT`.
With `linear: 0` there is one parameter per (observation, action). With
`linear: 1`, each action has a shared bias and 256 indicators indexed by the
low eight observation bits. Its value is their sum, so observations can share
credit or alias. Both modes accept arbitrary U32 action IDs.

For each accepted transition form δ = r + γ E[Q(next,a)] − Q(s,a), add its
active features to the decayed trace, then add αδe to every active weight.
The target uses the actual epsilon-greedy training policy; terminals use zero.
A truncated open state still bootstraps. Continuing traces decay by γλ;
terminal/truncated/illegal stops clear them, with no artificial reward/update.
Pausing does not end the episode. At λ=0 only the current gradient contributes,
so a tabular cell gets ordinary one-step TD and linear weights get the
corresponding one-step semi-gradient update. `bend td_lambda_checks.bend`
checks both numerically; `bend td_lambda_proof.bend --verdict` verifies the
weight update and reset laws. Trace storage is sparse and scales with distinct
active state-action features reached within one episode.
