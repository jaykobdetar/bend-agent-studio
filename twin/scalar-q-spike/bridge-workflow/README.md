# Bridge end-to-end native diagnostic

The frozen Bridge experiment has three learners, eight replicates and
three checkpoint files per trial. A diagnostic native writer generated
each checkpoint from the native result and sealed it against the original
archive contract; it did not copy donor trial payloads. Every sample
wrote an archive and performed archived verification and CSV export.
A fixed archived replay was compared separately, outside the timing.

On the reference Ryzen 7 5800X, one pinned logical CPU and the pinned
Node 24.22.3, Bend 2.0.40 and Clang 22.1.4 toolchain, five interleaved
samples per mode produced the following medians:

| Mode | Stock | Native | Result |
| --- | ---: | ---: | --- |
| Cold | 2.329 s | 2.726 s | Native took 17.0% longer |
| Warm | 0.310 s | 0.178 s | Native was 1.73× as fast |

Cold native includes generating and compiling the candidate as well as
the identical stock replay code retained in the archive. Warm modes
reuse prebuilt code, but both copy the same empty archive template inside
the timed scope. All 20 entire file trees, each containing the same
72 checkpoint bytes, verified and exported identically. The untimed
learned-model replay also matched. No timing scope swapped or hit a cap.
The trusted stock archive and warm template were unchanged.

This one-plan result is an end-to-end diagnostic, not a production engine,
native interrupt/resume test, or flagship speedup. The cold regression
rules out adopting this build path as the default.

[Protocol and raw timings](evidence.json) record the exact frozen input and
code digests, run order, resource checks, and observed medians.

## Broader parity, not timings

A separate [original Storm Reserve matrix](storm-reserve-evidence.json)
matched 192 distinct stock checkpoints across the complete six-cell
study. Both compiler targets and 1, 2 and 4 workers produced the same
bytes, for 1,152 comparisons. The larger final test budget was admitted
only for the exact archived plan and cells; the projected-plan control
still refused it. The stock archive was not changed and no native
archive was written in this separate check.

The [flagship v2 remainder](flagship-evidence.json) checked 22 additional
original cells and 1,980 distinct checkpoints. Together with the earlier
three cells, this covers all 2,250 checkpoints in the native diagnostic's
25 eligible cells. Fifteen custom-agent cells are outside this scope.
The new matrix performed 11,880 whole-file comparisons across both
compiler targets and all three worker counts. It did not write native
archives or measure flagship workflow speed.
