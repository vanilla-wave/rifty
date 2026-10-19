---
area: runtime-js
status: draft
title: `worker_threads.receiveMessageOnPort` is absent — `typeof` is `undefined` instead of Node's function or a named loud gap
created: 2026-10-16
why: Node exports `receiveMessageOnPort(port)` (synchronous dequeue, the core of every Worker + `Atomics.wait` sync bridge: esbuild `*Sync`, synckit); rifty's `worker_threads` omits the export, so callers get `TypeError: … is not a function` rather than Node behavior or a named `NotImplementedError`
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/runtime-js/worker-threads-kernel-workerdata-structured-clone.md, docs/backlog/runtime-js/worker-threads-prompt-start-atomics-wait.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

Finding (2026-10-16, esbuild upstream-twin refine, evidence §Node-surface
gaps): `node -e "const w=require('worker_threads');console.log(typeof w.receiveMessageOnPort,typeof w.MessageChannel)"`
→ rifty `undefined` for `receiveMessageOnPort`; Node 24.16.0 `function`.
esbuild-wasm `lib/main.js:2237` calls it after `Atomics.wait` on every
`*Sync` call. Browsers have no synchronous MessagePort read, so real support
needs a sync-capable channel (with prompt Worker start and port transfer in
workerData — the two related items); the user kept real sync outside
`epics/esbuild-upstream-twin` («Только «громко, не hang»», 2026-10-16).

## Question

Ship `receiveMessageOnPort` with Node semantics over a sync-capable port
channel (COI only; mechanism sweep per `fault-classes.md` §Class-kill), or as
a named loud member until then? Owner runtime-js; trigger: a claimed program
using a sync Worker bridge.
