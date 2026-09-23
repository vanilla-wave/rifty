---
area: runtime-js
status: draft
title: `worker_threads.Worker` exposes `stdout`/`stderr` Readables and accepts an explicit empty `execArgv`
created: 2026-09-15
why: vitest's threads pool does `new Worker(entry, { env, execArgv: [], stdout: true, stderr: true })` then `thread.stdout.pipe(...)`; rifty throws `worker_threads.Worker.execArgv` for any own `execArgv` (even `[]`) and its Worker has no stdout/stderr streams (it only emits 'stdout'/'stderr' events)
epic: vitest-run-in-browser
blocked_by: [runtime-js/worker-threads-handle-keepalive, runtime-js/child-process-advanced-ipc-serialization]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/worker-threads-inherited-exec-argv.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

Oracle (Node v24.16.0, evidence §Oracle): `new Worker(src, { eval: true,
execArgv: [], stdout: true, stderr: true })` → `typeof w.stdout === 'object'`,
`typeof w.stdout.pipe === 'function'`, the worker's `console.log` is captured
from the stream (`"from-worker\n"`) and not printed by the parent;
`execArgv: []` is accepted. `worker-threads-inherited-exec-argv` owns nonempty
inheritance identity; this item owns the explicit-empty case and the stream
surface. Depends on `worker-threads-handle-keepalive` for the parent to
survive until the worker reports. `new Worker` from `node -e` (eval launch
inherits a nonempty execArgv) stays with the inherited-exec-argv item.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 both pools chosen)
