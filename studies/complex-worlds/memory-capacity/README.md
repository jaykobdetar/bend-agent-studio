# Switchboard: how much memory helps?

With all 16 cue bits visible in memory, tabular Q-learning faces 1,048,576
different query contexts. Remembering the last few cues lowers the best
possible score, but it lets the learner reuse an observation more often.

[This study plan](plan.json) keeps the same width-16, zero-blank game, query
and reward, and the same learner. Its [study-only adapter](switchboard_suffix.bend)
uses the shipped Switchboard transitions and changes only the public memory
encoder. Each learner keeps the last `k` public cues for `k = 0, 2, 4, 6, 8, 12,
16`. Eight replicates use matched train, validation and test seed blocks
across capacities; the three phases are disjoint. Each episode takes 17 moves.

## Result

| Completed training episodes | Best tested capacity | Exact signed return | Accuracy |
| ---: | ---: | ---: | ---: |
| 128 | 2 bits | 0.1133 | 55.7% |
| 512 | 4 bits | 0.2207 | 61.0% |
| 2,048 | 6 bits | 0.3242 | 66.2% |
| 8,192 | 8 bits | 0.4323 | 71.6% |

The lead of two over four bits at 128 episodes was unresolved (paired
difference +0.0107, 95% interval −0.0052 to +0.0267). At 2,048 episodes, the
six-bit variant beat both no memory (exact return zero) and all 16 bits
(+0.0020). At 8,192 episodes, the eight-bit variant beat six bits by +0.0576
(95% paired interval +0.0537 to +0.0614). It also won on fresh held-out
episodes (+0.0417, interval +0.0200 to +0.0635). These are descriptive
intervals across eight training replicates, not across individual episodes
and not adjusted for multiple comparisons.

The [aggregate results](results.json) include every capacity and budget,
the ideal training prediction, coverage counts, and observed validation
or held-out return. The archived full-memory policies at 8,192 episodes
had mean exact return +0.0078. Their held-out mean of −0.0134 was noisy;
it does not show that those policies were worse than guessing.

## Why the crossover happens

A uniformly drawn query addresses a retained cue with probability equal to
the retained fraction.
Unretained bits are fair given the public state and contribute zero
expected signed return. There are `M = 16 × 2^k` query contexts. The first
visit to a known context distinguishes the correct action from the wrong
one: the chosen action receives +1 or −1 and the other starts at zero.
Under independent uniform training draws, expected signed return after
`n` completed episodes is the retained fraction times the probability of
visiting a given context at least once, `1 − (1 − 1/M)^n`.

For an individual frozen policy, tied unseen contexts choose 0. True
label-0 and label-1 contexts are balanced under the fair world model,
but the *visited subset* can be imbalanced. The audit evaluates the
greedy predictions directly: for each visited known context that
predicts 1, add +2 if the right bit is 1, or −2 if it is 0, then divide
by the number of possible contexts. It checks the formula exhaustively
at width two and checks that each visited known context was solved in
the archived policies. “Exact” here refers to the ideal fair world
model, not the joint distribution over deterministic 32-bit seeds.

This is a result about a suffix-memory encoder and tabular lookup, not an
upper bound on arbitrary compressed memories. A policy that retrieves the
queried bit directly can use all 16 cues without learning each context.

## Reproduce

Run from the repository root with Node 24 and Bend 2.0.40. The research
run used the same plan settings and seed blocks, stopping at checkpoint
zero, advancing each capacity to 2,048, then to 8,192. Its one-core run
accepted 9,382,912 moves including evaluation and saved 280 checkpoints.
The equivalent sequential commands below use whole-plan resume instead of
one capacity shard at a time. The run directory must be new.

```sh
study=studies/complex-worlds/memory-capacity
node experiment.mjs run "$study/plan.json" runs/memory-capacity --until 0
node runs/memory-capacity/code/experiment.mjs resume runs/memory-capacity --until 2048
node runs/memory-capacity/code/experiment.mjs resume runs/memory-capacity
node experiment.mjs verify runs/memory-capacity
python3 "$study/audit.py" runs/memory-capacity > runs/memory-capacity-results.json
cmp "$study/results.json" runs/memory-capacity-results.json
```

Allow a few minutes and roughly 120 MiB of local archive space. Use only a
trusted archive; the resume commands execute its saved code.
