# Apex Kart: was the transfer gain just left/right symmetry?

The [original transfer study](../README.md) put two changes in
the same learner: pooling action values across related observations, and
reflecting right bends into left-bend coordinates. This ablation splits them
into a two-by-two comparison. **Linear pooling helped on both fixed test sets
without requiring reflection.** Reflection by itself was a considerably
smaller and less consistent contributor.

Both learners receive the very same public sensor values and legal actions:
remaining distance, lane and speed, and three cells of curvature preview.
Both linear arms share the same eight-feature basis. Reflected arms swap the
lane/preview coordinates and left/right action labels when the nearest curve
in that public preview turns right. They leave straight-only previews
unchanged. The reflected table arm follows stock greedy Q arithmetic in the
new coordinates. With reflection disabled its table, statistics, and eight
replays exactly match the built-in arm in a separate parity control.

## Final frozen returns at 65,536 real moves

| Fixed layout group | Raw table | Reflected table | Raw linear | Reflected linear |
| --- | ---: | ---: | ---: | ---: |
| Four prior evaluation layouts (reused diagnostic) | 2.48 | 2.63 | 3.81 | 3.78 |
| Reserved close-turn layout and its mirror | 2.50 | 2.75 | 3.84 | 3.56 |
| Eight practice layouts | 4.62 | 4.73 | 4.14 | 4.24 |

On the reserved pair, replacing raw table with raw linear improved all eight
matched fits, by +1.344 return on average (descriptive paired 95% t
interval [+0.898, +1.790]). Pooling also improved all eight with reflection
held fixed: +0.813 [+0.522, +1.103]. Reflection alone gave +0.250
[+0.027, +0.473] with tabular Q and −0.281 [−0.734, +0.172] with linear Q.
The linear reflection effect is unresolved; it is not evidence that
reflection hurts in general. On the reused four layouts the without/with
reflection pooling gains were +1.328 and +1.156, both eight of eight.
On the practice layouts table methods remained stronger than linear.

The previously unused reserved pair has three close turns, the same kart
physics, and neither layout appears in practice. The one-step scripted
baseline and the full-state upper bound both score 4.50 on this pair, above
either learned policy. All final runs on the reserved pair avoid gravel;
the difference there is speed. On reused diagnostics, raw/reflected table
have 19/18 gravel events across 64 fit/track/start runs per arm, versus zero
for both linear arms.

These are two fixed sets of layouts, not random samples of future tracks.
Within each layout the two starts exhaust the deterministic outcomes; they
are not independent data points for intervals. There are eight independent
training fits per arm, matched by seed. Intervals are descriptive without
multiplicity adjustment. The experiment holds observed moves fixed, not
training CPU. The [complete aggregates](results.json) include earlier
budgets, per-set contrasts and the interaction.

## Reproduce

Use Node 24.22.3 and Bend 2.0.40 with the stock runner. The generator saves the
locked layout split and plan seed blocks (training 1,106,000,000; validation
2,027,000,000; test 3,276,000,000; stride 100,000).
Use fresh output paths. No held-out layout is in the training backend.

```sh
study=studies/complex-worlds/kart-transfer/attribution
mkdir -p runs
node "$study/design.mjs" runs/kart-attribution-design
node experiment.mjs run runs/kart-attribution-design/parity.json runs/kart-parity
node "$study/parity.mjs" runs/kart-parity
node experiment.mjs run runs/kart-attribution-design/plan.json runs/kart-attribution --until 4096
node runs/kart-attribution/code/experiment.mjs resume runs/kart-attribution
node experiment.mjs verify runs/kart-attribution
node "$study/score.mjs" runs/kart-attribution > runs/kart-attribution-results.json
cmp "$study/results.json" runs/kart-attribution-results.json
```

All 32 fits and 160 checkpoints verified. The scorer checks 3,090 physical
and immediate-preview transitions, 5,056 reflected-policy mirror pairs,
and cross-checks path scores against the stock finite-policy oracle. Local
training occupied one CPU and saved about 70 MiB. Only load trusted archives.
