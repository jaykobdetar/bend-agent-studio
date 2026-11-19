# Native backend spike (T2.3)

**Decision: retain the ES-module backend.** Bend 2.0.40 can build a CPU executable that Node can call. The unmodified `study.bend -o study.mjs` works, but both `-o study-native` and `-o study.c` on that source alone return “no main to run”. An executable needs an entry point. The probe imports Study, exposes pure computations to the reference ES module, and uses a native `main` that reads a replicate argument and prints lossless unsigned words. Node launches it directly with no shell. This is a fixed experiment adapter, **not** a native replacement for the production JS object API, archived cursors, or replay format.

## What matched

On Linux x86-64 (Xeon Platinum 8573C; Node 24.22.3, Bend 2.0.40, Clang 22.1.4), compare the complete report and model words for the first 32 replicate seeds:

| Shipped plan and arm | Training boundary | Exact matches |
|---|---|---:|
| maximization-bias.json / q | First episode | 32/32 |
| maximization-bias.json / q | Last episode plus complete model at the 1,024-episode training checkpoint | 32/32 |
| cartpole.json / network | First completed episode (not an entire step-budget run) | 32/32 |

The encoded data cover stop tag and illegal action if present, step count, score, method and settings, and all ordered table rows or network weights and biases. The harness compares actual words, not hashes or rounded decimal floats. It first checks its ES encoding against a separately invoked, unmodified study ES module using the repository's validated plans, settings and seed functions. Thus, a typo in the hard-coded native probe configuration cannot silently pass by matching the same typo in its own ES output. All 32 one-thread and four-thread CPU results matched exactly. No GPU or explicit parallel-call variant was run.

Separately, each of `cos`, `tanh`, `sqrt` and `log` matched in **4,096/4,096** F32 input cases (each operation returned a raw F32 bit pattern). At index i the positive input is (i+1)/171 in F32, and cos/tanh use that value minus 12. This is a deterministic finite sample, not exhaustive math-library parity or another platform guarantee.

## Timing and interpretation

Single compiler invocations: stock Study ES module **1.71 s**; instrumented probe ES module **2.42 s**; instrumented native executable **21.18 s**. Each runtime sample includes the two first-episode computations, the 1,024-episode NoisyFork workload and four scalar math checks for one replicate. Times below are **median milliseconds over 32 replicates**, not time per episode.

| Host path | Pass 1 | Pass 2 |
|---|---:|---:|
| ES in existing Node process, including unpacking | 17.44 | 5.88 |
| Fresh CPU executable from Node, one thread, including launch/JSON decode | 28.17 | 7.22 |
| Same, four threads | 19.62 | 7.38 |

Runs were on a shared machine, ES received one warm-up, and native thread-count order alternated by replicate. These are end-to-end timings for this prototype; startup/serialization and load are not isolated. They do **not** support a native or parallel speedup claim. We did not check every shipped arm, all checkpoints, validation/test episodes, resumed partial cursors, authored/custom adapters, cross-platform math, or any GPU implementation. No checkpoint or backend changes were made. A production candidate needs a persistent or batched request/response boundary for the actual generated adapters and a full shipped-plan, replay and resume parity matrix before adoption.

## Historical reproduction procedure

These commands document the original flat-table experiment. They do **not** reproduce the tabular comparison on current main: the shipped Q arm now produces indexed tables, while the Bend probe and its JavaScript reference reader only encode flat entries. The results above are historical, not a parity check of the current model format. Production training and replay do not use this probe.

Use a separate checkout at `e40acba039b86623dd702f9f07f56cdca1ed0d8b`, then follow the [original commands and toolchain notes](https://github.com/jaykobdetar/bend-agent-studio/blob/e40acba039b86623dd702f9f07f56cdca1ed0d8b/tools/native-spike/README.md#reproduce) from that checkout’s root. The flat source paths in those commands belong to that revision.

The JSON output separates primitive stress cases from the report comparisons and retains the first differing word, if any. This optional spike is not part of npm test and adds no dependencies.
