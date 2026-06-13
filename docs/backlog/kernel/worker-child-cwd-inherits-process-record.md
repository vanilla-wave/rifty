---
area: kernel
status: active
title: worker_threads child cwd hardcoded `/workspace` — does not inherit the parent ProcessRecord cwd
created: 2026-06-13
why: The worker_threads real-Worker branch hardcodes spec.cwd `/workspace` instead of inheriting the spawning process's cwd, so a guest's process.cwd() is wrong after a parent chdir and relative fs paths resolve from the wrong root.
sources: [ADR-0019, ADR-0011]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/process-manager.ts]
---

## Context

ADR-0019 makes cwd process-scoped state owned by the kernel ProcessRecord; children inherit a parent snapshot (process-manager.ts:184 `initialCwd = options.cwd ?? parentRecord?.cwd ?? DEFAULT_CWD`). `child_process.spawn`/`fork` honor this — child_process.ts:158 `get cwd() => this.handle.cwd`, spec built with `{ cwd: opts.cwd }`. But the worker_threads real-Worker branch (`startViaKernel`) hardcodes `spec.cwd = '/workspace'` (worker_threads.ts:70), so a Worker's `process.cwd()` is always `/workspace` regardless of the spawning realm's cwd. Node semantics: a Worker inherits the parent's `process.cwd()` at spawn time. Divergence: after `process.chdir('/foo')` then `new Worker(...)`, the guest sees `/workspace`, not `/foo`; relative `fs`/`require` paths resolve from the wrong root. Same `startViaKernel` branch also drops parentPort (see worker-threads-parentport-message-passing); overlaps the per-process cwd wiring in worker-per-process-residuals.

## Options or Next

Thread the spawning process's cwd into `SpawnWorkerSpec` (the parent ProcessRecord cwd snapshot) the way `child_process.spawn` already does, replacing the `/workspace` literal. Failing conformance first: `chdir` in the parent, spawn a Worker, assert `worker process.cwd() === parent cwd`. Pairs with worker-threads-parentport-message-passing (same branch) and worker-per-process-residuals (per-process cwd).

## Reversibility

REVERSIBLE — backlog item; pass an existing cwd snapshot into the spec, no public worker_threads API change.
