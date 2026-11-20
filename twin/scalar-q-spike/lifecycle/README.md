# Scratch archive handoff, literal Q only

This bounded diagnostic tests the **archived stock reader and continuation
CLI**, not a production archive writer or native resume implementation.
It uses the exact [pinned literal-Q fixture](gate.json), with three
replicates and checkpoints 0, 1, 7 and 31. All 12 candidate files are
reconstructed in memory from native output and compared as complete
bytes to the pristine stock archive. Only after all 12 match does it
create a new private parent directory and two separate scratch archives.

- **Complete:** write the 12 matched candidate buffers and the verified
  stock manifest and code. The archived Bend runner verifies all files
  and replays replicate 0, checkpoint 7, first validation episode. This
  replay loads a learned indexed model and must match the original replay
  byte-for-byte.
- **Prefix:** stage the six matched candidate buffers for checkpoints
  0 and 1 (all replicates), with the same stock manifest and code. Run the
  archived stock `resume`; it must write exactly the six missing
  checkpoints, pass stock verification, and match all 12 candidate/stock
  files. **Stock Bend**, not the native executable, performs the resume.

The candidate checkpoint files are neither copied from the reference
nor linked to it. Successful resume intentionally produces new suffix
files only in the private scratch folder. The pristine stock inventory
must remain identical.

## Reproduce

Use Node 24.22.3, Bend 2.0.40 and Clang 22.1.4. Set
`LITERAL_Q_STOCK` to the trusted fixture archive whose manifest matches
[the gate](gate.json); to create a scratch stock reference, follow the
literal `q_learning` case in the [scalar witness](../README.md).
Set `LEAN_CLANG` and its C include directory as in that witness.

```sh
spike=twin/scalar-q-spike
scratch=$(mktemp -d)
node "$spike/parity.mjs" generate "$LITERAL_Q_STOCK" "$scratch/q-literal.c"
"$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march=x86-64-v3 \
  -ffp-contract=off -fno-fast-math -pthread "$scratch/q-literal.c" \
  -lm -o "$scratch/q-literal-x86-64-v3"
node "$spike/lifecycle/check.mjs" "$LITERAL_Q_STOCK" \
  "$scratch/q-literal-x86-64-v3" "$scratch/archives"
```

## Observed

The generic `x86-64-v3` run matched all 12 candidates before staging.
Stock verify passed on the complete and resumed archives. The fixed
replay hash was
`51177d8cbec0b9041fd58d4b705532deef129583f9b1765183ece6f24468f993`.
An independent filesystem check confirmed distinct, singly linked
checkpoint files in both scratch outputs. An altered model in the last
native row (replicate 2, checkpoint 31) was rejected, leaving no scratch
folder. The original archive inventory was unchanged. [Evidence](evidence.json)
records the exact fixture, compiler, phase and archive identities.

This checks that already-verified native-derived envelopes can be handed
to the stock reader and stock resume path without changing bytes. It is
not additional broad numerical evidence. It does not verify native
interruption, arbitrary archived checkpoints, cross-version migration,
a native-written manifest, or readiness to adopt a native engine.
