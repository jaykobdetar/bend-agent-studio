# Phase 9 handoff: 2026-11-19

Starting revision: [fc3c2d3](https://github.com/jaykobdetar/bend-agent-studio/commit/fc3c2d30e0c152377faaf11f230d6595a02c6c0a). This is a progress record, not a claim that queued items have landed.

| Item | Current disposition | Change / next step |
| --- | --- | --- |
| N9.0 | [PR #30](https://github.com/jaykobdetar/bend-agent-studio/pull/30) | Roadmap captured. Removed the stale pre-rewrite branch after preserving its tip; verified the ref is absent. The original plan survives byte-for-byte in docs/history/reorganization-plan.txt and the roadmap records all four F8 items. Merge requires green CI. |
| N9.1 | Left on branch; [PR #31](https://github.com/jaykobdetar/bend-agent-studio/pull/31) | Local checksum-pinned binaries, isolated Python lock-file environments and MCP install; optional test extras cover cross-version Node and SVG. The additional Linux job builds the non-root devcontainer and runs its post-create command and zero-skip checks there, keeping the existing gate workflows intact. Next: verify clean provisioning, then all branch checks. |
| N9.2 | Queued | Run and verify the eight-learner toy-text/probe study; publish outputs, uncertainty and a deterministic CI slice. |
| N9.3 | Queued | Validate and queue training plans from experiments/; render layout metadata with text fallback and mobile coverage. |
| N9.4 | Queued | Weekly non-blocking latest-Bend-2.x check and single failure issue; document the pin upgrade procedure. |
| N9.5 | Queued | Add safe agent/world/plan initialization and seeded sweeps with matching MCP tools. |
| N9.6 | Queued | Estimate paired bootstrap precision and sign-test power from pilot exports, for planning only. |
| N9.7 | Queued | Check finite lookups, logging mass and hook pause/resume; exercise validation, export and MCP boundaries. |
| N9.8 | Queued | Pin an isolated formatter outside archive inputs; separate formatting-only commit from CI enforcement. |
| N9.9 | Queued | Add tested Acrobot dynamics and simultaneous zero-sum games with exact values and exploitability. |
| N9.10 | Queued | Isolated optional tracking exporter with checkpoint curves checked against the plotting data. |
| N9.11 | Queued | Expose bounded seeded finite-world sessions and check public frames against replay. |

No core, archive-gate or proof changes in the starting roadmap revision. The existing checker and toolchain pins remain authoritative.
