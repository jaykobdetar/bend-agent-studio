# P11.8 Uniform AVX2 correctness diagnostic

Only the reset and move-loop RNG use eight-lane unsigned vectors. World-table
sampling, action selection (unsigned remainder), and ordered F32 score
accumulation remain scalar. Padded and terminated lanes never take a step,
read a transition or accumulate reward. The report order and raw score bits
remain those of the scalar witness. Training and evaluation use the same frozen
Uniform policy; this is not evidence for any learner or runtime speedup.

The existing literal Uniform fixture has three replicates, a three-step world
horizon and four checkpoints. On each of two targets, the actual `uniform8`
call path included 256-bit `vpmulld`, `vpsrld` and `vpxor` in both the reset
and move-loop RNG. Every emitted report also matched the scalar episode in
the same executable. The full ordered wire matched the frozen scalar wire and
all 12 complete checkpoint files matched the verified stock archive on each
target. See [recorded hashes and counts](evidence.json).

## Reproduce the bounded witness

Use Node 24.22.3, Bend 2.0.40, and the Clang 22.1.4 bundled with Lean 4.34.0.
Supply the trusted, verified literal Uniform reference archive used by the
scalar witness at repository commit `62decf6`; its hashes are listed in
[evidence.json](evidence.json). The diagnostic refuses any other generated
scalar C source. Use `znver3` only on a compatible host; generic x86-64-v3
also requires a host that supports that CPU level.

```sh
spike=twin/scalar-q-spike
work=$(mktemp -d)
: "${STOCK_UNIFORM_RUN:?set to the trusted stock literal Uniform archive}"
: "${LEAN_CLANG:?set to the pinned Lean-bundled clang}"
export C_INCLUDE_PATH="${LEAN_CLANG%/bin/clang}/include/clang"
node experiment.mjs verify "$STOCK_UNIFORM_RUN"
node "$spike/parity.mjs" generate "$STOCK_UNIFORM_RUN" "$work/scalar.c"
node "$spike/avx2/stage-vector.mjs" "$work/scalar.c" "$work/witness.c"
"$LEAN_CLANG" -std=c11 -O3 -Wall -Wextra -Werror -march=x86-64-v3 \
  -ffp-contract=off -fno-fast-math -pthread "$work/witness.c" -lm -o "$work/witness"
objdump -d --disassemble=uniform8 "$work/witness"
objdump -d "$work/witness" | grep 'call.*<uniform8>'
"$work/witness" 1 > "$work/witness.wire"
sha256sum "$work/witness.wire"
node "$spike/parity.mjs" check "$STOCK_UNIFORM_RUN" "$work/witness" 1
```

Compare the wire hash to the recorded frozen wire. This produces no native
archive and does not modify the reference. Keep the scalar defaults unchanged.
