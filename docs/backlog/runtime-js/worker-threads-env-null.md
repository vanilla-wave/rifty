---
area: runtime-js
status: draft
title: "`new Worker(file, { env: null })` runs as in Node, and a throwing constructor leaves no stdio pipe on the parent"
created: 2026-09-25
why: Node accepts `env: null` (the worker gets an env object); rifty's kernel-backed constructor throws `TypeError` from `Object.entries(null)` after it already piped the Worker's streams into the parent's `process.stdout`/`stderr`, leaving listeners for a Worker that never existed
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json, docs/adr/runtime-js/0449-carry-node-startup-options-and-worker-stdio-streams.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/worker_threads-stdio.ts]
---

## Context

REV-12 discovery of `runtime-js/worker-threads-stdio-streams-empty-exec-argv`
(vitest-run-in-browser item 11; Final+GREEN Bugs concern). Not on vitest's path.

- `env: null` (pre-existing): rifty `snapshotWorkerEnvironment(opts.env)`
  → `TypeError: Cannot convert undefined or null to object`. Node v24.16.0
  (land probe 2026-09-25, `node p.cjs`): `new Worker(w, { env: null })` runs,
  `typeof process.env` `"object"`, exit 0. Which env Node gives (shared parent
  env vs copy) — unprobed.
- Torn state (item 11 ordering): the constructor builds `WorkerStdio` (auto-pipe
  into `publicNodeProcess()` streams) before the env snapshot. Reviewer's
  kernel-capable scratch probe: after the `env: null` throw, parent
  `process.stdout` listener counts `[unpipe, close, finish, error]` go
  `[0,0,0,0]` → `[0,1,0,1]` (stderr same path). Any later synchronous throw
  leaks the same way.

## Next

Owner runtime-js. Fault row first: a constructor throw after option
validation leaves the parent's stdout/stderr listener counts unchanged
(fix: build `WorkerStdio` after every synchronous validation, beside the
thread id and holds). Parity: `env: null` as a `worker_threads` case, probing
Node's env identity first.
