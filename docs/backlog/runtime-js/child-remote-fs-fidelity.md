---
area: runtime-js
status: done
title: Child remote-FS fidelity — SyncRpcFsSync hand-rolled ENOENT shape + async fs.stat leaves statSync untested
created: 2026-06-16
resolved: 2026-06-18
why: the P6a child remote VFS drifts from real-backend behavior in two spots — (1) SyncRpcFsSync.readFileBytesSync throws a hand-rolled Error{code:'ENOENT'} instead of the VfsError every other backend throws (observable-behavior drift vs Node + the rest of the VFS; AGENTS.md §Fidelity — parity = gold standard); (2) the fs.stat owner handler is gratuitously async while statSync is sync, so over the synchronous loopback test statSync (the method a child node:fs.statSync actually calls) is the one remote method never exercised
user_story: As a dev whose child CLI does fs.readFileSync on a missing path or fs.statSync, I want the error name/shape to match real Node and the rest of rifty (not a divergent hand-rolled Error), and I want statSync over the RPC ring covered by a round-trip test.
sources: [ADR-0150]
code: [packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/runtime-js/src/ipc/fs-handlers.ts]
---

## Context

Re-derived at HEAD `805aa45f` (D-acceptance standards pass):

- **Hand-rolled ENOENT (`sync-rpc-fs.ts:36-39`).** `readFileBytesSync` on a miss/not-a-file does `Object.assign(new Error('ENOENT: '+path), {code:'ENOENT', path})` — instead of routing the miss through the owner (so `sync-dispatch.errorToShape` preserves name/errno/syscall/path) or constructing the same `VfsError('ENOENT')` the real `MemoryFsSync`/`OpfsFsSync` backends throw. Result: the error a child `node:fs.readFileSync` surfaces differs in shape/name from every other realm — observable-behavior drift.
- **Gratuitous async `fs.stat` (`fs-handlers.ts:42-45`).** `fs.stat` is registered `async (p) => getVfs().statSync(...)` while `statSync` is sync and every sibling handler is sync. Over the real `SyncRpcDispatcher` the thenable is unwrapped, so production works — but the synchronous loopback unit (`sync-rpc-fs.test.ts`) can't cover it, so `statSync` (the method `builtins/fs.ts` `statSync` actually invokes in a child) is the ONE remote method never round-tripped by a test.

## Options or Next

- Delegate the read miss to the owner (let the real backend throw, shape preserved over the ring) OR construct the same `VfsError('ENOENT')` the backends use.
- Make `fs.stat` sync like its siblings, then extend the loopback test to round-trip `statSync`.

## Reversibility

REVERSIBLE — error-shape alignment + handler made sync + a test; no wire-format change.

## Resolved (2026-06-18)

Both gaps closed in branch `p6b-dev-server-child`:
- `sync-rpc-fs.ts`: `VfsError('ENOENT', path)` replaces hand-rolled `Error{code:'ENOENT'}`.
- `fs-handlers.ts`: `fs.stat` handler made sync; `// TODO` removed.
- `sync-rpc-fs.test.ts`: `statSync` round-trip + ENOENT-shape parity tests added (RED → GREEN).
