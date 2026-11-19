# n-step expected TD control

[Experiment guide](../../EXPERIMENTS.md#change-the-world-policy-or-learner) · [Implementation](agent.bend) · [Checks](checks.bend) · [Laws](laws.bend) · [Proofs](proof.bend)

Run commands from the repository root.

Run `node experiment.mjs run experiments/cliff-n-step.json runs/cliff-n-step`
on a runner with training episode-end callbacks. The model holds at most n−1
unfinished transitions between updates; a saved partial checkpoint includes
them. n is clamped to 1–32 and rounded down; alpha and gamma to [0,1].
For an open n-step window, update the oldest pair with the discounted reward
sum plus γⁿ times the expected training-policy value after the window. The
greedy action gets the exploitation mass; the exploratory quarter follows
the actual U32 modulo selector. n=1 is one-step expected TD, not sampled SARSA.

At a true terminal flush every remaining suffix, oldest first, with zero
continuation. At a truncated open state all suffixes share its expected value
measured *before* the flush. On an illegal stop there is no fabricated
transition or rejected-action update: finish credits only pending real rewards
and clears the buffer. Evaluating a saved model never drains a training buffer.
Run `bend agents/n_step/checks.bend` and `bend agents/n_step/proof.bend --verdict`.
