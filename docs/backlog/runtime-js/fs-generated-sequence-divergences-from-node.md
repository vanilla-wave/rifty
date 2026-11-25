---
area: runtime-js
status: draft
title: Generated fs call sequences diverge from Node in rename, cpSync, copyFileSync codes and outcomes, and directory times
created: 2026-11-25
why: A seeded generator of fs call sequences over a small tree (template probe G) finds rifty's `fs` — with no template involved — giving other error codes than `node:fs`, and in two shapes succeeding where Node refuses (`rename`, `cpSync`): a silent difference a model's program can rely on.
sources: [docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/gen.mjs, docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/gen.out.txt, docs/backlog/runtime-js/fs-cp-type-mismatch-error-codes.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Found mid-task by the template goal's generator (`gen.mjs`, 2026-11-25, Node v24.16.0, macOS
arm64): 3 000 random sequences of `mkdir`, write, `rm`, `rename`, `cpSync`, `copyFileSync`,
`utimes`, read and `readdir` over a 6-file tree, run by rifty's flat `MemoryFsSync` (no template)
and by `node:fs` over a real directory; a 60-sequence sample through rifty's guest `fs` in a fresh
isolate against `node` running the same program (`gen.out.txt`, section «guest sample»: 28/60 equal,
every other difference also present without a template). First differing call, guest `fs` vs Node:

- `copyFileSync` of a directory: rifty `EISDIR`, Node `ENOTSUP` (or `ENOENT` when the destination's
  parent is missing);
- `cpSync(..., { recursive: true })`: rifty `EINVAL` where Node gives `ERR_FS_CP_EINVAL`; `EISDIR`
  / `EEXIST` where Node gives `ERR_FS_CP_NON_DIR_TO_DIR` / `ERR_FS_CP_DIR_TO_NON_DIR` (known:
  `runtime-js/fs-cp-type-mismatch-error-codes`); **rifty succeeds where Node throws
  `ERR_FS_CP_EINVAL`** (a copy into its own subtree), and the `FsSync` level fails `ENOENT` where
  Node succeeds;
- `renameSync`: rifty `EINVAL` where Node gives `ENOTDIR` or `ENOENT`; **rifty succeeds where Node
  throws `ENOENT`**;
- trees equal in bytes but not in directory/file times (13 of 60).

Each needs its sequence minimized against Node and a parity case before a fix (the generator prints
seeds; minimizing per class is the pickup's first step). Owner: runtime-js (fs). Trigger: the next
fs fidelity pickup, or a model's program relying on one of the two silent successes.

## Challenge

challenge: 2026-11-25 — none yet (mid-task finding capture, `rifty-to-backlog`)
