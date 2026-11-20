# Phase 10: training tie-breaking

## Core, laws, and archive compatibility

R10.2 changes only the greedy acting branch during training. The corresponding
evaluation laws and executable tests retain the first maximal action in public
legal-list order. Bootstrap selection and targets, the logged evaluation
policy, and offline fitters did not change. Prior runs still use their archived
programs.

The [exact source, bundle, and compiled backend transition](../../tools/archive-gates/r102-transition.json)
records each before and after SHA-256 value. Common entries are
[double_q.bend](../../core/double_q.bend), [tabular.bend](../../core/tabular.bend), and [tile_control.bend](../../core/tile_control.bend). Per-plan entries
cover [study.bend](../../core/study.bend), shipped agent bundles, and changes in archived source
names across the 38 then-existing plans. The eight compiled backends cover
arena, authored discrete, expanded finite and grid, packed finite, Cartpole,
a built-in world with a custom learner, and Mountain Car. The gate still checks every
old and new digest; it did not replace any prior baseline. Historical flagship
and Studio-demo artifacts keep their original byte pins, and both the
pre-reorganization and pre-R10 archive replay and resume checks pass.

On the deliberately zero-exploration four-move corridor, the old policy
finished 0/24 training episodes and 0/3 frozen evaluation episodes; the new
policy finished 24/24 and 3/3. That regression isolates action-order bias,
not general learning speed.

## Status

| Item | Result |
| --- | --- |
| R10.1 | Fixed Studio compiler-fixture debris and added an untracked-root-file guard. [Commit](https://github.com/jaykobdetar/bend-agent-studio/commit/eb5bc85bb706518c98da5ceb41d0cc515a5d4034). |
| R10.2 | Updated training ties, proofs and archive gates; preserved the original legacy benchmark CSV. [Commit](https://github.com/jaykobdetar/bend-agent-studio/commit/87b8ef403a8317528455c2d4cbff6367a6d527ba). |
| R10.3 | Published the preregistered flagship v2: 400 trials, 3,600 verified checkpoints and 16 reproducible outputs. [Commit](https://github.com/jaykobdetar/bend-agent-studio/commit/a05c7cd0cf66075e7c9121a75341b56c9473ae34). |
| R10.4 | Verified and published the four matched challenge reruns: 160 trials, 704 checkpoints. [Commit](https://github.com/jaykobdetar/bend-agent-studio/commit/2b96de9a2a9bff622d4851b3a85287185b01e9e8). |
| R10.5 | Checked five exact evaluation tools against actual tied-value rollouts. [Commit](https://github.com/jaykobdetar/bend-agent-studio/commit/97071c6bd3b39b8712a2ef1825f4b73ac3970f7e). |
| R10.6 | Removed the 12 merged Phase 9 branches after verifying all tips were already in main. Only main remains. |

All items were prepared as distinct commits on `main`, so no Phase 10 PRs
were needed. The Phase 9 table in the [roadmap](../../ROADMAP.md#phase-9-overnight-work-order)
still links the original PRs.

## Results

**Locksmith Courier (matched).** At 8,192 accepted moves on the eight-station
map, plain Q delivered 0/256 and Dyna-Q delivered 256/256, before and after the
fix. The mean returns stayed at −155 and +110 respectively. This did not
close the planning gap at that budget. The [rerun report](../../studies/complex-worlds/tie-breaking-fix/README.md)
also covers Switchboard, Storm Reserve, and Kart transfer. Switchboard's
final profile did not change, Q-learning improved modestly on the long
Reserve task, and shared linear Q beat tabular Q in all eight post-fix Kart
pairs. Those results are for the tested configurations and seed blocks.

**Flagship v1 to v2 (descriptive, not matched).** On slippery FrozenLake,
Q-learning and Dyna-Q both scored 0 in v1. In v2, mean returns were 0.325 and
0.58125 respectively. On the dry lake, the corresponding means went from 0
and 0.100 to 1 and 1. In v2, the seven learning arms show some spread on four
of five worlds, but only two worlds have any pointwise paired interval
excluding zero versus Q-learning. Q-learning and Dyna-Q tie on four of five
worlds. The [v2 design and outputs](../../studies/flagship-toy-text-v2/README.md)
document the changed world mix, seeds, and budgets, so v1 versus v2 does not
isolate the tie fix. V1's evidence remains intact.

The optional Storm factorial and the secondary Kart reflection ablation
were not rerun. No original run evidence was overwritten.
