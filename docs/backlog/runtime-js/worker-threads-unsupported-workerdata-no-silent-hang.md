---
area: runtime-js
status: draft
title: esbuild-wasm's `*Sync` routes end in a named NotImplementedError — a parent blocking in `Atomics.wait` after `new Worker(...)` with MessagePort-bearing workerData, and the `execFileSync` route — never a hang or TypeError
created: 2026-10-16
why: rifty reports the unsupported workerData only as an async `'error'` event; esbuild-wasm's `*Sync` path builds that Worker and immediately blocks in `Atomics.wait`, so `transformSync` hangs forever under COI; with `ESBUILD_WORKER_THREADS=0` it calls `child_process.execFileSync`, which rifty does not export (TypeError)
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/runtime-js/worker-threads-kernel-workerdata-structured-clone.md, docs/backlog/runtime-js/worker-threads-prompt-start-atomics-wait.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

Finding (2026-10-16, evidence §Stock entry step e, §Node-surface gaps):

- `node -e "try{console.log(require('esbuild-wasm').transformSync('let x=1').code)}catch(e){console.log('SYNCERR',e&&e.message)}"`
  → COI rifty: no output for 90 s, `^C` only; no-COI rifty:
  `SYNCERR Not implemented: worker_threads.Worker (no-COI toolchain Workers …)`
  (loud); Node 24.16.0: `let x = 1;`.
- `new Worker(require.resolve('esbuild-wasm'),{workerData:{workerPort:port2,…},transferList:[port2]})`
  → async `WERR Not implemented: worker_threads.workerData.structuredClone
  (kernel-backed Worker workerData currently supports only JSON-safe plain data)`.

esbuild-wasm@0.28.0 `lib/main.js:2194-2240` posts to the Worker then `Atomics.wait`s;
the refusal surfaces as an event the blocked thread never reaches. Today's
generated client throws `NotImplementedError` (`gate-sync-family`); the stock
entry must keep that loud outcome (goal I2). Supporting the transfer is
`runtime-js/worker-threads-kernel-workerdata-structured-clone`; prompt start
is `runtime-js/worker-threads-prompt-start-atomics-wait` — both out of this
goal.

Second route: esbuild-wasm `lib/main.js:1889` skips worker_threads when
`ESBUILD_WORKER_THREADS=0` and `*Sync` then calls
`child_process.execFileSync` (`:2177`); rifty's `child_process` exports no
`execFileSync` (`child_process.ts:708-716`; `spawnSync` is a named loud member,
`loud-members.ts:14-16`) — a `TypeError`, not a named gap (premise critic,
2026-10-16, code reading). Already listed absent in
`runtime-js/node-builtins-loud-stub-capability-gaps`; ADR-0443's
named-loud-member rule governs the loud form.

## Question

Node validates `transferList` and workerData cloneability synchronously in
the constructor (`DataCloneError` for uncloneables) — does throwing the
existing `NotImplementedError('worker_threads.workerData.structuredClone')`
synchronously from the constructor match the error timing Node gives for
cloneable-but-unsupported data, and what does esbuild surface to the
`transformSync` caller then (its `startWorkerThreadService` is called inside
`transformSync`)? Is `execFileSync` a named loud member like `spawnSync`, or
does it run over the existing `execSync` SAB path? Settled at PICKUP by Node
+ rifty probes.
