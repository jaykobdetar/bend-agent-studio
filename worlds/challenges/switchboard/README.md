# Switchboard: delayed random access

At reset and on each of the next cue moves, the switchboard flashes an indexed
bit. Each bit is an independent fair coin in the authored transition model.
After all bits and a configurable number of blank moves, it asks for one
uniformly selected index. Answer with action `0` or `1`, then terminate with
reward +1 if correct or −1 if wrong. Action `2` is the only legal action before
the query; there are no rewards or other hints before the answer.

Three worlds preserve the cue, query, action and reward distributions and
differ only in how they expose the public observations:

- **Raw:** current event only. At the query, none of the cue values is visible.
- **Latest:** current event plus the last cue value, retained across blanks.
- **Full:** current event plus all previously flashed values. This is a supplied
  memory machine, not memory learned by the tabular agent. It never receives
  the underlying hidden mask; it updates from each public cue as the agent
  takes the forced action.

For a given width, the exact best stationary current-view scores are zero,
the reciprocal of the width, and one, respectively. The latest condition
answers correctly on the retained index and must guess on all other indices.
The uniform-action score is zero in all three. The raw world's exact public
history optimum is also 1, because the complete cue history gives all the bits.

## Run it

From the repository root with Node 24 and Bend 2.0.40:

```sh
node --test worlds/challenges/switchboard/checks.mjs
node experiment.mjs oracle worlds/challenges/switchboard/switchboard-2-raw.json 5 --reactive
node public_oracle.mjs worlds/challenges/switchboard/switchboard-2-raw.json 5
node experiment.mjs run experiments/switchboard.json runs/switchboard --until 128
node runs/switchboard/code/experiment.mjs resume runs/switchboard
node experiment.mjs verify runs/switchboard
node runs/switchboard/code/experiment.mjs replay runs/switchboard switchboard-2-full q 0 2048 test 0
```

The checked-in plan is also selectable in Studio. It uses 16 matched seed
blocks per observation encoding for training, validation and held-out scoring.
Its two-cue, two-blank task lasts five accepted moves; the last move is a
natural terminal, not a time limit.

For a wider, longer, separately generated instance, use a fresh directory:

```sh
node worlds/challenges/switchboard/generate.mjs --out runs/switchboard-w4 4 8
node experiment.mjs run runs/switchboard-w4/switchboard.json runs/switchboard-w4-run
```

Create `runs/` first if needed. Explicit JSON supports widths 2, 4 and 8; the
blank count is 0–128. The compact Bend path also supports width 16. The graph is explicit and grows exponentially in width. Use
the small fixture for interactive checks and test a short budget before
attempting a full large-width run. Exact reactive enumeration is intended
for the tiny control; the number of possible full-memory policies doubles
for every distinct query context, so the enumeration cap rejects larger inputs.

To avoid compiling an explicit table of states, generate a plan for the
[compact Bend implementation](switchboard.bend). Like the finite worlds, it
derives memory only from the public cue. Seeded replay tests compare the full
public trajectories and learned model payloads against the explicit literal
and packed implementations.

```sh
node --test worlds/challenges/switchboard/compiled-checks.mjs
node worlds/challenges/switchboard/generate.mjs --native-out runs/switchboard-w8 8 24
node experiment.mjs run runs/switchboard-w8/switchboard.json runs/switchboard-w8-run
```

The compact plan references the source module in this checkout, so keep that
reference available until the run archives its sources.

## What scaling stresses

In the full condition, a tabular policy needs to learn `N × 2^N` distinct
query contexts, even though a policy that retrieves a requested bit directly
can generalize immediately. One experience with a context is sufficient for
the greedy Q learner to answer it correctly afterward (the terminal reward
distinguishes the chosen action from its zero-initialized alternative).
Under ideal independent uniform contexts, its expected signed score follows
first-visit coverage: `1 - (1 - 1/(N × 2^N))^episodes`. This is a
sampling model to compare against, not an exact guarantee for fixed simulation
seed streams. Delay only adds work in these controlled tasks; it does not
reduce the supplied memory machine's capacity.


## Diagnostic run

These are mean held-out returns after 2,048 training episodes per trial, with
16 matched replicates per condition and 512 held-out episodes per replicate.
Every row used the same Q settings and the seed policy in the generator.

| Cues / blanks | Implementation | Raw | Latest | Full | Exact current-view optima |
| --- | --- | ---: | ---: | ---: | --- |
| 2 / 2 | Literal finite | −0.026 | 0.493 | 1.000 | 0, 0.5, 1 |
| 4 / 8 | Packed finite | −0.017 | 0.251 | 1.000 | 0, 0.25, 1 |
| 8 / 24 | Compact Bend | −0.018 | 0.140 | 0.647 | 0, 0.125, 1 |

All three completed 48 trials and verified 240 checkpoints each. With eight
cues there are 2,048 query contexts. After 2,048 training episodes, full-memory
Q achieves about 82% correct despite receiving every cue. Its saved tables
had visited 63.5% of contexts on average (63.2% under independent sampling),
and the greedy answer was correct for every visited context in all 16
replicates. More memory can improve the
best achievable reward while initially making the tabular learner slower
to improve: at 32 training episodes on width eight, mean validation returns
were 0.112 for latest and 0.032 for full memory.

On one low-priority CPU core, the eight-cue explicit compile was stopped by
a 1.5 GiB sampled process-group memory guard without publishing an archive.
The compact alternative completed compile, training and evaluation across
5,068,800 accepted moves in about 54 seconds with 299 MiB peak sampled group
memory. These are host-specific measurements, not a compiler limit or a
throughput comparison between matching implementations.


## Compact-only width 16

```sh
node worlds/challenges/switchboard/generate.mjs --native-out runs/switchboard-w16 16 0
```

Width 16 has **1,048,576 possible query contexts** in full-memory mode, not a
million allocated states. The compact world keeps the current cue index and
mask; the tabular learner stores only observations it encounters. The largest
encoded observation is 3,276,799, within U32. The explicit generator rejects
this width before allocating a graph. At width 16, the independent trace test
checks complete public trajectories at all 16 possible query indices without
constructing a finite table.

One episode visits exactly one query context, so 16,384 episodes can cover
at most **1.5625%**; independent uniform draws predict about **1.5504%**.
Under the same sampling model, 90% expected coverage takes about 2.4 million
episodes, not a claim about better-structured learners. Ordinary held-out
accuracy at the pilot budget is dominated by unvisited contexts. The coverage
assay inspects stored Q values directly instead of trying to infer policy
quality from noisy held-out returns.

In eight full-memory pilot replicates using separate seed blocks, the 16,384
episodes covered **1.5504%** on average (1.5487–1.5522% across replicates).
Every visited context had a correct greedy answer in the saved tables.
The run verified all 32 checkpoints. Compilation took about 5 seconds, then
the archived training and evaluation took about 112 seconds on one
low-priority CPU core, with peak sampled group memory 371 MiB during resume.
This pilot measures table coverage, not generalization or a head-to-head
comparison with the smaller widths.
