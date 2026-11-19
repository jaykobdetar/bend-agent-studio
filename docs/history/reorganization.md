# Repository reorganization: implementation record

The [original plan](reorganization-plan.txt) is a transcription of the supplied specification, not a current command reference. For current paths, see the [repository layout](../../README.md#repository-layout) and [commands](../commands.md).

| Stage | Result |
| --- | --- |
| Documentation checks and archive baselines | Added offline link, anchor, command-path, count and coverage checks. Captured source maps for 31 training plans, 26 custom bundle uses and eight representative compiled backends. |
| M0 | Exported CLI entry points and named module-local roots. Only the [exact runner digest pair](../../tools/archive-gates/m0-exceptions.json) is allowed by the source identity check. |
| M1–M3 | Grouped the runtime, laws/checks, analysis and offline tools. Kept root experiment, batch and public-oracle CLI entry points. Sealed archives still use flat names and their recorded runtime. |
| M4–M5 | Grouped all eight agent implementations, with proofs alongside the six learners that have them. Kept the runnable demo and bandit helper together; retained the standalone benchmark and checked all 100 output rows. |
| Guides | Relocated source prose before editing it. Preserved old guide anchors, six learner-guide stubs, and both Studio screenshots. Published the [rule evidence ledger](../laws.md), [test matrix](../testing.md) and [command reference](../commands.md). |

The owner chose direct commits to a single main branch rather than the proposed PR sequence. The direct-main checklist is in the [roadmap](../../ROADMAP.md#documentation-checklist). Hosted CI regenerates the old partial archives from the pinned pre-move revision instead of storing executable archive binaries in Git. Its [replay gate](../../tools/archive-gates/g4-hosted.sh) exercises both built-in and custom learners.
