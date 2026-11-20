# Apex Kart: transfer with a short public road preview

Published results on this page predate the training tie-breaking change. For
historical reproduction, use the [pre-change source tree](https://github.com/jaykobdetar/bend-agent-studio/tree/032375733bb9559d77cea59b812654fd35d5bfe5).

A shared feature learner handled **unseen track layouts** better than tabular
Q at the same number of real moves. It did not beat a one-step rule that
knows the physics. This is a local follow-up to [Apex Kart](../../../worlds/challenges/apex-kart/README.md),
not a replacement for the existing track or controller.

## Fair input and locked split

Both learned agents see exactly the same public input: current lane and
speed, remaining track cells, and the types of the next three road cells.
Neither sees a track ID, an expert action, or any curvature beyond the
preview. The feature arm uses the existing sparse linear Q update, with
shared coarse remaining-distance, speed, relative lane, preview, and
small combinations of those features. Near a right bend it reflects the
lane and steering coordinates; this does not choose an action for it.
Neither method is trained on human demonstrations.

The [design generator](design.mjs) locks eight practice layouts (four
originals and their mirrors), mixed uniformly on reset. Four distinct
layouts are never used to train: 9-cell Quarry Sprint, its mirror, a
shifted two-bend layout, and that layout's mirror. All layouts use the
same left/right grid starts, so the Quarry geometry is original but its
start grid differs from the single center start in the shipped example.
Once a start lane is chosen, physics are deterministic. Evaluation scores
both possible starts exactly, not repeated instances of the same start
counted as independent tests. There are eight paired fresh training fits.

The scripted diagnostic chooses the best immediate reward from the same
preview using known one-move dynamics. Since at most three cells can be
crossed in one move, it does not need to see beyond that preview. The
full-state oracle is a planning upper bound, not a fair learner. In the
practice mixture, 9 of 266 distinct public inputs hide different
one-move outcomes depending on the underlying layout.

## Frozen-policy results

These are mean returns over four fixed held-out layouts and both starts.
The higher the score, the faster and cleaner the race.

| Observed training moves | Tabular Q | Shared linear Q | Difference |
| ---: | ---: | ---: | ---: |
| 1,024 | 1.42 | 2.97 | +1.55 |
| 4,096 | 1.81 | 3.41 | +1.59 |
| 16,384 | 2.14 | 3.53 | +1.39 |
| 65,536 | 2.55 | 3.69 | +1.14 |
| No training: scripted one-step greedy | | 4.25 | |
| Full-state oracle upper bound | | 4.75 | |

At the final checkpoint, the shared learner beat tabular Q in seven
matched pairs and tied one. The descriptive paired 95% t interval is
[+0.62, +1.67], using eight independent trained models per arm, not treating
laps as independent. On the 64 final track/start executions per arm,
shared linear had **zero gravel events** versus 16 for tabular Q. Most of
the return advantage was avoiding gravel. There was a tradeoff: tabular Q
did better on practice-mixture validation at the final checkpoint
(4.58 versus 4.19). Matching training moves is not matching CPU, and
holding out these particular short layouts does not establish general
transfer to tracks with unseen physics or to other driving tasks.

The [results](results.json) retain every layout, budget and upper bound.
Some public inputs appear across layouts: 36/42 Quarry inputs and 22/43
shifted-layout inputs are possible in practice. This is a test of unseen
**layouts**, not a claim that every observation is novel.

## Reproduce

To reproduce the original results byte for byte, run on Node 24.22.3 and
Bend 2.0.40 from the historical checkout linked above. On R10.2, use the
[post-fix protocol and results](../tie-breaking-fix/README.md). The generator
creates a training-only manifest plus separate fixed held-out worlds.
Use new paths for the design and archive.

```sh
study=studies/complex-worlds/kart-transfer
mkdir -p runs
node "$study/design.mjs" runs/kart-transfer-design
node experiment.mjs run runs/kart-transfer-design/plan.json runs/kart-transfer --until 4096
node runs/kart-transfer/code/experiment.mjs resume runs/kart-transfer
node experiment.mjs verify runs/kart-transfer
node "$study/score.mjs" runs/kart-transfer > runs/kart-transfer-results.json
cmp "$study/results.json" runs/kart-transfer-results.json
```

Sealed training used the stock runner and verified 16 trials/80
checkpoints. The scorer calls only the frozen compiled action functions,
then cross-checks exact deterministic path enumeration with the stock
policy oracle. The scorer also checks preview reward and
mirrored-transition parity on 2,660 reachable state/action pairs.
An initial attempt to compile all held-out scenes into the training archive
stopped at a 1.45 GiB local compiler guard; the working training-only build
does not need them. No stock multi-scene assessment result is claimed.
Only load trusted archives.

The separate [reflection ablation](attribution/README.md) repeats the comparison
with all four table/linear and raw/reflected combinations.
