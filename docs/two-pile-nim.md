# Two-pile Nim

Run `node experiment.mjs run experiments/two-pile-nim.json RUN`,
`node checks/nim_checks.mjs RUN`, then `node arena_tournament.mjs RUN TOURNAMENT`.
Take any positive number of stones from a single pile; taking the last one
wins. Each pile starts with 1–3 stones (parameters clamp and floor). The
observation is the mover's seat and key 4×left+right. Actions 1–3 remove
stones from the left pile; 5–7 from the right.

For the shipped (2,3) game the full graph contains 20 states and 44 edges;
its longest path is five moves. The first player can force a win by
equalizing the piles. The checker enumerates all nine starting pairs and
every legal edge, rejects too-short horizons, and evaluates this independent
policy against a best response in each seat. Its exploitability is zero.
In the shipped (2,3) run, the mod-U32 uniform policy's measured exploitability
is 0.93333333336 (average of its two seat losses to best responses).
