---
area: distribution
status: draft
title: Snapshot straight after a restore needs more isolate memory under load
created: 2026-11-23
why: with no guest code between restore and snapshot, the restored blob may not be collected yet; under machine load the isolate then can need more than restore → run → snapshot, up to ~3 × the blob (reasoned)
user_story: As an embedder that snapshots an isolate right after restoring it, I want the documented memory limit to hold, but today under load the snapshot can need ~1.2 × the floor of the sandbox's restore → run → snapshot
blocked_by: []
sources: [ADR-0567, packages/isolate-guest/README.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Probe 2026-11-23, M3 Pro, Node v24.16.0, isolated-vm 7.0.2, template-scale
tree (23 654 files, blob 98.1 MiB), smallest isolate `memoryLimit` (MiB):

```
cd docs/backlog/distribution/reference/isolate-host-fs-snapshot-probe
node --no-node-snapshot restore-then-snapshot.mjs 3
```

| machine | restore → snapshot | restore → `run('0')` → snapshot |
|---|---|---|
| at rest (load ~2), 3 rounds | 225, 225, 225 | 225, 225, 225 |
| 12 busy loops (load ~26), 2 rounds | 277, 232 | 225, 225 |

Against the goal's I6 budget 2 × S + 64 = 260 MiB: the scenario's sequence (a
sandbox always runs guest code between) stays at 225; straight after a
restore, 277 under load exceeds it. Against ADR-0567 §7's sizing rule
(2 × `maxBytes` + 16 MiB; this tree's minimal budget is 135.6 MiB → 287 MiB)
it still fits here, but a blob whose budget is mostly bytes (one large file,
`maxBytes` ≈ S) may need up to ~3 × S on this sequence — tree, uncollected
blob and the new snapshot alive at once (reasoned, not measured). Straight after a
restore, the copied blob is garbage the GC has not collected yet; under load
it lags. Earlier figures 231–322 MiB (measure-snapshot runs under load 57–155,
pre-budget code) are superseded by this probe.

Manager's reading 2026-11-23 (ADR-0567 «Not the user's words»): not a user
fork — no requested action needs this sequence.

Owner: distribution (isolate host); trigger: an embedder that snapshots a
just-restored isolate with no guest code between.

## Challenge

challenge: none — factual capture, no direction proposed
