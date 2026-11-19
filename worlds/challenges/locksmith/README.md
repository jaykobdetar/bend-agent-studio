# Locksmith Courier

Deliver a parcel through a sequence of locked stations. At each station, the
only key is at the end of a side corridor. Bring it back to open the door, or
spend one of your shared bypass charges. Each move costs one point. A delivery
adds one more point than the episode's step limit, so any delivery is better
than any timeout. There are no stochastic transitions. The public observation
identifies the complete state: station, corridor position, whether you have the
current key and remaining bypasses.

| Action ID | Move |
| --- | --- |
| 0 | Advance along the corridor; automatically take the key at its far end. |
| 1 | Retreat toward the door. |
| 2 | Open the door using the current key. |
| 3 | Bypass the door with one charge, with or without the current key. |

A key cannot open the next door. Bypasses do not replenish. Spending the first
charge at the first lock saves time locally but can be a mistake. The exact
shortest route uses the charges on the deepest corridors: each crossing costs
one move, and a keyed door adds twice the corridor length. In the small world,
the best route is actions `0 1 2 3 0 0 1 1 2` (9 moves); using the charge at the
very first door instead costs 15 moves.

| World | Reachable states | Step limit | Optimal return | Uniform expected return |
| --- | ---: | ---: | ---: | ---: |
| [3 stations, 1 bypass](locksmith-3.json) | 32 | 37 | 29 | −16.7334 |
| [8 stations, 2 bypasses](locksmith-8.json) | 204 | 155 | 110 | −153.8154 |

The exact values refer to undiscounted episode return, not the training
objective. Both learners in the example train with discount 0.98.

## Run and inspect the study

From the repository root with Node 24 and Bend 2.0.40:

```sh
node worlds/challenges/locksmith/generate.mjs --check
node --test worlds/challenges/locksmith/checks.mjs
node experiment.mjs oracle worlds/challenges/locksmith/locksmith-8.json 155
node experiment.mjs run experiments/locksmith-courier.json runs/locksmith --until 512
node runs/locksmith/code/experiment.mjs resume runs/locksmith
node experiment.mjs verify runs/locksmith
node runs/locksmith/code/experiment.mjs replay runs/locksmith locksmith-8 dyna 0 8192 test 0
```

Reopen the saved study in Studio with `npm start -- --run runs/locksmith`. For
finite-world MCP play, use `env_reset` with the JSON path followed by
`env_step` with one of the legal IDs above. See [MCP play](../../../mcp/README.md#play-a-finite-world).

The example is a fixed diagnostic, not evidence that one agent is always
better. Eight matched seed blocks per arm share training, validation and test
seeds within each replicate and separate them across phases. At 512 accepted
training steps, both Q-learning and Dyna-Q reached the small-world optimum in
all eight runs. At 8,192 steps, Dyna-Q reached the large-world optimum in all
eight runs (256/256 held-out deliveries); Q-learning scored −155 in all eight
(0/256 deliveries), and uniform random delivered 3/256. Dyna-Q performs five
additional model backups per step, so the result compares interaction budgets,
not equal computation. The evaluation episodes exercise each frozen policy;
they are not 256 independent training replicates.

On 12 fresh seed blocks of the 8-station world, Dyna-Q with zero planning
backups matched plain Q-learning (including its Q values at each checkpoint).
Both still timed out at 16,384 steps; all three configurations reached the
optimum by 49,152 steps. For the diagnostic follow-up, use 12 replicates,
checkpoints 0/2,048/8,192/16,384/49,152, a 50,000 episode cap, 32 validation and
64 test episodes, and seed starts 720000000/1720000000/2720000000 with stride
60000. Retain the Q and Dyna arms, omit random, and add a copy of Dyna with
`planningSteps: 0`. The early lead does not show an asymptotic score advantage.

## Author larger worlds

Import `courier(detourLengths, bypasses)` from [courier.mjs](courier.mjs). It
enumerates reachable states only and returns `{definition, limit, delivery}`.
Lengths must be integers from 1 to 12, with 1–32 stations and up to 6 bypasses.
The validation tests deliberately check the largest shape (5,076 states); this
does not promise it will compile or train within a given host budget.
