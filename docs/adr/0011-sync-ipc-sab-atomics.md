# ADR 0011: Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model

Status: Implemented (2026-05-25) — all three phases (SAB ring + Worker-per-process + sync execSync via Atomics.wait)
Date: 2026-05

**Decision (2026-05-26):** A-008 (vendored `esbuild.wasm` + WASI bindings) defers to the **M11 toolchain push**. Required: vendored `esbuild.wasm` binary in the repo, WASI preopens for esbuild's tmpdir, and stdin/stdout wiring through the spawned-Worker stdio `MessagePort`s established in this ADR's phase 2. See "M11 follow-up — esbuild.wasm via WASI" below.

**Decision (2026-05-26) — A-023 (SW → Worker process registry):** Confirmed **M11**, sequenced **after A-026 (Vite-in-Worker)**. A-023 is blocked by the cross-realm port-registry bridge that the Vite-in-Worker migration introduces. Once Vite runs in its own Worker (A-026), the Service Worker rewires from "post to first window client" to "post to the worker that owns the process registered for this URL", reusing the same `MessagePort` registry. Dependency chain: phases 1-3 of this ADR (DONE) → A-026 Vite-in-Worker → A-023 SW-to-Worker.

**Decision (2026-05-27) — A-026 (Vite in Worker) — landed:** ADR-0043 ratified the migration. `apps/playground/src/glue/realVite.ts` now spawns a kernel Worker (`apps/playground/src/workers/real-vite-bootstrap.ts`); the cross-realm port-registry bridge ships as `@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview` (over `BroadcastChannel`, matching the HMR bridge's primitive); the HMR bridge moves into the worker realm. ADR-0025 is superseded for the Real Vite path; main-thread Dev Mode stays as the non-isolated fallback. A-023 (SW→Worker direct routing) remains the next consumer of the bridge primitive.

**Decision (2026-05-26) — A-026 (Vite in Worker):** Confirmed **M11**. Vite moves from the playground main-thread realm (per ADR-0025's provisional Option A) to a dedicated kernel-spawned Worker as soon as the cross-realm port-registry bridge in `@riftydev/net` is ready. Migration is local — replace `realVite.ts` with a worker-spawning adapter plus the registry bridge. ADR-0025 is then superseded for the Real Vite case; main-thread Dev Mode stays as the non-isolated fallback.

## Context

The architecture diagram in `PROJECT_PLAN.md` §2 assigns each Node "process" its own Worker realm, with synchronous Node APIs (`execSync`, `readFileSync` when called from a child, `worker_threads` host calls) bridged through `SharedArrayBuffer` + `Atomics.wait`/`notify`. The current implementation does none of this: `child_process` runs the child as `new Function(...)` inside the caller's realm, `worker_threads.Worker` is a thin polyfill, and `fork`/`execSync` either throw or fake completion.

REVIEW_ACTIONS items A-001 (sync IPC), A-002 (worker-as-process), A-008 (`esbuild.wasm` through WASI), A-021 (binary pipes), A-023 (SW → Worker registry), and A-026 (real Vite inside a Worker) all converge on the same missing primitive. Solving them piecewise produces incompatible mini-architectures.

## Decision

Adopt a single process model. Each Node-style "process" runs in its own Worker realm hosted by a generic kernel entry. Sync IPC uses a `SharedArrayBuffer` ring with `Atomics`-coordinated request/reply framing.

- New module `packages/kernel/src/worker-entry.ts` is the bootstrap loaded by every spawned Worker. It accepts a `WorkerSpawnSpec` over a `MessageChannel`: entry script, argv, env, stdio ports, and a SAB handle for the sync ring.
- `@riftydev/kernel.spawn(spec)` returns a `ProcessHandle` (PID, stdio `MessagePort`s, exit promise). `child_process.spawn`, `child_process.fork`, and `worker_threads.Worker` all funnel through `kernel.spawn`.
- Synchronous calls from inside a child Worker (`execSync`, `readFileSync` against memory-backed VFS, `worker_threads` host calls) write a request frame into the SAB ring, call `Atomics.wait` on the reply slot, and read the reply when the parent (or kernel) `Atomics.notify`s. The reply path bypasses the calling realm's microtask queue by design.
- Stdio is binary `Uint8Array` over `MessagePort`, transferable. Text decoding lives in the consumer.
- The current same-realm `new Function`-in-realm path stays as a fallback behind a capability gate (`crossOriginIsolated === false` or `RIFTY_FALLBACK_NO_SAB=1`). The fallback is marked deprecated in the module's TSDoc; it exists for non-isolated test environments only.

## Consequences

- A-021 (binary pipes), A-023 (SW → Worker process registry), and A-026 (Vite-in-Worker) unblock mechanically once `kernel.spawn` exists.
- Real `node:child_process.execSync` becomes possible — the main thread genuinely blocks via `Atomics.wait` for the duration of the child.
- WASI sync syscalls (`fd_read` on a preopen, used by `esbuild.wasm`) gain a real implementation path.
- Negative: multi-week implementation. The SAB ring protocol, error mapping, EPIPE/EOF semantics, and exit cleanup each need their own test suites.
- Negative: a non-isolated environment (Storybook, some test runners) cannot use the SAB path; the fallback must stay correct enough for unit-test cycles.
- Negative: the placeholder `child_process.ts` (`packages/runtime-js/src/builtins/child_process.ts`) becomes a compatibility shim, not the implementation. The shim's `stdin` already throws with a reference to this ADR.
- Follow-up: implementation lands in M11.

## Acceptance criteria for the deferred implementation

Phase 1 landed (2026-05-25):

- [x] `packages/kernel/src/ipc/sab-ring.ts` — SAB-backed single-in-flight
      request/reply ring with `Atomics.wait` (caller) / `Atomics.waitAsync`
      (test driver) / `Atomics.notify` (responder). Covered by 12 unit tests
      and a real-Worker conformance test.
- [x] `packages/kernel/src/worker-entry.ts` — kernel-side Worker bootstrap
      that accepts a `WorkerSpawnSpec`, installs a minimal `process` shim,
      publishes the `SabRing` on the realm's globalThis under a documented
      hook key, runs the entry, and posts an `exit` message.
- [x] `packages/kernel/src/ipc/capabilities.ts` — `isSabIpcSupported()` and
      `getIpcMode()` gating SAB vs. same-realm fallback (also reads the
      `RIFTY_FALLBACK_NO_SAB` env override).

Phase 2 landed (2026-05-25):

- [x] `kernel.spawnWorker(spec)` allocates a PID off the same counter as
      `kernel.spawn`, creates a `SabRing`, three stdio `MessageChannel`s,
      constructs `new Worker(kernelWorkerUrl, { type: 'module' })`, and posts
      the init message. Exit is observed via the worker's
      `{type:'exit', code}` and surfaced as `exit` + `close` on the
      `ProcessHandle`.
- [x] `setKernelWorkerUrl(url)` / `getKernelWorkerUrl()` allow the host
      (e.g. playground via Vite's `new URL('...', import.meta.url)`) to
      supply the bundled worker chunk URL; the kernel never hardcodes a
      path. Missing URL → loud `NotImplementedError('kernel.spawnWorker',
      …)`.
- [x] `child_process.spawn`, `child_process.fork`, and
      `worker_threads.Worker` all branch on
      `isSabIpcSupported() && getKernelWorkerUrl()` and route through
      `spawnWorker` when both hold; otherwise fall through to the
      in-realm path with a `// fallback per ADR-0011` comment.
- [x] Two conformance tests under
      `tests/conformance/builtins/child_process-worker.test.ts` exercise
      the worker-backed branch (skip in Node-without-isolation).

Phase 3 landed (2026-05-25):

- [x] `packages/kernel/src/ipc/sync-rpc.ts` — JSON-over-UTF-8 framing
      (`SyncRpcRequest` / `SyncRpcReply` + `encodeRequest` / `decodeReply`
      / `decodeRequest` / `encodeReply`). Binary frames remain a follow-up
      (A-021); phase 3 ships text frames only.
- [x] `packages/kernel/src/ipc/sync-dispatch.ts` — `SyncRpcDispatcher`:
      runs on the parent side, polls each attached `SabRing` at 1 ms
      intervals, dispatches to registered handlers, writes the reply
      (sync or after-thenable). Recursive-safe via a per-ring in-flight
      guard. Timer is `unref`'d so it never keeps Node alive on its own.
- [x] `packages/kernel/src/ipc/sync-client.ts` — `SyncRpcClient(ring)`:
      runs inside the spawned Worker. `call<T>(method, payload)` encodes
      the request, `Atomics.wait`s on the reply slot, decodes the JSON,
      and rethrows server-side errors with `name` / `message` / `code`
      preserved. Throws `NotImplementedError('SyncRpcClient', 'called from
      main realm — only valid inside a kernel-spawned Worker')` on
      non-Worker realms.
- [x] `packages/kernel/src/worker-entry.ts` — at boot, installs a
      non-enumerable global hook `__riftyKernelSyncCall(method, payload)`
      backed by a `SyncRpcClient` bound to this realm's ring. Re-exports
      the key as `KERNEL_SYNC_CALL_KEY` for higher-layer consumers.
- [x] `packages/kernel/src/spawn-worker.ts` — every `spawnKernelWorker`
      now constructs a `SyncRpcDispatcher`, registers the default
      `execSync` handler via `registerDefaultHandlers`, and attaches the
      ring. The handler recursively spawns a fresh kernel Worker for the
      child script and captures its stdout. PIDs of recursive children
      come from a dedicated counter (0xC0000000+) so they don't collide
      with the `ProcessManager`'s public PID space.
- [x] `packages/kernel/src/ipc/default-handlers.ts` +
      `packages/kernel/src/ipc/recursive-runner.ts` +
      `packages/kernel/src/ipc/script-resolver.ts` — clean separation
      between (a) the RPC handler logic, (b) the recursive Worker runner
      injected by `spawn-worker.ts`, and (c) the host-side
      `setExecSyncScriptResolver` setter the runtime-js layer uses to
      thread `syncMirror()` into the kernel without making the kernel
      depend on `@riftydev/vfs`.
- [x] `packages/runtime-js/src/builtins/child_process-sync.ts` —
      `execSync` branches on `isSabIpcSupported() && getKernelWorkerUrl()
      && globalThis[KERNEL_SYNC_CALL_KEY]`. When all three hold it routes
      through the global hook (truly blocking the calling Worker via
      `Atomics.wait`); otherwise falls back to the existing in-realm
      `new Function(...)` path with a `// fallback per ADR-0011` comment.
- [x] Conformance tests:
      - `tests/conformance/kernel/sync-rpc.test.ts` — JSON round-trip
        across a real Node `worker_threads.Worker` (echo handler + error
        path with `ERPCNOHANDLER`).
      - `tests/conformance/builtins/exec-sync-worker.test.ts` — skipped
        in plain-Node Vitest; documents the contract for the browser
        e2e harness (block + return stdout, propagate `ECHILDFAILED`).

Follow-ups (out of scope for phase 3, tracked separately):

- Binary stdio over `MessagePort` with backpressure (A-021).
- `fs.readFileSync` from a child Worker delegating to OPFS sync handle or
  SAB-tunneling into the parent's `MemoryVfs` (deferred pending
  `OpfsFsSync` availability from ADR-0013).
- E2E proof that `execSync` blocks only the child's runtime (≤ 100 ms
  overhead for a 10 ms child) — requires the playground's COOP/COEP
  wiring (A-016) plus the e2e harness backfill (A-029).

## M11 follow-up — `esbuild.wasm` via WASI

A-008 (esbuild as a real toolchain binary) lands in M11 on top of the
worker-as-process model from this ADR. Scope:

- Vendor `esbuild.wasm` under `tools/esbuild-wasm/` (pinned version checked
  into the repo, not fetched at runtime).
- WASI runner (`@riftydev/runtime-wasi`) gains preopens for esbuild's
  temporary directory (`/tmp` mapped into the shared backend from
  ADR-0014) so esbuild's intermediate write-then-read pattern works.
- stdin/stdout/stderr are wired through the spawned-Worker stdio
  `MessagePort`s established in phase 2 above. The `esbuild-shim` adapter
  in `apps/playground` swaps from passthrough to spawning a kernel Worker
  that boots the WASI runner with `esbuild.wasm` as the entry.
- Conformance: a parity test bundles a 2-file project and diff'ing the
  bundle output against the host-installed `esbuild` (skip when host
  esbuild is absent, like the existing `tools/node-parity-runner`
  toolchain checks).

This work is deliberately split from this ADR's three phases because the
WASI host program test is gated on the vendored binary and the shared
VFS backing tree from ADR-0014, neither of which exists at the time
phase 3 lands.
