# P11.7: portable tanh sample, not an adopted implementation

This isolated CPU diagnostic asks whether original outward fixed-point
arithmetic can reproduce correctly rounded binary32 `tanh` **on a fixed
sample**. It does not alter the stock engine or archives or install a
new math default. It follows the [stock CPU/CUDA mismatch diagnostic](../bend-f32-sentinel/README.md).

With stock Bend 2.0.40, emitted JavaScript and Linux x86-64 native CPU
produced byte-identical results on the same 5,692 raw U32 input words.
The numeric words matched both MPFR 4.2.1 reference paths; the chosen
canonical quiet-NaN policy was tested separately.

| Output class | Exact words per backend |
| --- | ---: |
| Numeric center | 4,110 |
| Numeric boundary, including signed zero and infinities | 1,058 |
| Canonical NaNs | 524 |
| Undecided or mismatched | 0 |

The two reference paths check different rounding and packing methods,
not two independent implementations of the MPFR transcendental. The
Bend candidate itself has no MPFR, vendor `tanh`, F64 or FMA dependency.
[Evidence and exact digests](evidence.json) bind the historical sample,
source, pinned versions and raw output bytes. There are no user paths,
generated binaries, output dumps or compiled artifacts here.

## Reproduce the fixed diagnostic

Run from the repository root on Linux x86-64 with Python 3.10+, Bash,
Bend 2.0.40, Node 24.22.3, the existing GCC/MPFR/GMP development files
(MPFR 4.2.1), and clang 22.1.4 for native. The native verification used
the clang distributed with Lean 4.34.0. No dependencies are installed
by this diagnostic. These commands are optional and use a new private
output directory outside the repo; the native check is explicitly
CPU-only. Run the stages serially and keep at least 5 GiB host
MemAvailable. For the reference machine's limits, use the single-CPU,
memory and elapsed guard described in the [performance guide](../../docs/performance.md).

```sh
umask 077
out=$(mktemp -d)/tanh-sample
tools/bend-tanh-diagnostic/reproduce.sh js "$out"
tools/bend-tanh-diagnostic/reproduce.sh native "$out"
```

The checked-in candidate consists of the exact original generator and
Bend source fragments; the script verifies the generated source against
the sampled digest. The original native CLI driver is appended only for
CPU execution. The corpus recipe preserves the first 60 explicit edge
words and 1,536 words from a fixed xorshift32 seed, then adds 4,096
center words from a different fixed seed, 2,048 per sign. Deduplicate
and sort by raw U32, and hash lowercase eight-digit words with LF
terminators. Both stage degrees and the corpus were fixed before the
combined evaluation. These inputs are not a uniform workload sample.

The directed MPFR interval chooses a word only when the two bounds
round to the same binary32 result. The target-format MPFR path uses
precision 24, emin −148 and emax 128, propagates `mpfr_tanh`'s ternary
to `mpfr_subnormalize` and exports words via integer packing. See the
[MPFR 4.2.1 manual](https://www.mpfr.org/mpfr-4.2.1/mpfr.html#Exception-Related-Functions).
The reference helper code and Bend experiment are original; no
CORE-MATH or glibc source or coefficients are copied. MPFR is used
only in this external diagnostic, not the candidate runtime.

## Enclosure and exact rounding

Treat the signed input as a raw word. At magnitude at most 2⁻¹²,
the RNE answer is the input, because for positive x the difference
x−tanh(x) is below x³/3, less than half its predecessor gap; preserve
both zero signs. At magnitude at least 10, the gap to signed one is
less than half the spacing below one; infinities also map to signed
one. For example, `exp(2)>7` gives `exp(20)>7^10>2^26`, enough
for `1−tanh(10)<2^-25`. Classify all NaNs first and return the
explicit experimental policy word 0x7fc00000, not an assumed MPFR
NaN payload.

For 2⁻¹² < |x| < 10 use positive magnitude and fixed stages
(fractional bits, Taylor degree) (44,14) then (56,20). Decode
`t=|x|/32` exactly into a raw integer at scale `S=2^p`. Keep
outward lower/upper Taylor terms for exp(t): directed multiply
rescale and small divide compose to the same floor or ceil by
the combined positive divisor. Sum terms exactly at that scale.
All ratios following the first omitted term are below 1/2 because
`t<5/16`. Add **twice** the upper first omitted term to the upper
sum as a fixed conservative remainder bound. Square the endpoints
outward six times to enclose `exp(2|x|)`.

The raw-value cap is below 2³⁰ per fixed-point value. Let `a=5/16`.
One bound for exp(t) is `1+a+a^2/(2*(1-a/3))`; each term's upward
error is below 2/S by the recurrence. The first omitted exact term
is below a⁴/24, so the initial upper endpoint is below
`1+a+a^2/(2*(1-a/3))+a^4/12+44/2^44 < 11/8-1/256`.
On outward squaring this margin of 1/256 is preserved relative to
the corresponding successive power of 11/8: both endpoints are at
least 1, so the margin doubles before upward rounding
adds at most 1/S. The exact inequality
`11^64+8^64 < 2^30*8^64` leaves room to add the final denominator's
unit. The lower sum is at least 1+t and six squares give at least
1+64t; the lower tanh ratio exceeds 2⁻¹³. These are hand arguments
for the bounds, not proofs of compiler behavior.

Map both exp endpoints via the increasing ratio `(y-1)/(y+1)`.
Restoring division retains exact remainder below its positive
denominator. For normal center endpoints the final pack shifts the
quotient until at most 24 bits remain, uses the last lost bit as
half, and ORs the other lost bits and nonzero exact remainder into
sticky. Round ties to even and handle the mantissa carry. Accept only
matching endpoint words, then restore the sign. If stages refuse
a cap or disagree, return `None`, never a vendor value. The digit
value operations use separate exact F32 add/subtract/multiply on
small integers, with U32 masks, comparison, shifts and exact word
conversions for bounds, representation and control.

## Bounded CUDA follow-up

Using the unchanged candidate body and a separate [GPU-marked raw-word driver](cuda-driver.bend),
the RTX 3060 Ti matched all [24 predeclared words](cuda-sample.json) from the
same corpus: 16 edge words and eight center words. The capture contained
120 positive-duration `bend_dev` kernel events from the one diagnostic child.
The events confirm device execution; they are not 120 independent inputs.
This is a separate, smaller check than the 5,692-word JS/native sample.

To reproduce only on an authorized, idle CUDA device, first run the CPU
reproducer above to verify the body. Append the GPU driver instead of the
native driver; the only different call is the GPU-marked candidate. Build
with the pinned Bend/Clang and installed CUDA toolkit as in the
[stock F32 capture](../bend-f32-sentinel/README.md#optional-cuda-evidence).
Require at least 2 GiB of free VRAM and 5 GiB of host headroom. Use the 24
raw words in the checked-in sample, a single host thread, a 512 MiB requested
heap, and a 55-second elapsed ceiling. Capture only CUDA activity from that
child; if needed, import the trace offline and require positive-duration
`bend_dev` events before interpreting the words. The heap is not a
system-wide memory cap. Keep raw traces and executable files out of the repo.

## Adversarial midpoint diagnostic (CPU only)

The unchanged p44/p56 candidate does **not** decide every center word.
On a separate [MPFR-ranked sample](midpoint-evidence.json), emitted JS
and native CPU were byte-identical: **126 exact, two intentional
fail-closed refusals, zero incorrect numeric outputs**. Both MPFR
reference methods gave the following expected numeric words:

| Raw input | Both MPFR words | JS and native CPU |
| --- | --- | --- |
| `0x39b89da4` | `0x39b89da3` | `None` |
| `0xb9b89da4` | `0xb9b89da3` | `None` |

These are a magnitude and its sign mirror, not independent failure
modes. No candidate outputs were used in selection, and no degrees
or precision stages were changed. This shows an incompleteness in the
current bounded implementation. It does not disprove the enclosure
argument or show any incorrect returned numeric word. It does not identify
the internal refusal condition or qualify p56 for production.

To reconstruct the selection, split the positive raw center
`[0x39800001,0x41200000)` into 8,192 strata, with boundary i at
`lo + floor((hi-lo)*i/8192)`. Starting at xorshift32 state
`0x477fab2d`, update once per stratum (XOR with left shift 13, unsigned
right shift 17, left shift 5, in that order, modulo 2³²), then offset
from the stratum's lower boundary by state modulo width. Directed
MPFR at 256 bits bounds tanh of each positive magnitude. Require
both endpoints to give the same adjacent binary32 bracket and the
same side of its exact midpoint. Score the distance from that midpoint
divided by the bracket's width; both distance bounds are directed.
Rank by the lower score, breaking ties by raw word. The top 64 are
certified only if the largest chosen upper score is below the
smallest excluded lower score. Here the cutoff bounds were 0.003250665007223
and 0.003256786552538 local ULPs, respectively. Mirror each chosen magnitude
with its sign bit, positive first per rank. Serialize eight lowercase
hex digits plus LF per raw word; freeze this list's digest before CPU
evaluation. The result concerns this pool, not the global hardest cases.

To check just the refusal pair, use the same private output directory
after the JS and native stages in **Reproduce the fixed diagnostic**:

```sh
printf '%s\n' 39b89da4 b9b89da4 | "$out/mpfr-interval"
printf '%s\n' 39b89da4 b9b89da4 | "$out/mpfr-target"
"$out/native/tanh_native" +RTS --threads 1 --gpu off -RTS "$((16#39b89da4))" "$((16#b9b89da4))"
node --input-type=module - "$out/tanh_portable.mjs" <<'JS'
import {pathToFileURL} from 'node:url';
const {default: api} = await import(pathToFileURL(process.argv[2]).href);
for (const raw of [0x39b89da4, 0xb9b89da4]) {
  const got = api.tanh_portable(raw);
  console.log(raw.toString(16), got.$ === 'None' ? 'None' : got.value.toString(16));
}
JS
```

## What is still unknown

The fixed 5,692-word sample did not exercise `None`; the midpoint diagnostic
demonstrated it on two words. There are no native-target proofs
or full-corpus CUDA results for this candidate, no independent
all-2³²-word reference sweep, no archived-study transition and no
throughput claim. Wider-precision or other correctly enclosed
fallbacks, broader proof and backend checks, exact sharded coverage,
and machine-local adoption benchmarks are separate work. Keep this
diagnostic out of production.
