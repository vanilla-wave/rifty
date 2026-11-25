---
area: runtime-js
status: draft
title: rifty's fs diverges from Node in rename, cpSync and copyFileSync codes and outcomes, with two silent successes
created: 2026-11-25
why: A seeded generator of fs call sequences (template probe G) finds rifty's `fs` — no template involved — giving other error codes than `node:fs`, and in two calls succeeding where Node throws: a silent difference a model's program can rely on.
sources: [docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/gen.mjs, docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/gen.out.txt, docs/backlog/runtime-js/fs-cp-type-mismatch-error-codes.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Found mid-task by the template goal's generator (`gen.mjs`, 2026-11-25, Node v24.16.0, macOS
arm64): random sequences of `mkdir`, write, `rm`, `rename`, `cpSync`, `copyFileSync`, `utimes`,
read, `readdir` and `stat` over a 6-file tree, run by rifty's flat `MemoryFsSync` (no template)
and by `node:fs` over a real directory; a 300-sequence sample through rifty's guest `fs` in a fresh
isolate against `node` running the same program (`gen.out.txt`: 110/300 equal with whole `stat` values; every other
difference is there without a template too).

Minimal calls (Node v24.16.0 verified 2026-11-25; rifty from `gen.out.txt` and the code):

- **Silent success** — `fs.renameSync('/missing', '/missing')`: rifty returns, Node throws
  `ENOENT`. Cause: `MemoryBackend.rename` returns early on `src === dst` before checking that
  `src` exists (`memory-backend.ts` `rename`, `if (s === d) return;`).
- **Silent success** — `fs.cpSync('/f.txt', '/f.txt')` (a file onto itself): rifty copies, Node
  throws `ERR_FS_CP_EINVAL`. (A directory copied into its own subtree is refused by rifty too, but
  with `EINVAL`, not Node's `ERR_FS_CP_EINVAL`.)
- `copyFileSync` of a directory: rifty `EISDIR`, Node `ENOTSUP` (`ENOENT` when the destination's
  parent is missing).
- `cpSync(..., { recursive: true })` type mismatches: rifty `EISDIR` / `EEXIST`, Node
  `ERR_FS_CP_NON_DIR_TO_DIR` / `ERR_FS_CP_DIR_TO_NON_DIR` (known:
  `runtime-js/fs-cp-type-mismatch-error-codes`).
- `renameSync` of a directory onto a non-directory or a missing parent: rifty `EINVAL`, Node
  `ENOTDIR` / `ENOENT`.
- Directory times: rifty bumps a directory's mtime when a file in it is overwritten
  (`MemoryBackend.writeFile`, `parentNode.mtime = Date.now()`); Node does not.
- Directory `nlink`: rifty counts subdirectories (as Linux); Node on macOS APFS counts every entry
  — platform-dependent, not a rifty defect on Linux.

Coupling with the template goal (`epics/isolate-host-sandbox-template`, ADR-0572 §2): its layered FS
must mark every path a `cpSync` writes; fixing the overwrite mtime bump above without that rule
would lose files silently (the template probe's `cp` mutant). The layered class marks them since
2026-11-25; its generator audits the marks independently of times.

Route: `rifty-fix` — the two silent successes first (failing parity case against live Node,
then the fix), the codes after. Owner: runtime-js (fs).

## Challenge

challenge: 2026-11-25 — none yet (mid-task finding capture, `rifty-to-backlog`)
