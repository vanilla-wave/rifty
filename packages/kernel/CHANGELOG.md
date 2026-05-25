# Changelog

## [Unreleased]

### Added

- **ADR-0032: SyncRpc protocol-version field.** Every SAB frame now carries
  a `u32` protocol version at offset 0 of the header. New exports:
  `SYNC_RPC_PROTOCOL_VERSION` (value `1`) and `SyncRpcProtocolMismatchError`
  (`code: 'EPROTOVERSION'`). `SabRing.writeRequest` / `writeReply` stamp the
  version before flipping the state slot; `readRequest` / `consumeReply`
  validate and throw on mismatch (state is cleared first so a forged peer
  cannot wedge the ring). `SyncRpcDispatcher` catches the throw and writes
  a versioned error reply at the caller's version so the caller can still
  decode the failure. Header grows from 16 to 20 bytes; the conformance
  fixtures (`tests/conformance/kernel/fixtures/{sab-ring-echo,sync-rpc-echo}.js`)
  were updated to match. Unit tests in
  `packages/kernel/src/ipc/sync-rpc.test.ts`. Pattern mirrors
  `service-worker/src/protocol.ts` `SW_PROTOCOL_VERSION` (ADR-0016).

### Changed

- **`ProcessManager` no longer leaks per-PID records or listeners.** Both
  `spawn` and `spawnWorker` now call `this.table.delete(pid)` AFTER the
  `exit`/`close` events have fired (the handle survives so callers can
  still read `handle.exitCode`); `parentToChild` / `childToParent`
  `EventEmitter`s and the public handle's listener map are stripped via
  `removeAllListeners()`. As a side-effect, a `spawn(..., ppid)` that
  names an already-exited parent now falls back to `DEFAULT_CWD` instead
  of inheriting the deceased parent's last `cwd`. `spawn-worker.ts`
  gained the symmetric `removeEventListener('message'|'error'|'messageerror', …)`
  for the kernel-side listeners it installs, plus a `clearSubscribers()`
  pass on the `onExit` / `onMessageError` arrays. New stress test in
  `tests/process-manager.test.ts` confirms 10 same-realm + 10
  Worker-backed children all return the table to empty and zero
  listener counts on the underlying `WorkerLike`.
- **Review fix (no silent stubs):** `WorkerHandle.send()` for Worker-backed
  children now throws `NotImplementedError('kernel.WorkerHandle.send',
  'ChildProcess.stdin/fork IPC pending M6 phase 2 — see ADR-0011')` instead
  of silently returning `false`. The previous return value matched Node's
  "no IPC channel" idiom but masked the real status: the kernel has no IPC
  bus for Worker-backed children yet. A new test in
  `tests/worker-handle-send.test.ts` pins the throw.
- **Review fix (ADR-0011 §2.11):** `SyncRpcDispatcher` is now a true
  singleton — the new `ipc/kernel-dispatcher.ts` module holds the
  module-level instance, `spawn-worker.ts` re-exports
  `getKernelDispatcher` / `clearKernelDispatcher`. The dispatcher itself
  drops the per-ring timer in favour of one global `setInterval` that
  iterates every attached ring; introspection helpers
  `getAttachmentCount()` and `getActiveTimerCount()` expose the invariants.
  Stress test in `tests/spawn-worker-singleton.test.ts` confirms 10 mock
  workers share exactly one dispatcher + one timer.
- **Review fix (review §1.10):** `spawnKernelWorker` now subscribes to
  `messageerror` alongside `error`. Deserialisation failures
  (structured-clone errors during `postMessage`) surface via
  `SpawnWorkerResult.onMessageError` and as a `'messageerror'` event on
  the `ProcessHandle` — they were silently dropped before. The worker is
  NOT terminated on messageerror (matches browser semantics).

### Added

- `WorkerLike` structural interface + `setWorkerFactoryForTests` /
  `clearWorkerFactoryForTests` test hooks (in the new `worker-like.ts`
  helper) so unit tests can substitute a stub for `new Worker(url)` and
  exercise the kernel-worker lifecycle in Node-only environments.

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
