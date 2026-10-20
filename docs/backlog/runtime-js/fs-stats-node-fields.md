---
area: runtime-js
status: draft
title: `fs.stat`/`lstat`/`fstat` return every numeric `fs.Stats` field Node returns
created: 2026-10-16
why: rifty's `Stats` carries `size` and `mtimeMs` only; `dev`, `ino`, `mode`, `nlink`, `uid`, `gid`, `rdev`, `blksize`, `blocks`, `atimeMs`, `ctimeMs` are `undefined`, and Go's wasm runtime panics reading them (`syscall/js: call of Value.Int on undefined`)
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/runtime-js/fs-stats-atime-observability.md]
code: [packages/runtime-js/src/builtins/fs-stats.ts]
---

## Context

Finding (2026-10-16, evidence §Node-surface gaps, layer f4/f5):
`fs.lstat/stat/fstat` → keys whose value is not a number:
rifty `dev,ino,mode,nlink,uid,gid,rdev,blksize,blocks,atimeMs,ctimeMs`
(file, dir, fd alike); Node 24.16.0 `ALL_NUMBERS`. Stock esbuild-wasm build
resolving a file → `✘ [ERROR] panic: syscall/js: call of Value.Int on undefined`
at `syscall.setStat (syscall/fs_js.go:184) syscall.Lstat`; with numeric fields
the bundle equals Node's.

`Stats` (`fs-stats.ts:9-17`) is the one shape every stat surface returns.
Related, not duplicate: `runtime-js/fs-stats-atime-observability` (atime
VALUE fidelity across VFS boundaries); this item is field presence/type and
the values Node programs read (`mode` type bits, stable `ino`).

## Question

Which values does parity pin where the VFS has no POSIX source — `mode` type
and permission bits, `ino` stability per path, `nlink`, `uid/gid`, `dev`,
`blksize/blocks`, `ctimeMs/birthtimeMs`, `*time` Date twins and
`bigint: true` — and which are Node-observable versus platform-varying (Node
values differ by host)? Settled at PICKUP; atime value semantics stay with the
related item.

## Pickup evidence

- 2026-10-20 — PR #380 imports the shared ADR-0540 metadata fix from upstream-twin 9e639e9c after no-COI Vite baseline RED. `fs/stats-node-fields` parity GREEN; atime-value semantics remain separate. Coordinate final closure with upstream-twin.
- 2026-10-20 — Final+GREEN advisory: numeric shape/identity/birth are proven; rename does not yet update entry/parent ctime in MemoryBackend/OpfsSync. Owner: upstream-twin Stats closure; next probe: real Node rename ctime transition on file + both parent dirs, then shared-backend repair. Not claimed as full timestamp-value parity by no-COI children.
