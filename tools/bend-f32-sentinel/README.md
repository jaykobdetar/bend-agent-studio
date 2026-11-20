# P11.7: a stock Bend F32 CPU/CUDA diagnostic

On the [reference desktop](../../docs/performance.md), pinned Bend 2.0.40
returned **`0xbeb33259` on emitted JavaScript and native CPU, and
`0xbeb3325a` in an actual CUDA kernel** for `F32.sin(1e6)`.
MPFR rounded the result to `0xbeb33259`. This reproduces the kind of
one-ULP discrepancy reported in [upstream issue #1306](https://github.com/bendlang/bend/issues/1306)
on **different** software and hardware (Bend 2.0.35 and an RTX 4090).

This is a diagnostic, not the P11.7 math implementation. It does not change
the engine, adopt a backend, or establish population, checkpoint, archive,
or exhaustive mathematical parity. It is not a performance measurement.

## Results and controls

[Evidence](evidence.json) contains the privacy-scrubbed reference machine and
tool versions, source/input hashes, all 21 input pairs and 13 recorded words
per pair, with no compiled binaries, CUDA sidecars, logs, or profiler traces.
The exact word is recorded for each operation even when the independent
reference specifies only the NaN class.

| Path | Exact reference or transport word | Correct quiet NaN class | Changed raw transport | Numeric mismatch |
| --- | ---: | ---: | ---: | ---: |
| Bend-generated JS | 233 | 39 | 1 | 0 |
| Native CPU | 234 | 39 | 0 | 0 |
| Native CUDA | 224 | 39 | 0 | 10 |

The 10 CUDA mismatches are one ULP each: seven distinct function and input-word
combinations among `sin`, `cos`, and `exp`; repeated unary inputs with other
second operands still appear in the matrix. Tested basic operations agreed for
all comparable numeric outputs, including ties-to-even, signed zero, subnormals,
infinities, and a separately rounded multiply-then-subtract control. One
signaling NaN was quieted during JS **transport** (`0x7f801234` to
`0x7fc01234`); for some negative-input `log` results, NaN sign and payload
also differed. A correct NaN class does not establish NaN word identity.

Native CPU tested ordinary calls and `!` with CUDA disabled. Both paths
matched bit for bit, as did the corresponding two paths in emitted JS.
The ordinary host path of the CUDA process also matched the native CPU
control. A separate Nsight CUDA activity capture showed **105
positive-duration `bend_dev` kernel events** in the successful 448 MiB
run. This is evidence of actual device launches, **not** 105 independent
arithmetic trials. The 256 MiB negative-control capture imported correctly
but had zero such events and emitted no sentinel rows; Bend stopped before it
could evaluate these diagnostic functions. For this binary, the stock
runtime rounds its heap down in 16 KiB units and reserves rings, stacks
and at least a page per lane. The first admissible heap is 429,408,256
bytes (410 MiB when the flag is given in whole MiB); 448 MiB leaves room
above that floor. This is not a universal minimum for other Bend releases.

The 21 input pairs are fixed in [cases.tsv](cases.tsv). The Bend program
reads runtime U32 words and reinterprets their payload, never converting a
decimal float input or folding a literal test result at the call site.
Bits are captured inside Bend before display. [The MPFR reference](oracle.c)
uses directed lower/upper bounds and accepts a word only when both bounds
round to the same binary32 result. For an exact zero, it resolves the
round-to-nearest-even sign explicitly. For the multiply/subtract control,
it rounds the product first. An undecided enclosure fails instead of
assuming that a fixed-precision double pass is correctly rounded.

## Reproduce the CPU and emitted-JS control

Use Linux x86-64, the pinned [Bend 2.0.40 release](https://github.com/bendlang/bend/releases/tag/v2.0.40),
Node 24.22.3, clang, and the existing MPFR development files (MPFR 4.2.1
for the recorded reference). Run from the repository root. Use a new private
output directory, not the repo. For a clang distribution that relocates
resource headers, point `C_INCLUDE_PATH` at its bundled clang headers for
the Bend native compile only; don't substitute them for GCC's headers.

```sh
umask 077
src=tools/bend-f32-sentinel
out=$(mktemp -d)
export BEND_NO_TELEMETRY=1 BENDRTS=
mapfile -t words < <(python3 "$src/compare.py" --words)

bend "$src/sentinel.bend" --check-only
bend "$src/sentinel.bend" -o "$out/sentinel.mjs"
node "$src/js-driver.mjs" "$out/sentinel.mjs" "${words[@]}" > "$out/js.txt"
CUDA_VISIBLE_DEVICES= bend "$src/sentinel.bend" -o "$out/sentinel"
"$out/sentinel" +RTS --threads 1 --gpu off -RTS "${words[@]}" > "$out/native.txt"
gcc -std=c11 -O2 -Wall -Wextra -Werror -fno-fast-math -ffp-contract=off \
  "$src/oracle.c" -lmpfr -lm -o "$out/oracle"
"$out/oracle" "${words[@]}" > "$out/mpfr.txt"
python3 "$src/compare.py" "$out"
```

The emitted module does not execute the IO entrypoint; the small Node driver
only calls the exported pure row function. The capture comparator verifies
case ordering, legal word syntax, and that the host control paths match.

## Optional CUDA evidence

Only use this path on a desktop with CUDA device access, adequate memory
headroom, a matching Nsight Systems host importer, and no competing benchmark.
Use the existing toolkit: `CUDA_HOME` must point to the prefix containing
the NVRTC header in its include directory. The recorded versions were CUDA/NVRTC 12.0 and
Nsight Systems 2022.4.2.50. Use an allowed logical CPU (6 on the reference
host). The runtime's `448MB` flag sets the Bend GPU heap to 448 MiB; it is
not a system-wide GPU memory cap.

```sh
: "${CUDA_HOME:?set to the installed CUDA toolkit prefix}"
: "${CPU:=6}"
awk '/^MemAvailable:/ {exit !($2 >= 5242880)}' /proc/meminfo || exit 1
test "$(nvidia-smi --id=0 --query-gpu=memory.free --format=csv,noheader,nounits)" -ge 1536 || exit 1
CUDA_HOME="$CUDA_HOME" CUDA_VISIBLE_DEVICES= \
  bend "$src/sentinel.bend" -o "$out/sentinel-cuda"
timeout --signal=TERM --kill-after=3s 45s nice -n 10 taskset -c "$CPU" \
  nsys profile --trace=cuda --sample=none --cpuctxsw=none --output="$out/positive" \
  "$out/sentinel-cuda" +RTS --threads 1 --gpu 448MB -RTS "${words[@]}" > "$out/gpu.txt"
```

The stock runtime writes a missing architecture-specific sidecar when it can
open the device. A CUDA-linked executable or sidecar alone is not proof of
CUDA execution. Nsight may emit a raw `.qdstrm` instead of automatically
creating a report, as on the reference Ubuntu package. If so, point
`QDSTRM_IMPORTER` at the matching installed
QdstrmImporter from its host tools directory. Conversion and SQLite export are offline:

```sh
if [ ! -s "$out/positive.nsys-rep" ]; then
  "$QDSTRM_IMPORTER" -i "$out/positive.qdstrm" -o "$out/positive.nsys-rep"
fi
nsys export --type sqlite --output="$out/gpu-trace.sqlite" "$out/positive.nsys-rep"
python3 "$src/compare.py" "$out" --require-gpu --compact
```

For the recorded negative control, repeat the same capture into a separate
report name with `--gpu 256MB`, expecting nonzero exit and no `S` result
rows. Import/export it separately and pass `--negative-trace` and that SQLite
file to the last command. With that flag the compact output matches the shape
of the checked-in evidence's `matrix` section. The exact positive and negative
capture decisions use named `bend_dev` events with positive durations, not
CPU output, driver activity, or unrelated kernels. If the tool cannot verify
a named device kernel, report CUDA as unverified.
