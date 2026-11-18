# Six finite diagnostic probes

These are **bsuite-style**, not bit-compatible replications or submissions to the [Behaviour Suite](https://github.com/google-deepmind/bsuite). They are deliberately small enough to run the entire two-size sweep locally. Each world uses one integer public observation and the usual ordered legal actions. Sizes, horizons and undiscounted values appear in the [benchmark table](../../../EXPERIMENTS.md#benchmark-worlds) and [full-precision oracle results](baselines.json).

| Probe | Construction and interpretation |
| --- | --- |
| Deep Sea | Reachable triangle of the deterministic N×N grid, N decisions. Each cell has its own fixed mapping from actions to left/right. Right costs 0.01/N each time; taking right from the final goal cell pays 1. Mapping seed **3** is shared across sizes and selected so that neither constant action solves either shipped world; no per-episode remapping, wind, or noise. Only one of the 2^N action strings wins, so uniform return is 2^-N − 0.005 before binary32 rounding. |
| Umbrella | Length N. The weather cue is public and possession initially empty. Only the first choice matters; later actions do not alter possession. Each nonfinal move pays independent symmetric ±1 noise; the final choice-independent payoff is +1 if equipped for the weather, −1 otherwise. No distractor observation pixels. Uniform policy has zero expected return; optimal is 1. |
| Memory | Length N. An equiprobable bit is public only in the initial observation. Intervening states reveal time, never the bit; only no-op is legal until a final two-action query. Remembering the bit earns +1, otherwise −1. A policy using only the current observation and legal mask cannot beat zero; the test uses the existing public-event `memoryWorld` wrapper to show one stored bit achieves the full-state oracle of 1. |
| Discount | An initial decision selects 1 immediately or 1.25 on step N; both arms still consume N moves. This reduced two-route probe isolates temporal discounting (upstream uses several reward delays). With γ=0.95 the later reward wins at N=3 but loses at N=6. Reported episode returns are undiscounted, not either policy's internal training objective. |
| Noisy bandit | One decision, N arms; payouts are ±1. One fixed arm has P(+1)=3/4, the rest P(+1)=1/4. Varies the search burden without changing the gap or observation; unlike upstream noise wrappers, no Gaussian draw is required. Expected uniform return is 1/N − 1/2. |
| Catch | Three rows and N columns; the ball falls straight down from a uniformly random visible column. The paddle starts at floor(N/2); commands left, stay and right clamp at a wall. After two moves, catching pays +1, missing −1. Both shipped widths are coverable from the center. Uniform actions ignore the ball, so expected return is 2/N − 1. |

Inspiration: the upstream [Deep Sea](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/deep_sea.py), [umbrella](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/umbrella_chain.py), [memory](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/memory_chain.py), [discounting](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/discounting_chain.py), [bandit](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/bandit.py) and [catch](https://github.com/google-deepmind/bsuite/blob/main/bsuite/environments/catch.py) tasks. This project generates its own state machines, scores and seeds. In particular, these numeric observations are not upstream pixel arrays; the memory probe is a one-bit recall task, not a multi-bit query benchmark. Optimal/full-state and uniformly random baselines are expectations under the declared finite horizon; training metrics include sampling noise.

## Reproduce

From the repository root, with Node 24+, Bend 2.0.40, and Matplotlib for plotting:

    node worlds/benchmarks/probes/generate.mjs --check
    node --test worlds/benchmarks/probes/checks.mjs
    node experiment.mjs run experiments/probe-memory.json runs/probe-memory
    node experiment.mjs verify runs/probe-memory
    node experiment.mjs export runs/probe-memory > runs/probe-memory.csv
    python plot_curves.py runs/probe-memory.csv runs/probe-memory.svg --phase validation

Substitute `deep-sea`, `umbrella`, `discount`, `bandit` or `catch` for `memory` to run the other size sweeps. Each plan runs two arms × two separately trained replicates × two sizes at three checkpoints. Plotting uses the existing game panels, one per size; the small replicate count demonstrates the workflow, not statistical significance. All six plans were compiled, completed, verified, exported and plotted locally on Linux. The default RNG and plotting code are unchanged. Regenerate deliberately via `generate.mjs --write`; tests check bytes, analytic expected values, information hiding and selected action/reward invariants.
