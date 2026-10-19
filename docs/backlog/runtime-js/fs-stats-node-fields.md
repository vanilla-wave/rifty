---
area: runtime-js
status: ready
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

## Challenge

challenge: 2026-10-20 — clear; observed defects, goal premise unchanged.

## Acceptance

1. stat/lstat/fstat expose all numeric fields and Date views; overwrite/rename retain identity and birthtime; directory links reflect subdirectories. → I3

## Reference contract

Node v24.16.0; `tests/browser-unit/esbuild-node-surfaces.spec.ts` runs the
same supported scenario against Node and Chromium. Named unsupported Sync
results follow goal I2, not Node's success output.

## Out of scope

Other goal units remain linked on the map; no goal closure from this repair.

## Decisions

- 2026-10-20 — RDY-8 observed-defect route: real baseline + executed RED
  before implementation; independent Final+GREEN pending. Carrier: numeric Stats fields.
