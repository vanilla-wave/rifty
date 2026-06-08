# ADR 0011: Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model

Status: Implemented (2026-05-25) — all three phases (SAB ring + Worker-per-process + sync execSync via Atomics.wait)
Date: 2026-05

**Decisions log:**

- **A-008 (2026-05-26):** vendored `esbuild.wasm` + WASI bindings defers to the **M11 toolchain push**. Needs vendored `esbuild.wasm` in-repo, WASI preopens for esbuild's tmpdir, stdin/stdout via the phase-2 stdio `MessagePort`s. See "M11 follow-up" below.
- **A-023 (2026-05-26) — SW → Worker process registry:** confirmed **M11**, sequenced **after A-026**. Blocked by the cross-realm port-registry bridge A-026 introduces; once Vite runs in its own Worker, the SW rewires from "post to first window client" to "post to the worker owning the process for this URL", reusing the same `MessagePort` registry. Chain: phases 1-3 (DONE) → A-026 → A-023.
- **A-026 (2026-05-26) — Vite in Worker:** confirmed **M11**. Vite moves from the playground main-thread realm (ADR-0025 Option A) to a kernel-spawned Worker once the `@riftydev/net` cross-realm bridge is ready. Local migration: replace `realVite.ts` with a worker-spawning adapter + registry bridge.
- **A-026 (2026-05-27) — landed:** ADR-0043 ratified the migration. `apps/playground/src/glue/realVite.ts` spawns a kernel Worker (`apps/playground/src/workers/real-vite-bootstrap.ts`); cross-realm bridge ships as `@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview` (over `BroadcastChannel`, like the HMR bridge); HMR bridge moves into the worker realm. **ADR-0025 superseded for the Real Vite path**; main-thread Dev Mode stays as non-isolated fallback. A-023 is the next consumer of the bridge primitive.

> TL;DR: Each Node process is its own kernel-spawned Worker realm; sync IPC (`execSync`) rides a `SharedArrayBuffer` ring framed by `Atomics.wait`/`notify`

## Context

`PROJECT_PLAN.md` §2 assigns each Node "process" its own Worker realm, with sync Node APIs (`execSync`, child-side `readFileSync`, `worker_threads` host calls) bridged via `SharedArrayBuffer` + `Atomics.wait`/`notify`. Current impl does none of this: `child_process` runs the child as `new Function(...)` in the caller's realm, `worker_threads.Worker` is a thin polyfill, `fork`/`execSync` throw or fake completion.

REVIEW_ACTIONS A-001 (sync IPC), A-002 (worker-as-process), A-008 (`esbuild.wasm` via WASI), A-021 (binary pipes), A-023 (SW→Worker registry), A-026 (real Vite in Worker) all converge on this one missing primitive; solving them piecewise yields incompatible mini-architectures.

## Decision

One process model: each Node-style process runs in its own Worker realm hosted by a generic kernel entry. Sync IPC uses a `SharedArrayBuffer` ring with `Atomics`-coordinated request/reply framing.

- `packages/kernel/src/worker-entry.ts` — bootstrap loaded by every spawned Worker. Accepts a `WorkerSpawnSpec` over a `MessageChannel`: entry script, argv, env, stdio ports, SAB handle.
- `@riftydev/kernel.spawn(spec)` returns a `ProcessHandle` (PID, stdio `MessagePort`s, exit promise). `child_process.spawn`/`.fork` and `worker_threads.Worker` all funnel through it.
- Sync calls from inside a child Worker write a request frame into the SAB ring, `Atomics.wait` on the reply slot, read on the parent/kernel `Atomics.notify`. Reply path bypasses the calling realm's microtask queue by design.
- Stdio is binary `Uint8Array` over `MessagePort`, transferable; text decoding lives in the consumer.
- Same-realm `new Function`-in-realm path stays as a fallback behind a capability gate (`crossOriginIsolated === false` or `RIFTY_FALLBACK_NO_SAB=1`), marked deprecated in TSDoc — for non-isolated test environments only.

## Consequences

- A-021, A-023, A-026 unblock mechanically once `kernel.spawn` exists.
- Real `node:child_process.execSync` becomes possible — main thread genuinely blocks via `Atomics.wait` for the child's duration.
- WASI sync syscalls (`fd_read` on a preopen, used by `esbuild.wasm`) gain a real impl path.
- Negative: multi-week impl. SAB ring protocol, error mapping, EPIPE/EOF semantics, exit cleanup each need their own test suites.
- Negative: non-isolated environments (Storybook, some test runners) can't use SAB; the fallback must stay correct enough for unit-test cycles.
- Negative: placeholder `packages/runtime-js/src/builtins/child_process.ts` becomes a compat shim, not the impl. Its `stdin` already throws referencing this ADR.
- Follow-up: implementation lands in M11.

## Acceptance criteria for the deferred implementation

**Phase 1 (landed 2026-05-25):**

- [x] `packages/kernel/src/ipc/sab-ring.ts` — SAB-backed single-in-flight request/reply ring: `Atomics.wait` (caller) / `Atomics.waitAsync` (test driver) / `Atomics.notify` (responder). 12 unit tests + real-Worker conformance test.
- [x] `packages/kernel/src/worker-entry.ts` — kernel-side bootstrap: accepts `WorkerSpawnSpec`, installs minimal `process` shim, publishes `SabRing` on globalThis under a documented hook key, runs entry, posts `exit`.
- [x] `packages/kernel/src/ipc/capabilities.ts` — `isSabIpcSupported()` / `getIpcMode()` gating SAB vs same-realm fallback (reads `RIFTY_FALLBACK_NO_SAB`).

**Phase 2 (landed 2026-05-25):**

- [x] `kernel.spawnWorker(spec)` allocates a PID off the same counter as `kernel.spawn`, creates a `SabRing` + three stdio `MessageChannel`s, constructs `new Worker(kernelWorkerUrl, { type: 'module' })`, posts init. Exit observed via worker `{type:'exit', code}` → `exit` + `close` on `ProcessHandle`.
- [x] `setKernelWorkerUrl(url)` / `getKernelWorkerUrl()` let the host (e.g. playground via `new URL('...', import.meta.url)`) supply the bundled worker chunk URL; kernel never hardcodes a path. Missing URL → loud `NotImplementedError('kernel.spawnWorker', …)`.
- [x] `child_process.spawn`/`.fork` and `worker_threads.Worker` branch on `isSabIpcSupported() && getKernelWorkerUrl()` → route through `spawnWorker`; else in-realm path with `// fallback per ADR-0011`.
- [x] Two conformance tests in `tests/conformance/builtins/child_process-worker.test.ts` exercise the worker branch (skip in Node-without-isolation).

**Phase 3 (landed 2026-05-25):**

- [x] `packages/kernel/src/ipc/sync-rpc.ts` — JSON-over-UTF-8 framing (`SyncRpcRequest`/`SyncRpcReply` + `encodeRequest`/`decodeReply`/`decodeRequest`/`encodeReply`). Binary frames are a follow-up (A-021); phase 3 ships text only.
- [x] `packages/kernel/src/ipc/sync-dispatch.ts` — `SyncRpcDispatcher`: parent-side, polls each attached `SabRing` at 1 ms, dispatches to handlers, writes reply (sync or after-thenable). Recursive-safe via per-ring in-flight guard. Timer `unref`'d so it never keeps Node alive alone.
- [x] `packages/kernel/src/ipc/sync-client.ts` — `SyncRpcClient(ring)`: runs inside spawned Worker. `call<T>(method, payload)` encodes request, `Atomics.wait`s on reply, decodes JSON, rethrows server errors with `name`/`message`/`code` preserved. Throws `NotImplementedError('SyncRpcClient', 'called from main realm — only valid inside a kernel-spawned Worker')` on non-Worker realms.
- [x] `packages/kernel/src/worker-entry.ts` — at boot installs non-enumerable global hook `__riftyKernelSyncCall(method, payload)` backed by a `SyncRpcClient` bound to this realm's ring. Re-exports key as `KERNEL_SYNC_CALL_KEY`.
- [x] `packages/kernel/src/spawn-worker.ts` — every `spawnKernelWorker` constructs a `SyncRpcDispatcher`, registers the default `execSync` handler via `registerDefaultHandlers`, attaches the ring. Handler recursively spawns a fresh kernel Worker for the child script and captures stdout. Recursive-child PIDs come from a dedicated counter (0xC0000000+) to avoid colliding with `ProcessManager`'s public PID space.
- [x] `packages/kernel/src/ipc/default-handlers.ts` + `recursive-runner.ts` + `script-resolver.ts` — separation between (a) RPC handler logic, (b) recursive Worker runner injected by `spawn-worker.ts`, (c) host-side `setExecSyncScriptResolver` the runtime-js layer uses to thread `syncMirror()` into the kernel without making the kernel depend on `@riftydev/vfs`.
- [x] `packages/runtime-js/src/builtins/child_process-sync.ts` — `execSync` branches on `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]`; when all hold, routes through the global hook (truly blocking via `Atomics.wait`); else in-realm `new Function(...)` with `// fallback per ADR-0011`.
- [x] Conformance tests:
      - `tests/conformance/kernel/sync-rpc.test.ts` — JSON round-trip across a real Node `worker_threads.Worker` (echo + error path `ERPCNOHANDLER`).
      - `tests/conformance/builtins/exec-sync-worker.test.ts` — skipped in plain-Node Vitest; documents the contract for the browser e2e harness (block + return stdout, propagate `ECHILDFAILED`).

**Follow-ups (out of scope for phase 3, tracked separately):**

- Binary stdio over `MessagePort` with backpressure (A-021).
- `fs.readFileSync` from a child Worker → OPFS sync handle or SAB-tunnel into the parent's `MemoryVfs` (deferred pending `OpfsFsSync` from ADR-0013).
- E2E proof that `execSync` blocks only the child's runtime (≤ 100 ms overhead for a 10 ms child) — requires playground COOP/COEP wiring (A-016) + e2e harness backfill (A-029).

## M11 follow-up — `esbuild.wasm` via WASI

A-008 (esbuild as a real toolchain binary) lands in M11 on the worker-as-process model. Scope:

- Vendor `esbuild.wasm` under `tools/esbuild-wasm/` (pinned, checked in, not fetched at runtime).
- `@riftydev/runtime-wasi` gains preopens for esbuild's tmpdir (`/tmp` mapped into the ADR-0014 shared backend) so esbuild's write-then-read pattern works.
- stdin/stdout/stderr wired through the phase-2 stdio `MessagePort`s. The `esbuild-shim` adapter in `apps/playground` swaps from passthrough to spawning a kernel Worker booting the WASI runner with `esbuild.wasm` as entry.
- Conformance: parity test bundling a 2-file project, diffing output against host-installed `esbuild` (skip when host esbuild absent, like the `tools/node-parity-runner` toolchain checks).

Split from the three phases because the WASI host-program test is gated on the vendored binary and the ADR-0014 shared VFS backing tree, neither of which exists when phase 3 lands.
