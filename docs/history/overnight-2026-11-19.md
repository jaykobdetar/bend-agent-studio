# Phase 9 handoff: 2026-11-19

Starting revision: [fc3c2d3](https://github.com/jaykobdetar/bend-agent-studio/commit/fc3c2d30e0c152377faaf11f230d6595a02c6c0a). This is a progress record, not a claim that queued items have landed.

| Item | Current disposition | Change / next step |
| --- | --- | --- |
| N9.0 | Merged; [PR #30](https://github.com/jaykobdetar/bend-agent-studio/pull/30) | Roadmap captured. Removed the stale pre-rewrite branch after preserving its tip; verified the ref is absent. The original plan survives byte-for-byte in docs/history/reorganization-plan.txt and the roadmap records all four F8 items. Linux and Windows passed. |
| N9.1 | Merged; [PR #31](https://github.com/jaykobdetar/bend-agent-studio/pull/31) | Local checksum-pinned binaries, isolated Python lock-file environments and MCP install; optional test extras cover cross-version Node and SVG. The additional Linux job builds the non-root devcontainer and runs its post-create command and zero-skip checks there, keeping the existing gate workflows intact. Fresh container passed with no root or MCP skips. Windows initially reported a Python process timeout; its unchanged rerun passed, as did the existing proof and archive jobs. |
| N9.2 | Merged; [PR #32](https://github.com/jaykobdetar/bend-agent-studio/pull/32), [study](../../studies/flagship-toy-text/README.md) | Kept all 400 trials; selected two one-step bandit probes and used pre-existing exact oracle baselines for IQM scaling. Verified all 2,400 checkpoints and exact first-checkpoint bytes on two fresh shards. Added a fully pinned supplemental G2/G3 plan entry, while retaining the exact inventory requirement and both historical baselines. The next useful experiment is a larger independent confirmation suite, not hyperparameter tuning on these test seeds. |
| N9.3 | Left on branch | Studio validates checkout manifests, snapshots dependencies, and uses optional public grid metadata. Sidecars keep existing archive world inputs byte-identical. Review the 390 px browser flow and require full CI before merge. |
| N9.4 | Queued | Weekly non-blocking latest-Bend-2.x check and single failure issue; document the pin upgrade procedure. |
| N9.5 | Queued | Add safe agent/world/plan initialization and seeded sweeps with matching MCP tools. |
| N9.6 | Queued | Estimate paired bootstrap precision and sign-test power from pilot exports, for planning only. |
| N9.7 | Queued | Check finite lookups, logging mass and hook pause/resume; exercise validation, export and MCP boundaries. |
| N9.8 | Queued | Pin an isolated formatter outside archive inputs; separate formatting-only commit from CI enforcement. |
| N9.9 | Queued | Add tested Acrobot dynamics and simultaneous zero-sum games with exact values and exploitability. |
| N9.10 | Queued | Isolated optional tracking exporter with checkpoint curves checked against the plotting data. |
| N9.11 | Queued | Expose bounded seeded finite-world sessions and check public frames against replay. |

No core, archive-gate or proof changes in the starting roadmap revision. The existing checker and toolchain pins remain authoritative.
