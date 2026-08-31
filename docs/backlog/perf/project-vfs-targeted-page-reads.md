---
area: perf
status: draft
title: Project VFS page reads copy the whole owner tree
created: 2026-08-31
why: each page read-file/read-directory request calls full OwnerVfsAuthority.snapshot; one target read on a 98.2 MB / 14,492-file tree measured 46.5 ms versus 0.01 ms direct
user_story: As a developer opening files and expanding directories in a large project, I want each editor/explorer read to scale with the requested entry, but today every request copies every file in the owner tree.
sources: [docs/backlog/vfs/reference/storage-journal-design-benchmarks-2026-08-31.md]
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

Dedup scan: no backlog title/code/goal-map match. `perf/fs-rpc-chunk-perf`
targets child RPC large-file chunking, not page editor/explorer reads.

## Challenge

challenge: 2026-08-31 — 1 problem
Impact/UX: 4,655× compares internal read work, not the whole editor/explorer action; no end-to-end latency share or workload prevalence shows the measured 46.5 ms materially affects target Node/WASI users or merits roadmap priority.
