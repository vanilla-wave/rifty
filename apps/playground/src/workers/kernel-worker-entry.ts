// ADR-0011 phase 2 — entry module for `new Worker(url, { type: 'module' })`
// invocations dispatched by `globalProcessManager.spawnWorker(...)`.
//
// All this file does is import the kernel-side bootstrap; the import side
// effect (auto-detection of the Worker realm) installs the `'init'` listener
// that consumes `WorkerInitMessage` and runs the entry script.
//
// We keep this as a separate, near-empty module so Vite can resolve it via
// `new URL('./kernel-worker-entry.ts', import.meta.url)` and bundle the
// kernel-side dependencies into a worker chunk.
import '@rifty/kernel/worker-entry';
