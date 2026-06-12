import { installWorkerEntry, setKernelPreEntryHook } from '@riftydev/kernel/worker-entry';
import type { WorkerSpawnSpec } from '@riftydev/kernel/worker-entry';
// ADR-0011 phase 2 + ADR-0039 — entry module for `new Worker(url, { type: 'module' })`
// invocations dispatched by `globalProcessManager.spawnWorker(...)`.
//
// Two setup steps, in this order:
//
//   1. Register runtime-js's `installNodeProcessShim` as the kernel pre-entry
//      hook. Before ADR-0039 the kernel installed a Node-shape `process` shim
//      itself; the Node-API now lives in runtime-js and must be wired BEFORE
//      the kernel runs the user entry.
//   2. Install the kernel `'init'` listener that consumes `WorkerInitMessage`,
//      publishes the `KernelProcessSpec`, calls the pre-entry hook, and runs the
//      entry script.
//
// Order matters, and Vite/Rollup can erase pure side-effect imports when a
// package marks itself side-effect-free. Use explicit bindings and calls so the
// emitted worker chunk cannot collapse to an empty module.
//
// We keep this as a separate, near-empty module so Vite can resolve it via
// `new URL('./kernel-worker-entry.ts', import.meta.url)` and bundle the
// dependencies into a worker chunk.
import { installNodeProcessShim } from '@riftydev/runtime-js/install-process';

setKernelPreEntryHook((spec: WorkerSpawnSpec) => {
  installNodeProcessShim({
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: spec.stdio,
  });
});

installWorkerEntry();
