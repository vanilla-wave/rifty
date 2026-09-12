---
area: perf
status: ready
title: Project VFS page reads copy the whole owner tree
created: 2026-08-31
why: each page read-file/read-directory request calls full OwnerVfsAuthority.snapshot; one target read on a 98.2 MB / 14,492-file tree measured 46.5 ms versus 0.01 ms direct
user_story: As a developer opening files and expanding directories in a large project, I want each editor/explorer read to scale with the requested entry, but today every request copies every file in the owner tree.
epic: fast-project-open-reopen
blocked_by: []
sources: [docs/backlog/vfs/reference/storage-journal-design-benchmarks-2026-08-31.md, docs/backlog/vfs/reference/storage-open-reopen-candidate-benchmarks-2026-09-01.md]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/workbench/src/workers/owner-vfs-authority.ts]
---

## Context

`workbench-project-vfs.ts` handles both page read-file and read-directory by
calling `options.authority.snapshot()`. `OwnerVfsAuthority.snapshot()` sorts
every tracked path and `#snapshotEntry()` slices every file's bytes before
`atomicFile` selects one file or `atomicDirectory` selects immediate children.

Real Chromium Worker measurement on 14,492 files / 98.2 MB: page read-file
samples 46.545, 48.110, 48.125, 45.175, 46.110 ms (median 46.545 ms); direct
authority target reads median 0.010 ms. The editor-open user action therefore
does ~4,655× the measured target-read work and transiently copies the full
tree. This is independent of the OPFS replica format and should be repaired
before introducing that larger mechanism.

The read runs synchronously in the sole owner Worker, so no other owner
mutation can interleave inside it. A targeted response still must carry the
same owner epoch/tree revision/path version and defensive content copy; the
regression proof must exercise the real page request and detect a whole-tree
read without source-grep assertions.

Re-verified 2026-09-12 on main: `readFile` / `readDirectory` still call
`options.authority.snapshot()` and `#snapshotEntry` still slices every file.

Dedup scan: no backlog title/code/goal-map match. `perf/fs-rpc-chunk-perf`
targets child RPC large-file chunking, not page editor/explorer reads.

Real editor-action follow-up on the shipped TypeScript snapshot: five distinct
`ProjectDocument.open()` calls over a 521-entry / 51.1 MB owner tree took
5.830, 5.240, 11.180, 4.305, 4.610 ms (median 5.240 ms). The exact
`OwnerVfsAuthority.snapshot()` inside those requests took 4.685, 4.060, 8.955,
3.950, 4.320 ms (median 4.320 ms): **82.4%** of document admission. The defect
therefore dominates a real editor action even before the 14,492-file case.

## Challenge

challenge: 2026-08-31 — 1 problem
Impact/UX: 4,655× compares internal read work, not the whole editor/explorer action; no end-to-end latency share or workload prevalence shows the measured 46.5 ms materially affects target Node/WASI users or merits roadmap priority.

Answer: 2026-09-01 — real `ProjectDocument.open()` measurement closes the
impact premise: full-tree snapshot is 82.4% of median document admission on a
shipping template. The absolute 4.32 ms is small on its 521-entry tree, while
the already-measured 14,492-file tree raises the same phase to 46.5 ms.

## Acceptance

1. Real owner page read-file copies only the requested file; directory reads
   copy no file content. Epoch, revision, path version, directory-first
   ordering and defensive bytes retain current observable behavior. → I4
2. In Chromium Worker, a 4 KB file and 33-entry directory each read in ≤1 ms
   median on T and ≤2× their medians on a 521-entry tree. The committed
   manifest carries the pinned snapshot's 15,568 paths / 73,637,414 bytes. → I4

## Parity cases

- Existing Project VFS replies, invalid paths, missing entries, current
  versions and isolated returned content remain unchanged; this is an
  internal owner protocol, with the existing implementation as reference. → scenario

## Out of scope

OPFS format and persistence waits remain with the replica slices; no API or
guest filesystem semantics change.

## Decisions

- ready-verdict: 2026-09-12 — Contract+RED @ e1de2db6694fc34c949a6f3310070ab82b66d025

- 2026-09-12 — reuse accepted goal premise; read synchronously through existing
  authority FsSync and version accessors, without a new state owner or API.
- 2026-09-12 — PR-4: replace the old test's required full-snapshot call count
  with transparent memory content-read observation; exact reply assertions
  remain. The previous criterion enforced the observed performance defect.
- 2026-09-12 — source manifest extracted from the original snapshot SHA-256
  `532d42b786858843e1c262caf303f75dfb58c4f61466ed1cea4d677c2fa3fd1a`;
  generated payload bytes exercise storage shape, not package execution.
