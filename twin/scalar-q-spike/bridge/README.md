# Exact check of the complete original Bridge manifest

All three original arms in `experiments/bridge.json` matched the complete
stock **authored-bridge** archive at all declared checkpoint positions.
This is one complete shipped plan under an unchanged stock parent seal,
not coverage of the rest of the shipped-plan matrix, a new engine default,
or a production native archive writer.

The [gate](gate.json) fixed the checked-in experiment/world bytes,
normalized plan, phase budgets, seeds, compiler targets and worker
counts **before** running the stock reference. It uses the original Bridge
world (four states, two-move horizon), Random, Q-learning and Double Q,
replicates 0–7, checkpoints 0/32/256, 32 validation episodes per checkpoint
and 128 final test episodes. No phase or cap was changed.

The stock CLI ran the entire unmodified manifest in a fresh scratch
folder and verified 24 trials and 72 checkpoint files. The unchanged
selector then checked all eight replicates of each arm under that same
stock parent manifest
`4e941a074db4c8615aafb6149b6285db50266fd97a3672eab492b0f4b3a12fcd`.
Three numerical work descriptors were used only to generate/compare
candidate bytes; they did not become new plans or archives. The union
of their coordinates was exactly the full stock checkpoint set. The
complete stock file inventory was unchanged by native comparison.

| Original arm | Distinct files | Full-byte comparisons |
| --- | ---: | ---: |
| Random | 24 | 144 |
| Q-learning | 24 | 144 |
| Double Q | 24 | 144 |
| **Complete plan** | **72** | **432** |

Each file matched at 1, 2 and 4 workers with both `-O3` targets.
This was a bounded correctness test on one pinned logical CPU,
not a timing, hosted native matrix, replay or resume result.
[Evidence](evidence.json) records the reference identities and wire hashes.

## Reproduce

Use Node 24.22.3, Bend 2.0.40, Clang 22.1.4 and its headers as in the
[scalar witness](../README.md). Run from a checkout containing this
diagnostic and the unchanged runner and Bridge sources anchored by the
gate. Keep outputs in fresh scratch paths:

```sh
spike=twin/scalar-q-spike
scratch=$(mktemp -d)
runner=$(jq -r .referenceRunner "$spike/bridge/gate.json")
git diff --exit-code "$runner" -- core experiment.mjs experiments/bridge.json worlds/bridge.json
node experiment.mjs run experiments/bridge.json "$scratch/bridge-stock"
node experiment.mjs verify "$scratch/bridge-stock"
for arm in random q double; do
  name="bridge-$arm"
  node "$spike/parity.mjs" generate-cell "$scratch/bridge-stock" bridge "$arm" 8 "$scratch/$name.c"
  for arch in x86-64-v3 znver3; do # Use znver3 only on compatible hardware.
    "$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march="$arch" \
      -ffp-contract=off -fno-fast-math -pthread "$scratch/$name.c" \
      -lm -o "$scratch/$name-$arch"
    for workers in 1 2 4; do
      node "$spike/parity.mjs" check-cell "$scratch/bridge-stock" \
        bridge "$arm" 8 "$scratch/$name-$arch" "$workers"
    done
  done
done
```

Only the stock CLI writes an archive. The original fixture training and
test streams were not narrowed, and none of their outcomes selected the
scope. This result is distinct from the earlier independently authored
Bridge Expected SARSA diagnostic.
