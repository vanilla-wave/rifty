# Segmented replica pickup — 2026-09-12

Authority: accepted fast-project-open-reopen goal I1/I2/I3/I5, Outcome (a–f).
Independent DEC-2 reviewer: `/root/replica_decision`; read-only against
`e1de2db6694fc34c949a6f3310070ab82b66d025`. Selected existing OpfsFsSync +
batched physical sink; rejected a new MemoryBackend-based sync owner. Exact
supersessions and alternatives: ADR-0425. No user fork reopened.

## Current native baseline

HEAD source: `93c05f463cc266eb47f36b4fd8cf528c9ad1d0b3` (storage unchanged
from main `acf594da9`). Chromium 148.0.7778.96, Node 24.16.0, macOS,
headless persistent profile; browser process closed and relaunched before every
sample. Offline set before Worker receives the reopen request. Host bootstrap
already loaded; no registry/snapshot/data fetch. OS page cache not evicted.
T paths/sizes from committed tracker-tree-manifest.json; payload bytes generated
at exact lengths. Every reopened byte checked, outside the restore timer.

| sample | durable flush tail, ms | eager fresh-process restore, ms |
|---|---:|---:|
| 1 | 9909.470 | 4499.240 |
| 2 | 10371.450 | 4464.665 |
| 3 | 10319.595 | 4422.050 |
| median | 10319.595 | 4464.665 |

Synchronous materialization: 66.485–69.985 ms. Root-empty init: 0.315–0.390 ms.
This measures the storage boundary, not end-to-end openProject latency. It
replaces no historical goal evidence: pre-ADR-0393 8.4 s stays labelled history.
Production acceptance must also cross the real opening/command boundary.

## Native commit probe

Real Worker/native handles; exclusive guard is separate from HEAD. Second
acquire: NoModificationAllowedError. Write `old`, close; write `new` without
close: native read is `old`. Terminate writer, reacquire guard: read remains
`old`. Write `new`, close: read is `new`. No simulated filesystem.

## Decision traps

- Per-file scheduler admission before batching caps the batch at 16 operations,
  and same-directory dependencies can make it one. Capture/register first.
- Workbench origin lease does not cover direct/configured no-COI SDK boot;
  native guard must reject contention before replay, under preferred too.
- Reporting timeout is not native settle. Releasing a guard early permits a
  previous HEAD close to overwrite a new owner's publication.
- Owner proof and installer equality already require fresh native reads.
  Reading the live content cache would manufacture durability.
- Capture the live front at one watermark for compaction; later mutations
  cannot leak into the base ahead of their persist operation.
- Native quota during compaction keeps prior HEAD; a failed cleanup after
  successful HEAD publication cannot authorize deletion of reachable segments.

A+B re-cut removes only temporary machinery. I1/I2/I5 and Outcome (c) are
unchanged; legacy health remains linked until its final slice. Broader existing
fault-honest-opfs-persistence drafts remain unlanded: replica carriers must prove
required faults on the new substrate; their old native-file injections are not
accepted by filename alone.
