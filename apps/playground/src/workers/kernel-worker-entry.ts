// ADR-0011 phase 2 + ADR-0039 — entry module for `new Worker(url, { type: 'module' })`
// invocations dispatched by `globalProcessManager.spawnWorker(...)`.
//
// Two import side-effects, in this order:
//
//   1. `@rifty/runtime-js/install-process` registers `installNodeProcessShim`
//      as the kernel's pre-entry hook. Before ADR-0039 the kernel
//      installed a Node-shape `process` shim itself; the Node-API now
//      lives in runtime-js and must be wired BEFORE the kernel runs the
//      user entry.
//   2. `@rifty/kernel/worker-entry` installs the `'init'` listener that
//      consumes `WorkerInitMessage`, publishes the `KernelProcessSpec`,
//      calls the pre-entry hook (set by step 1), and runs the entry
//      script.
//
// Order matters: the kernel's `'init'` handler reads the pre-entry hook
// via the `setKernelPreEntryHook` getter on each spawn, so as long as the
// runtime-js installer ran at least once before the first `'init'` message
// arrives, the wiring is in place. Both imports are pure side-effects, so
// Vite preserves the order.
//
// We keep this as a separate, near-empty module so Vite can resolve it via
// `new URL('./kernel-worker-entry.ts', import.meta.url)` and bundle the
// dependencies into a worker chunk.
import '@rifty/runtime-js/install-process';
import '@rifty/kernel/worker-entry';
