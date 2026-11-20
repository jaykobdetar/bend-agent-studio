# After the training tie-breaking fix

## Protocol fixed before the reruns

Rerun the three original challenge manifests unchanged: Locksmith Courier,
Switchboard (two cues), and Storm Reserve. Rerun the original two-arm Apex Kart
transfer design, with the same eight practice layouts and four frozen test
layouts. Use the reviewed R10.2 source with Node 24.22.3 and Bend 2.0.40.
Keep the original results as the before period. The original seed blocks,
scenario definitions, effective training budgets, validation choices and test
episodes are reused deliberately: the before/after comparison tests a change
to training, not a redesign or a fresh-seed replication. No final results
are used to select a checkpoint, arm, layout, seed or stopping point.

The primary question is **does plain Q-learning deliver on the 8-station
Courier at 8,192 accepted training steps?** Report the count of held-out
deliveries out of 256, all eight per-model counts out of 32, the final mean
return, and the Dyna-Q versus Q difference within matched seed blocks. The
prior count was zero. Any post-fix delivery answers whether it now delivers;
the size and reliability of the change matter separately. If Dyna still leads,
describe the advantage at the fixed interaction budget, not at equal CPU cost.
If both are at ceiling, use the original validation checkpoints to describe
when, if anywhere, the policies first separate. Validation is descriptive and
does not replace the final test. The training fit is the unit of replication;
32 repetitions of a deterministic frozen Courier policy are not 32 independent fits.

Secondary comparisons are the final returns for all original challenge
arms and worlds, their existing validation curves, Storm Reserve's exact
frozen-policy return, and Kart's exact held-out-layout return and gravel
count. All axis/arm labels remain tied to the original designs. For Kart,
scores average both starts on each held-out layout and then across separately
trained fits; we report tabular vs shared Q, paired by existing training seed.
The optional Storm factorial and the separate Kart reflection ablation are
not rerun under this protocol.

## Results on R10.2

The new runs use R10.2 commit `87b8ef403a8317528455c2d4cbff6367a6d527ba`.
The original [challenge results](../results.json) and
[Kart transfer results](../kart-transfer/results.json) remain unchanged.

**Courier: no, plain Q still did not deliver at 8,192 steps.** All eight
Q-learning policies timed out in every held-out rollout; all eight Dyna-Q
policies always delivered at the optimum. The paired return gap was
**+265 in each seed block**, before and after. Both Dyna validation series
averaged −155 through 2,048 steps and +110 at 8,192 steps, while Q
stayed at −155. On the small three-station course both learned arms
still reached +29 by 512 steps. This pins down an interaction-budget
advantage on the long course, not an equal-compute or asymptotic result.

| 8-station Courier, final test | Before deliveries | After deliveries | Before → after mean return |
| --- | ---: | ---: | ---: |
| Plain Q | 0 / 256 | 0 / 256 | −155 → −155 |
| Dyna-Q (five backups) | 256 / 256 | 256 / 256 | +110 → +110 |
| Uniform | 3 / 256 | 3 / 256 | −152.965 → −152.965 |

At their original final checkpoints, the two-cue Switchboard
means stayed **−0.026 / +0.493 / +1.000** for raw / latest / full memory.
Changing training tie-breaking did not change which cues those inputs
can retain. On 12-period Storm Reserve, the frozen policies averaged
**6.818 → 7.166 (Q)** and **14.597 → 14.584 (Dyna-Q)** across the matched
held-out blocks. Exact evaluation over the specified weather model gives
**6.714 → 7.018** and **14.354 → 14.370**, respectively. Sampling and exact
evaluation should not be conflated. These are descriptive changes for the
fixed designs and seeds, not a claim that one learner generally improved.

**Kart transfer still favors the shared learner.** At 65,536 real moves,
it beat tabular Q in all eight post-fix matched seed blocks. The mean
gap was +1.094 (descriptive paired 95% t interval [+0.677, +1.511]),
versus +1.141 before. The one-step scripted driver still scored 4.25
and the oracle 4.75, both above either learner.

| Training moves | Tabular Q, before → after | Shared linear Q, before → after |
| ---: | ---: | ---: |
| 1,024 | 1.422 → 1.766 | 2.969 → 2.750 |
| 4,096 | 1.813 → 2.063 | 3.406 → 3.156 |
| 16,384 | 2.141 → 2.328 | 3.531 → 3.594 |
| 65,536 | 2.547 → 2.641 | 3.688 → 3.734 |

At the last Kart checkpoint, tabular Q had 16 → 19 gravel events and
shared linear Q stayed at zero over 64 held-out layout/start executions
per arm. Tabular Q still scored higher on the practice mixture:
4.609 versus 4.344 post-fix. The test changes layouts only, not physics.
It is not a fresh-seed replication, and neither learner matched the
scripted rule.

[Verified identities and Courier per-fit counts](identity.json) ·
[Challenge validation curves and per-fit test scores](results.json) ·
[Exact Storm scores by checkpoint](reserve-exact.csv) ·
[Kart frozen-policy outputs by layout and fit](kart-transfer-results.json)

## Reproduce

Start in a checkout containing reviewed R10.2 and this script. Supply the full
R10.2 commit SHA and a new output directory. Run the four jobs serially.
With guardrails or an interruption, resume with the **newly made archive's**
runner, not an archived copy of the original run. The sample
commands preserve the three checked-in plan paths and generate Kart's world
files with the original generator.

```sh
study=studies/complex-worlds/tie-breaking-fix
out=runs/challenges-r102
mkdir -p runs
node "$study/rerun.mjs" prepare "$out" "$R102_SHA"
node "$study/rerun.mjs" run "$out" "$R102_SHA" courier
node "$study/rerun.mjs" run "$out" "$R102_SHA" switchboard
node "$study/rerun.mjs" run "$out" "$R102_SHA" reserve
node "$study/rerun.mjs" run "$out" "$R102_SHA" kart-transfer
node "$study/rerun.mjs" collect "$out" "$R102_SHA"
```

The collector verified all 160 trials and 704 checkpoints in their sealed chains; the original
study's scorer rechecks every Kart preview/mirror transition and each
deterministic test path against the stock oracle. It records each archive's
source fingerprint and leaves existing files untouched. Use trusted local
archives only.
