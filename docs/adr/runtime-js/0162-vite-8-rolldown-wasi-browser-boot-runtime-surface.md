# ADR 0162: Vite 8 Rolldown WASI browser-boot runtime surface

Status: Accepted
Date: 2026-06-20

> TL;DR: runtime-js gains a `node:wasi` (backed by a new `@riftydev/runtime-wasi`
> dependency), `util.styleText`, and a real `worker_threads.Worker` kernel path
> for Rolldown's WASI pthread pool; an unconditional realm compat-shim is folded
> into `installNodeRuntime`'s Node-worker branch; runtime-wasi's side-effectful
> `worker-entry` is index-private.

## Context

Vite 8 pulls Rolldown's `@rolldown/binding-wasm32-wasi` — an emnapi WASI pthread
build — and runs it inside a rifty kernel-worker realm. Making it boot needs new
runtime-js surface and a few realm shims. These are genuine, recorded decisions
(new public API, a new cross-package dependency, a new realm-compat mechanism),
not behavior-preserving refactors — hence an ADR rather than CHANGELOG-only.

## Decision

1. **`node:wasi` backed by `@riftydev/runtime-wasi` (new dependency).** runtime-js
   adds a `workspace:*` dependency on `@riftydev/runtime-wasi` (same `runtime-*`
   layer — permitted by `arch-rules` `['runtime-js','runtime-wasi']`). The
   `node:wasi.WASI` builtin is a thin Node-facing wrapper over runtime-wasi's
   `Wasi` runner: it adds Node-contract validation (`options.version`,
   single-entry `ERR_WASI_ALREADY_STARTED`, required `WebAssembly.Memory`
   `ERR_INVALID_ARG_TYPE`) while the `Wasi` runner stays a lenient preview1
   runner (backs `runWasi`). gaps stay loud (`E_NOSYS`/throws), never stubbed.

2. **`util.styleText` + real `worker_threads.Worker` kernel path** join the public
   builtin surface. The kernel path spawns a real node-entry kernel worker per
   `Worker`, routes `parentPort`/`workerData` over fork-IPC, inherits the parent
   `cwd`, and rejects non-JSON-safe `workerData` loudly. `threadId`/`'online'`/
   `terminate()` follow Node; the kernel-path `'error'` event for a runtime
   uncaught throw is the one tracked gap
   (`backlog: runtime-js/worker-threads-kernel-error-event`).

3. **Worker-realm compat shims (`ipc/worker-realm-compat.ts`).** A Node-CJS bundle
   (emnapi) needs `global === globalThis`, a writable `self`, and a
   shared-memory-tolerant `TextDecoder.decode` (copies a SharedArrayBuffer-backed
   view into a private buffer first). These (`installWorkerRealmCompat`) are FOLDED
   into `installNodeRuntime`'s Node-worker branch (ADR-0157), alongside `Buffer` +
   the nextTick patch — so every Node worker realm (incl. Rolldown's emnapi pthread
   children) is shaped, and a WASI guest (raw WASI, not Node CJS) skips them. The
   TextDecoder patch is UNCONDITIONAL: the copy is a cheap no-op where the realm
   accepts shared views, whereas a feature-detect probe (a tiny shared decode) is
   not representative of emnapi's real decode — it false-negatives and skips the
   patch the guest needs (m7 RED). Considered and rejected.

4. **runtime-wasi `worker-entry` is index-private.** The side-effectful
   `worker-entry` (top-level guest run) and `runWasiInWorker` are NOT re-exported
   from `@riftydev/runtime-wasi`'s index; channel env keys moved to a
   side-effect-free `wasi-channel-env.ts`. So `node:wasi` (imports only `Wasi`)
   never drags the guest-run into a runtime-js worker graph. `worker-entry` is
   reachable only via the `@riftydev/runtime-wasi/worker-entry` subpath (the wasi
   worker bundle). Index env keys remain; only `runWasiInWorker` leaves the index.

5. **IPC inbound-delivery timing stays `setTimeout(0)`** (buffered worker frames
   flush after the entry body) — Node-aligned and working, with the robust
   "release after entry-module resolution" design tracked at
   `backlog: runtime-js/ipc-backlog-flush-entry-resolution` (a kernel post-entry
   hook = a future IRREVERSIBLE step).

## Consequences

- (+) Rolldown-in-browser boots: `m1` (baked-snapshot restore) and `m7-preview-sw`
  (cold install → Rolldown WASI bundle → SW-routed preview) are CI-green.
- (+) The realm shims are gated to Node workers (a WASI guest skips them) and the
  side-effectful WASI entry can no longer crash an unrelated worker on boot.
- (−) New public API (`node:wasi`, `util.styleText`, `worker_threads.Worker`
  kernel path) + a new cross-package dependency widen the supported surface and
  the compat contract rifty must keep faithful.
- (=) `@riftydev/runtime-wasi`'s index drops `runWasiInWorker` (a public-surface
  trim); subpath consumers are unaffected.
- Follow-ups: `backlog: runtime-js/worker-threads-kernel-error-event`,
  `backlog: runtime-js/ipc-backlog-flush-entry-resolution`,
  `backlog: playground/baked-snapshot-regeneration` (snapshot size). HMR on the
  Vite 8 path stays disabled (ADR-0161).
