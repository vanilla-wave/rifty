# Changelog

## [Unreleased]

### Added

- Package skeleton. Implementation deferred to M6 (Processes).
- ADR-0011 phase 1: `ipc/sab-ring.ts` (`createSabRing`, `SabRing`,
  `RingTimeoutError`, `RingPayloadTooLargeError`, header layout
  constants) — SharedArrayBuffer + Atomics single-in-flight
  request/reply transport for sync IPC.
- ADR-0011 phase 1: `ipc/capabilities.ts` (`isSabIpcSupported`,
  `getIpcMode`) — capability gate for SAB vs. same-realm fallback.
- ADR-0011 phase 1: `worker-entry.ts` — kernel-side Worker bootstrap
  loaded by `kernel.spawn` (wired by phase 2). Exports
  `WorkerSpawnSpec`, `WorkerInitMessage`, `WorkerExitMessage`,
  `WorkerStdioPorts`, `WorkerEntryDescriptor`.
- ADR-0011 phase 2: `spawn-worker.ts` — `ProcessManager.spawnWorker(command, spec)`
  allocates a PID off the same counter as `spawn`, creates a `SabRing`
  + three stdio `MessageChannel`s, instantiates
  `new Worker(kernelWorkerUrl, { type: 'module' })`, posts the init
  message with transferables, and surfaces the worker's
  `{type:'exit', code}` as `exit` + `close` on the returned
  `ProcessHandle`. The handle exposes the parent-side stdio ports via
  `handle.ports` for stream adapters.
- ADR-0011 phase 2: `setKernelWorkerUrl(url)` / `getKernelWorkerUrl()`
  let the host supply the Vite-bundled kernel-worker chunk URL; the
  kernel never hardcodes a path. Missing URL → loud
  `NotImplementedError('kernel.spawnWorker', …)`.
- Subpath export `@rifty/kernel/worker-entry` so bundler entries can
  `import '@rifty/kernel/worker-entry'` to install the auto-bootstrap.
- ADR-0011 phase 3: `ipc/sync-rpc.ts` — JSON-over-UTF-8 framing
  (`SyncRpcRequest` / `SyncRpcReply` + `encodeRequest` / `decodeReply` /
  `decodeRequest` / `encodeReply`). Binary frames remain a follow-up
  (A-021).
- ADR-0011 phase 3: `ipc/sync-dispatch.ts` — `SyncRpcDispatcher` runs on
  the parent realm, polls each attached `SabRing` at 1 ms intervals,
  dispatches incoming JSON frames to registered handlers (sync or
  thenable), and writes the reply. Per-ring in-flight guard makes the
  dispatcher recursive-safe (an async handler can spawn a nested
  `execSync` without the polling timer double-dispatching the original).
  Timer is `unref`'d so it never holds Node alive on its own.
- ADR-0011 phase 3: `ipc/sync-client.ts` — `SyncRpcClient(ring)` runs
  inside a kernel-spawned Worker. `call<T>(method, payload, timeoutMs?)`
  encodes the request, `Atomics.wait`s on the reply slot, decodes the
  JSON, and rethrows server-side errors with `name` / `message` / `code`
  preserved. Constructor throws
  `NotImplementedError('SyncRpcClient', 'called from main realm — only
  valid inside a kernel-spawned Worker')` on non-Worker realms — keeps
  the "blocks the UI" failure mode loud.
- ADR-0011 phase 3: `ipc/default-handlers.ts` +
  `ipc/recursive-runner.ts` + `ipc/script-resolver.ts` — kernel default
  `execSync` handler. The handler parses `{cmd, opts}`, looks up the
  script via the injected `ScriptResolver` (set by the runtime-js layer
  through `setExecSyncScriptResolver` so the kernel stays
  filesystem-agnostic), and spawns a fresh kernel Worker via the
  `RecursiveWorkerRunner` (which the spawn-worker module wires to its
  own `spawnKernelWorker`). Recursive workers use PIDs from a dedicated
  counter (0xC0000000+) so they don't collide with `ProcessManager`'s
  public PID space.
- ADR-0011 phase 3: `worker-entry.ts` — exposes
  `__riftyKernelSyncCall(method, payload)` (key:
  `KERNEL_SYNC_CALL_KEY`) as a non-enumerable global. Backed by a
  `SyncRpcClient` bound to this realm's SAB ring. Higher layers
  (`runtime-js/builtins/child_process.execSync`) reach for this to
  delegate sync syscalls.
- `spawnKernelWorker` now returns the parent-side `dispatcher` and
  `ring` so higher layers can `dispatcher.register(...)` additional RPC
  methods. Default `execSync` handler is pre-registered.
- Re-exports: `setExecSyncScriptResolver`, `SyncRpcDispatcher`,
  `SyncRpcClient`, `KERNEL_SYNC_CALL_KEY`, `KernelSyncCall`,
  `registerDefaultHandlers`, `ScriptResolver`, `RecursiveWorkerRunner`,
  `ExecSyncPayload`, `SyncRpcRequest`, `SyncRpcReply`, encode/decode
  helpers.
