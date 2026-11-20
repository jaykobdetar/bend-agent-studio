# One native continuation from a stock checkpoint

This is a read-only continuation witness, not a native-written archive,
`resume` command, replay engine, or production lifecycle test. It covers
only the fixed [original flagship v2 cell and boundary](gate.json):
Slippery Lake, Q-learning, original replicate zero, checkpoint **64→128**.
It uses Node 24.22.3, Bend 2.0.40 and Clang 22.1.4, with the original
parent manifest and verified archived Bend snapshot.

The harness checks the stock archive before building a source-bound
descriptor. It converts the original checkpoint's indexed Q tree to
bounded C rows, preserving both child links, visits, and raw F32 values.
The C entry uses the existing generated scalar kernels and echoes the
rehydrated tree **before** training. A flat array's temporary indexing
may differ from the original construction order; the entire tree shape,
data and edges must agree when decoded. No episodes from the first 64
are re-run.

The native entry then emits 64 ordered training reports from seed
150500064 and eight validation reports from seed 1905000000. Checkpoint
128 is not the endpoint of this plan, so it does not run test episodes.
In JS, append the training reports to the original checkpoint's saved
stock Float64 Welford state and reduce validation fresh in seed order.
Compare the complete next checkpoint bytes, sealed **only in memory**
under the original parent manifest and exact checkpoint-64 link.

## Reproduce

Set `FLAGSHIP_ARCHIVE` to the existing trusted full original flagship v2
stock archive. Set `LEAN_CLANG` to the pinned executable and its standard
headers as in the [scalar witness](../README.md). Always generate and
compile outside the original archive:

```sh
witness=twin/scalar-q-spike/continuation/witness.mjs
scratch=$(mktemp -d)
node "$witness" generate "$FLAGSHIP_ARCHIVE" "$scratch/continue.c"
for arch in x86-64-v3 znver3; do # Use znver3 only on compatible hardware.
  "$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march="$arch" \
    -ffp-contract=off -fno-fast-math -pthread "$scratch/continue.c" \
    -lm -o "$scratch/continue-$arch"
  node "$witness" check "$FLAGSHIP_ARCHIVE" "$scratch/continue-$arch"
done
```

## Observed

Both targets restored 41 indexed nodes and generated the same raw
wire. Checkpoint 64's seal was
`c520789641bdf8d246a705dc1c34dffdbe8902a1219fb7db080b7d826308775e`;
both independently reproduced checkpoint 128
`ebbb48dbe92b43fab818f10f61fb1bc77f253027d422ce212c5248c4d1b195f0`.
Earlier training seed, altered root visits, and a descriptor referring
to the source's predecessor instead of the source were each refused.
The entire original archive inventory (relative path, length and SHA-256
for each file) matched before and after. Full identities are in
[the evidence](evidence.json). Runs were bounded correctness checks on
one logical CPU. No timing result, multi-cell resume support,
checkpoint writer, interruption handling, historical replay, or native
archive compatibility follows from this test.
