import { installWorkerEntry, setKernelPreEntryHook } from '@riftydev/kernel/worker-entry';
// ADR-0011 phase 2 + ADR-0039 — entry module for `new Worker(url, { type: 'module' })`
// invocations dispatched by `globalProcessManager.spawnWorker(...)`.
//
// Two setup steps, in this order:
//
//   1. Register runtime-js's `installNodeRuntime` as the kernel pre-entry hook.
//      Before ADR-0039 the kernel installed a Node-shape `process` shim itself;
//      the Node-API now lives in runtime-js and must be wired BEFORE the kernel
//      runs the user entry. Per ADR-0157 `installNodeRuntime` installs ONE
//      spec-seeded mutable `process` AND, gated to Node workers (`isNode = no
//      __RIFTY_WASI_WASM_URL`), the rich extras (`Buffer` + nextTick-ordering
//      Promise patch) — so every Node child gets a faithful process by
//      construction, no later swap. It returns only the runtime-selected async
//      readiness the kernel must await before guest entry (ADR-0351).
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
//
// `installTimerGlobals()` + `installEventLoopKeepalive()` + `installFetchKeepalive()`
// run at module top-level (universal — every kernel worker gets timers + the
// drain/unhandledrejection trap + the fetch keepalive, regardless of Node-vs-WASI),
// NOT inside the pre-entry hook.
import { installEventLoopKeepalive, installFetchKeepalive } from '@riftydev/runtime-js';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { installNodeRuntime } from '@riftydev/runtime-js/install-process';

setKernelPreEntryHook(installNodeRuntime);

installTimerGlobals();
installEventLoopKeepalive();
installFetchKeepalive();
installWorkerEntry();
