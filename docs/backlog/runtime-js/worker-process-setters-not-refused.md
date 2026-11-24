---
area: runtime-js
status: draft
title: process.umask(mask) and process.chdir() in a worker_threads Worker do not throw ERR_WORKER_UNSUPPORTED_OPERATION as Node does
created: 2026-11-24
why: Node refuses process-wide setters inside a Worker; rifty's Worker runs them like the main thread, so a program that probes the refusal (or relies on it) sees other behavior.
sources: [docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process-umask.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

PR #432 review (N1), measured 2026-11-24. Worker body: `process.umask(a)` for
`a` in `[undefined, 0, 0o22, 'x', null]`, then `process.chdir('/')`.

- Node v24.16.0 (`node`, eval Worker): `umask()` → 18; every other call → `TypeError
  ERR_WORKER_UNSUPPORTED_OPERATION Setting process.umask() is not supported in workers` (before
  argument validation); `chdir` → `ERR_WORKER_UNSUPPORTED_OPERATION process.chdir() is not
  supported in workers`.
- rifty, physical Worker (scratch parity-runner `worker-env` case, `expectedPhysicalWorkers: 1`):
  `umask(0)` → 0, `umask(0o22)` → `NotImplementedError`, `'x'`/`null` → the argument errors,
  `chdir('/')` → ok.

Compat process.md row "inside a `worker_threads` Worker" ⚠️. Node's refusal list in Workers is
wider (`setuid` family, …); only these two measured. Owner: runtime-js (process shim, worker
bootstrap). Trigger: a package that calls these in a Worker or checks the refusal.

## Challenge

challenge: 2026-11-24 — none (factual capture)
