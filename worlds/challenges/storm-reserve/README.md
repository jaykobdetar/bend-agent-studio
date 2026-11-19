# Storm Reserve

Buy, hold or sell one unit of battery charge in a changing market. Starting in
calm weather with the required reserve already on hand, maximize cash plus a
terminal settlement. There is no free last trade: on the final turn the
normal trade and its settlement are scored together. Each state reveals the
clock, charge and weather; nothing private or continuous is approximated.

| Current weather | Sell | Buy | Next calm / tight / storm (out of 8) |
| --- | ---: | ---: | --- |
| Calm | 1 | 2 | 5 / 2 / 1 |
| Tight | 4 | 5 | 2 / 4 / 2 |
| Storm | 9 | 10 | 1 / 3 / 4 |

Action IDs: **0** hold, **1** buy if below capacity, **2** sell if above
zero. The reserve is half the capacity rounded down. Each unit below reserve
costs 7 at settlement; each unit above earns 1. Holding the original charge
throughout always earns zero. All probabilities are dyadic so the weather
weights divide the runner's U32 draw exactly. Same-seed arms see the same
weather sequence even if their inventory decisions differ.

**Why planning matters:** with two periods and capacity two, buying in calm
weather is worth −1 if settled immediately. With one more period left,
the best achievable expected value after holding, buying and selling is
respectively 0.25, **0.75** and −2.375. Buying wins despite the spread.

| Periods × capacity | States | Optimal | Short-sighted | No trade | Uniform |
| --- | ---: | ---: | ---: | ---: | ---: |
| [2 × 2](reserve-2x2.json) | 11 | 0.750 | 0.250 | 0 | −2.278 |
| [12 × 4](reserve-12x4.json) | 161 | 15.584 | 9.054 | 0 | −6.988 |

The short-sighted controller chooses as if it were the final period each time
(ties: hold, buy, sell), then faces the true next period. The independent
inventory recurrence sweeps the physical model backwards; the generic oracle
instead works on all generated transition rows. They agree on both published
variants and were compared up to 96 periods × 24 capacity, **6,731 reachable
states / 58,620 outcomes**. That largest case was solved on the host, not
trained in Bend. Timings are workload and machine specific.

From the repo root with the pinned tools:

```sh
node worlds/challenges/storm-reserve/generate.mjs --check
node --test worlds/challenges/storm-reserve/checks.mjs
node experiment.mjs oracle worlds/challenges/storm-reserve/reserve-12x4.json 12
node experiment.mjs run experiments/storm-reserve.json runs/reserve
node experiment.mjs verify runs/reserve
node runs/reserve/code/experiment.mjs replay runs/reserve reserve-12x4 dyna-5 0 1024 test 0
```

Generate another size with `node worlds/challenges/storm-reserve/generate.mjs
--emit 24 8` (redirect into a fresh file). Bounds are 1–96 periods and 2–24
units of capacity. The [generator and physical recurrence](world.mjs) also
return a decoder: `stormReserve(h,c).rows[id]` is the public tuple
`[elapsed, charge, weather]` or null for the terminal. See the
[paired study](../../../studies/complex-worlds/README.md) for learning results.
