---
area: runtime-js
status: draft
title: "`worker_threads.Worker` `argv`, `name`, `resourceLimits`, `transferList`, `trackUnmanagedFds` are dropped silently"
created: 2026-09-25
why: Node applies these `WorkerOptions` (extra `process.argv`, `threadName`, heap limits, transferred objects); rifty's `WorkerOptions` has no such fields, so a program passing them runs as if it had not — a silent Fidelity gap, not a named throw
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md, docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

REV-12 discovery of `runtime-js/worker-threads-stdio-streams-empty-exec-argv`
(vitest-run-in-browser item 11, evidence §Discoveries; Final+GREEN Goal drift
concern). Pre-existing; not on vitest 4.1.11's pool path.

rifty: `WorkerOptions` (`worker_threads.ts` `interface WorkerOptions`) reads
only `workerData`, `env`, `eval`, `execArgv`, `stdin`, `stdout`, `stderr`;
every other option is ignored without a throw (code reading).

Node v24.16.0 (land probe 2026-09-25, `node p.cjs`, worker posts
`{argv: process.argv.slice(2), threadName, resourceLimits}`):
`new Worker(w, { argv: ['a', 1], name: 'nm', resourceLimits: { maxOldGenerationSizeMb: 64 } })`
→ `{"argv":["a","1"],"threadName":"nm","resourceLimits":{"maxYoungGenerationSizeMb":192,"maxOldGenerationSizeMb":64,"codeRangeSizeMb":0,"stackSizeMb":4}}`;
default Worker → `argv []`, `threadName "WorkerThread"`. `transferList` /
`trackUnmanagedFds`: unprobed.

Compat: `modules.md` row `worker_threads.Worker` other options ❌.

## Next

Owner runtime-js. First step (no trigger needed, Fidelity): each unsupported
option a named `NotImplementedError('worker_threads.Worker.<option>')` before
thread-id allocation, or real support (`argv` is the cheap one: node-entry
program argv). Parity first: the probe above as a `worker_threads` case.
