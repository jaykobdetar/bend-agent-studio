# Large finite-world compiler memory

The runner still executes the world, RNG, agent and learner in Bend. For normalized finite worlds with at least 128 states, the generator emits a compact immutable word table in pages instead of a match arm per state/action. Each U32 is split into three BMP private-use characters (10/11/11 bits). State rows reference ordered action records; outcomes store the same inclusive U32 cutoffs, destinations and F32 reward bits as before. A typed Bend kernel handles lookup and sampling. Smaller worlds retain their source layout. Neither compiled artifact size nor simulation speed is the optimization target.

## Paired build measurements

Linux x86-64, Node 24.22.3, Bend 2.0.40, one CPU, niceness 15. Baseline was unchanged commit `d54be5bbd27f43d828099ff46fe6bc2fc2ec680c`. Each trial started a fresh process and output directory; one Q-learning arm, one replicate, horizon 8, checkpoints at 0 and 3 episodes, four validation and four test episodes. Inside each of three rounds, Taxi then Blackjack were run, always baseline then candidate. These are **end-to-end sampled group RSS** (Node, compiler and children) and elapsed times, not compiler-only memory or cold-cache timing. RSS counts shared pages in each process. The 60 ms poll can overshoot or miss a transient peak.

| World | Baseline, sampled MiB at guard stop (3 runs) | Packed, sampled peak MiB (3 runs) | Packed, completed seconds |
|---|---|---|---|
| Taxi | 1233, 1209, 1209 | 403, 402, 404 | 2.84, 2.24, 2.48 |
| Blackjack | 1204, 1221, 1212 | 390, 397, 371 | 2.60, 2.42, 2.24 |

Every baseline study was stopped at the **1,200 MiB group RSS guard**. Those figures are lower bounds on the resources an unrestricted completed baseline would need, not measurements of a completed run. No baseline elapsed-time speedup or full-size legacy trajectory equivalence is inferred.

To repeat, use separate clean checkouts of the baseline and candidate. Put the same Node 24+ and Bend 2.0.40 on PATH for both. On Linux with procfs and util-linux:

    python3 tools/finite-layout/measure.py --baseline /path/to/baseline --candidate .

The script creates a fresh directory and preserves plans, logs, run artifacts and `measurements.jsonl`. It samples a new process group, pins a single allowed CPU and stops only that group. It declines to start below 4.5 GiB available RAM or 384 MiB free swap, and stops on low reserve, 1,200 MiB group RSS or 90 seconds. The sampled guard is not a hard OS limit; use an isolated resource-limited machine when strict limits matter.

## Semantics and archives

    node --test tools/finite-layout/packed-checks.mjs

The tests compile the actual data and independently reconstruct rational integer endpoints. Taxi: all 504 states and 6,000 boundary probes; Blackjack: all 670 states and 7,104. They check 1,024 reset seeds per world, every public observation and ordered legal-action list, every observed rank, invalid states/actions, plus sparse and maximum U32 IDs and bit-sensitive F32 edge cases. The archive test pairs an unchanged slippery Lake with a semantically identical version padded with unreachable states: it compares every checkpoint, including the partial-episode cursor, Q state and metrics, across plain and previous-observation agents, plus frozen replay and byte-identical checkpoint reruns. This separately tests old versus new *layouts*, without pretending that the resource-censored large baseline produced archives.

On the candidate, separate Taxi (horizon 200) and Blackjack (32) studies each completed random and Q-learning trials at checkpoints 0, 4 and 16 (one replicate, four validation/eight test episodes). The archived runner verified both studies, reproduced all six checkpoint files per world byte-for-byte, and reproduced a frozen test replay per world. These bounded functional studies are not convergence or learning-performance claims.

As a backward-compatibility check, a fresh small Lake study from the unmodified baseline was reopened with its original archived runner: verification passed and all rerun checkpoints matched byte-for-byte. The new runner refused to resume it and identified the archived runner, as intended; it did not rewrite the old archive.
