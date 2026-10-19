---
area: runtime-js
status: ready
title: Run no-COI Node children against the live owner filesystem
created: 2026-10-20
why: Upstream esbuild and installed helpers cannot execute in the same-realm fallback
user_story: As a no-COI SDK developer, I want Node helpers with their own loader and shared project files
epic: no-coi-child-processes
blocked_by: []
sources: []
code: []
---

## Context

Native Chromium spike proves sync XHR → SW → Window → owner without SAB.
Use existing FsSync RPC semantics and Node runtime; async private-port stdio.

## Challenge

challenge: 2026-10-20 — inherited goal premise; user accepted SW prerequisite.

## Acceptance

1. The same raw upstream esbuild-wasm transform program runs in Node and the no-COI SDK with equal output; no installed-byte patch. → I1
2. A shebang helper requires node_modules, has isolated globals/builtins, receives async stdin and writes stdout; parent→child and child→parent filesystem changes are live. → I2
3. No SW: child spawn throws a named gap; file operations and ordinary commands still run. → I4

## Reference contract

- Node v24.16.0, same fixture source and upstream esbuild-wasm 0.28.0 archive; `tests/no-coi/no-coi-child-processes.spec.ts` executes the oracle on every run.
- Existing `SyncRpcFsSync`/owner handlers own FS semantics; no VFS snapshot.

## Parity cases

1. `parent.cjs`: close status, dependency, env, globals/builtins, bytes on stdin/stdout, live FS updates equal the real Node execution. → I2
2. `esbuild.cjs`: upstream transform yields `let x = 1;` and exits successfully. → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| peer death during child run | terminal error/exit, released resources; no successful missing output | real Worker termination browser test | → I2 |
| service worker unavailable during spawn | named transport error, no same-realm fallback | no-SW browser test | → I4 |
| owner FS error | preserved Node/VFS error, no stale copy | missing file in child | → I2 |

## Out of scope

COI transport, worker_threads.Worker and synchronous child_process APIs retain
existing capabilities/declared gaps. No autonomous FS progress while the owner
executes uninterrupted synchronous guest JS.

## Decisions

- ready-verdict: 2026-10-20 — Contract+RED @ 537dfbafd8914face8e7ac2f98634125de01d857

- 2026-10-20 — scope and SW prerequisite inherited from the goal; one PR.
