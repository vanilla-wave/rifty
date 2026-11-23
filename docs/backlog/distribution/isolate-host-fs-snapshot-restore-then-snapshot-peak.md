---
area: distribution
status: draft
title: Snapshot straight after a restore needs up to ~3 × the bytes of isolate memory
created: 2026-11-23
why: with no guest code between restore and snapshot the restored blob is not collected yet, so tree, garbage blob and the new snapshot are alive at once — beyond the documented 2 × maxBytes + 16 MiB
user_story: As an embedder that snapshots an isolate right after restoring it, I want the documented memory limit to hold, but today a one-file 96 MiB tree needs 300 MiB there against 206 for restore → run → snapshot
blocked_by: []
sources: [ADR-0567, packages/isolate-guest/README.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Probe 2026-11-23, M3 Pro, Node v24.16.0, isolated-vm 7.0.2; smallest isolate
`memoryLimit` (MiB), template-scale bytes (23 654 real files):

```
cd docs/backlog/distribution/reference/isolate-host-fs-snapshot-probe
node --no-node-snapshot restore-then-snapshot.mjs 3             # 23 654 files
node --no-node-snapshot restore-then-snapshot.mjs 3 --one-file  # the same bytes, one file
```

| tree (load) | restore → snapshot | restore → `run('0')` → snapshot |
|---|---|---|
| 23 654 files, 98.1 MiB (load ~3) | 225, 232, 311 | 225, 225, 225 |
| 23 654 files (12 busy loops, load ~26) | 277, 232 | 225, 225 |
| one file, 95.9 MiB (load ~3) | 300, 300, 300 | 206, 206, 206 |

Each bisection point is tried once and GC is not deterministic: the
template row's 311 is the worst of three noisy runs; the steady confirmation
is the one-file row, 300 three times. Straight after a restore the copied
blob is garbage V8 has not collected:
tree, blob and the new snapshot are alive together, ~3 × the bytes. Guest code
between (a sandbox always runs it) gives the GC its chance. Against I6's
budget (ADR-0567 «Goal invariants») (2 × S + 64 = 260 MiB at 98 MiB) the scenario's sequence holds;
this one does not. Against ADR-0567 §7's rule (2 × `maxBytes` + 16 MiB) a
budget that is almost all bytes (one large file) is exceeded by ~95 MiB.
Earlier figures 231–322 MiB (measure-snapshot runs under load 57–155,
pre-budget code) are superseded.

Manager's reading 2026-11-23 (ADR-0567 «Not the user's words»): not a user
fork — no requested action needs this sequence.

Owner: distribution (isolate host); trigger: an embedder that snapshots a
just-restored isolate with no guest code between.

## Challenge

challenge: none — factual capture, no direction proposed
