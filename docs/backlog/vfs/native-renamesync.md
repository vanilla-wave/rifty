---
area: vfs
status: draft
title: Native renameSync on the sync VFS mirror (replace copyTree+rm)
created: 2026-06-08
why: FsSync has no renameSync; directory rename copies subtrees via copyTree+rmSync instead of moving in place
user_story: As a dev `renameSync`-ing a big directory (e.g. a `node_modules` subtree), I want a cheap in-place move, but today it deep-copies every file via copyTree then `rmSync` the old path
sources: [ADR-0075]
code: [apps/playground/src/glue/fs-ops.ts:73]
---
## Context
`FsSync` has no `renameSync`. Rename is honest (not a silent stub): files via read-bytes → write-new-path → `rmSync(old)`; directories via recursive `copyTree` + `rmSync(old,{recursive})`. It copies subtrees rather than moving in place. TODO(backlog: vfs/native-renamesync) marker at `copyTree` in `glue/fs-ops.ts:73`; `renamePath` is the caller.

## Options / Next
Provisional (shipped): copyTree+rm. Next: add a native `renameSync` to the `FsSync`/VFS surface (in-place move) and route `renamePath` to it. Parked — promote only if large-tree rename perf bites (gate: no measured perf need yet).

## Reversibility
copyTree+rm path REVERSIBLE. Adding `renameSync` to `FsSync` is a lower-layer cross-package API change → IRREVERSIBLE; needs its own ADR when the perf gate fires.
