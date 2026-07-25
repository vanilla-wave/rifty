# Changelog

## [Unreleased]

### Added

- **One-shot opaque URL-entry capabilities (ADR-0313).** A spawned URL entry
  can carry a validated frozen map of named `MessagePort`s in its existing init
  transaction. The worker publishes them before pre-entry, privileged
  bootstrap consumes them once before guest import, and every init/exit failure
  closes adopted endpoints. Source entries and process identity stay unchanged.

### Fixed

- **SyncRpc protocol violations are forensic and loud, never silent.** Two CI
  flake signatures (`SabRing: cannot writeRequest while a previous reply is
  unread`, `decodeReply: unknown frame discriminator 0x-1`) carried zero
  context. Now: every SabRing guard/corrupt/timeout throw appends the atomic
  header snapshot (`version/req/rep/reqLen/repLen`); an empty reply/request
  frame is named as the double-consume signature instead of `0x-1`;
  `SyncRpcClient.call` errors name the failing method and the previous call on
  the ring; the dispatcher's undeliverable-reply drop (both writers) logs a
  `console.error` naming the method instead of a silent `catch {}`. No wire or
  behavior change — messages and one log line only.

- **Failed Worker init no longer leaks its half-built process.** If an entry
  descriptor getter, SAB/Worker setup, bootstrap `postMessage`, or listener
  install throws after capability adoption, spawn now closes every adopted
  endpoint and rolls back all resources acquired so far before rethrowing the
  same error. Worker-side SAB attach and shared-global publication now share
  entry finalization, so setup failure closes the transferred ports and realm.
- **Worker stdout/stderr no longer loses final chunks on natural exit.**
  Worker-backed process exit arrives on the Worker message channel while stdio
  bytes arrive on separate MessagePorts, so a final CLI line could land after
  `{type:'exit'}` and be dropped by EOF/foreground mute. Natural worker exit now
  defers EOF/`exit` briefly to drain in-flight stdio; `kill()` stays immediate.
- **Worker uncaught-error diagnostic no longer vanishes** (backlog/kernel/worker-global-error-to-stderr). `spawnWorker`'s `error` handler mapped a worker's uncaught GLOBAL error (one that escaped worker-entry's top-level try/catch — thrown in a queueMicrotask/timer, or an unhandled EventEmitter `'error'` re-throw like EADDRINUSE) to exit 1 but dropped its message → loud exit, silent terminal. Now the message (+`filename:lineno`) is forwarded onto the child's stderr stream via a new `SpawnWorkerResult.onUncaughtError` seam (process-manager pushes it into `handle.stderr()`), and the exit is deferred one microtask so the async stderr `'data'` flushes BEFORE a foreground consumer's synchronous exit-gate mutes output. The generic top-level-throw path (stack already on stderr) is unchanged.
- **Dispatcher backstop is uncounted infra (ADR-0158, keepalive gap-e).** `SyncRpcDispatcher` now captures the HOST `setInterval`/`clearInterval` at module load and arms its backstop timer on them, instead of the realm's global `setInterval` (which a worker realm replaces with runtime-js's keepalive-counted wrapper). The infra timer therefore never enters the event-loop keepalive count, by construction (ADR-0152 §5 precedent) — removing the prior depth-1 count-then-`.unref()` coupling and any risk of pinning a nested child's (depth-2) drain. Guard: `sync-dispatch.test.ts` asserts the backstop arms the host timer, not the wrapped global.

- **A kernel worker crash is no longer swallowed.** `spawnKernelWorker`'s
  `error` handler discarded the event (`void ev`), so a module-eval crash looked
  like a silent boot hang — the host worker died with no error and no
  `{type:'exit'}`, leaving callers awaiting a reply hung forever with nothing in
  the console. It now `console.error`s the worker's message + stack before
  tearing down (mirrors the existing `messageerror` logging contract).

### Added

- **Entry-scoped URL-worker bootstrap envelope.** `WorkerEntryDescriptor` URL
  entries may carry typed `{protocol, payload}` metadata inside the existing
  init message. Worker boot publishes it as a non-enumerable shared global
  before pre-entry; kernel transports the opaque payload without runtime
  knowledge. Source entries cannot carry it.
- **Worker stdin EOF and live TTY control (ADR-0225/0230).** Ending
  `WorkerProcessHandle.stdin()` now posts an ordered `stdin:eof` frame before
  closing its data port. `WorkerProcessHandle.resize(cols, rows)` uses the
  physical control port, which stays live after logical user-IPC disconnect
  and closes only on worker exit/kill.
- **Drain-hook seam:** a run-to-completion child (`serve!==true`) awaits an optional event-loop drain (`setKernelDrainHook`) before reaping, so it exits on loop-empty like Node, not at top-level resolve; kernel stays Node-API-agnostic (ADR-0039). Child realm de-contaminated: `worker-entry.ts` runEntry uses an indirect dynamic import so bundlers don't inject infra (a dev HMR-client ping) that would pin the drain. The entry-run + drain + exit-outcome logic is the realm-independent `runEntryLifecycle` (pure, unit-testable for the serve-skip / await-drain / reject→exit1 paths without the COI-gated SAB realm — mirrors `finalizeWorkerEntry`).

- **ADR-0144 — kernel server-process model (`serve`).** `WorkerSpawnSpec` + `SpawnWorkerSpec` gain a public `serve?: boolean`. When `true`, a worker whose entry finishes setup WITHOUT throwing is NOT reaped — the kernel skips the exit message, port close, and `self.close()`, leaving the realm alive (its open ports/timers keep it live) until the parent terminates it. A run-to-completion process (`serve` absent/false) reaps the instant its entry settles, as before; a `serve` entry that THREW during setup still reaps. The teardown decision is the pure, exported `finalizeWorkerEntry(target, spec, outcome)` (realm-independent → unit-testable). This retires the `await new Promise<never>(() => {})` keep-alive hack (ADR-0077 follow-up) and is the P1 gate for ADR-0143 "D" (the owner-worker execution model). Hard kill unchanged; graceful stop deferred to ADR-0143 P5.
- **ADR-0084 — SAB ring + SyncRpc v2 wire (perf wave 4).** Four mechanisms over the
  sync-IPC stack, landed atomically with runtime-js (two-peer recompile):
  - **#18 zero-copy view.** `SabRing.readRequest`/`consumeReply` return a live
    `subarray` VIEW into the SAB instead of copying out (no per-read allocation).
    New contract: the view aliases the SAB and is valid only until the next
    same-slot write — decode synchronously (production callers do). The gate is
    preserved verbatim (success: decode-then-flip-IDLE; error/version: flip-then-throw).
  - **#17 waitAsync responder.** New public `SabRing.armRequest(timeout)`. The
    `SyncRpcDispatcher` arms a per-ring `Atomics.waitAsync` on REQ_STATE (the
    caller's `writeRequest` notify wakes it sub-ms) with generation-based
    cancel-on-detach and re-arm-after-reply; a single global backstop timer
    (50-100 ms) recovers missed notifies. Feature-detect → legacy
    `setInterval(pollIntervalMs)` busy-poll when `Atomics.waitAsync` is absent.
    **`pollIntervalMs` meaning changed** (observable public option): primary wake
    is now the notify, so it is backstop-only (clamped 50-100 ms) in event-driven
    mode; literal poll interval in fallback. `getActiveTimerCount()` keeps its 0/1
    contract (single backstop timer).
  - **#19 configurable payload capacity.** `WorkerSpawnSpec` + `SpawnWorkerSpec`
    gain a public `payloadCapacity?: number`; the parent sizes the ring AND stamps
    the spec from one value, the child attaches with it — explicit agreement, no
    coincidence-of-default. `SabRing`'s size guard tightened `<`→EXACT so a desynced
    capacity throws `RangeError` loudly instead of a wrong-slot read. Default 1 MiB
    NOT lowered (deferred, OQ-323).
  - **#23 SyncRpc v2 binary frame.** 1-byte frame discriminator (`0x00`=JSON,
    `0x01`=BINARY) prefixes every body; new `encodeBinaryReply` + `FRAME_JSON`/
    `FRAME_BINARY` exports; `decodeReply` branches on byte[0] (binary → `Uint8Array`
    value, no TextDecoder/JSON). The dispatcher auto-emits a binary frame for a
    `Uint8Array` handler value. Requests + errors stay JSON. `SYNC_RPC_PROTOCOL_VERSION`
    bumped 1→2 (pre-authorised by ADR-0032; the EPROTOVERSION guard still fires
    across the bump). Discriminator lives in the payload body, so the 20-byte SAB
    header is unchanged — `sync-rpc-echo.js` updated to write/strip the discriminator;
    `sab-ring-echo.js` (below the framing layer) unchanged. Per ADR-0084,
    citing ADR-0011/0032/0016 + `docs/perf/js-runtime-perf-audit-2026-06-05.md`.

- **ADR-0045 — Worker-process fork IPC (M6).** `WorkerProcessHandle` gains
  `send(message): boolean`, `disconnect(): void`, and emits `'message'` /
  `'disconnect'` events. `spawnKernelWorker` allocates a fourth
  `MessageChannel` (`ipc`) alongside the stdio trio and transfers it to
  the worker. `WorkerStdioPorts` (and the mirror `KernelProcessStdioPorts`
  in `shared-globals.ts`) gain `ipc: MessagePort`. Frame shape is
  `{ kind: 'ipc:message', payload }` / `{ kind: 'ipc:disconnect' }` (typed
  via new public `IpcFrame` export). Auto-disconnect on worker exit
  (natural or `kill`) — single `'disconnect'` event regardless of path.
- **`WorkerProcessHandle.stdout()` / `stderr()` / `stdin()` accessors.**
  Returns `@riftydev/io` `Readable` / `Writable` streams already wired to the
  worker's stdio `MessagePort` triple (start/onmessage/EOF on exit handled
  internally). Same instance is returned on repeated calls (singleton per
  handle). The raw `ports` field is kept for an interim release and marked
  `@deprecated`; new code should reach for the accessors. Removes
  hand-rolled `port.start()` / `port.onmessage` / push-null boilerplate
  from runtime-js (`wireWorkerStdio` dissolved into the kernel adapter —
  follow-ups doc item #3).

### Fixed

- **SyncRpc JSON-frame decode no longer feeds a SharedArrayBuffer view to `TextDecoder` (browser SAB path).** `decodeReply`/`decodeRequest` (`ipc/sync-rpc.ts`) called `TextDecoder.decode(body)` where `body` is a `subarray` VIEW into the ring's SAB (ADR-0084 #18 zero-copy). Browsers reject a shared-backed view (`TypeError: The provided ArrayBufferView value must not be shared`); Node is lax, so this passed every Node unit + conformance test yet threw the FIRST time it ran in a real cross-origin-isolated Worker — surfaced by the new `tests/e2e/execsync-sab.spec.ts` (guest `execSync` over real SAB + `Atomics.waitAsync` + v2 binary frame). Both decoders now copy out of the (possibly shared) view via `.slice()` before `TextDecoder.decode` (small JSON bodies — requests, `{ok,value|error}` / error replies); the binary frame body already copied. The v2 binary fast-path is byte-unchanged. Guard: `ipc/sync-rpc.test.ts` "JSON-frame decode over a SharedArrayBuffer view" (decodeReply value + error, decodeRequest) + the e2e (`hex === 'fffe00'`, which only the real byte-exact round-trip yields).

### Changed

- `ProcessHandle` sealed union no longer carries `send` on the shared base.
  `send(message)` now lives on `SameRealmProcessHandle` only;
  `WorkerProcessHandle` does not expose it. Callers MUST narrow on
  `handle.kind === 'same-realm'` before calling `send` — the type system
  reflects what each branch actually supports, and the previous throwing
  stub on the Worker branch (which `// @ts-ignore` callers could have
  reached) is gone. Internal change only: no caller in this repo was
  reaching for `handle.send` through the union, so the rename is a typing
  cleanup. Fork-mode IPC for Worker-backed children is still pending —
  see ADR-0011 phase 2 follow-up; when it lands, `send` joins
  `WorkerProcessHandle` additively.

### Removed

- **ADR-0039 — Node-API surface lifted to `@riftydev/runtime-js`.** The kernel
  no longer ships Node-shaped knowledge:
  - `installProcessShim` (Node-shape `process` global) and the internal
    `ProcessShim` interface have been deleted from `worker-entry.ts`. The
    kernel-spawned Worker no longer installs `globalThis.process` itself.
  - The `'execSync'` default handler in `ipc/default-handlers.ts`, the
    `ipc/script-resolver.ts` registration module, and the
    `ipc/recursive-runner.ts` Worker runner have moved to
    `packages/runtime-js/src/ipc/`. The kernel files are gone.
  - `setKernelRecursiveSpawn` (and the `RecursiveSpawnFn` type) are gone.
    The recursive runner now lives in runtime-js and statically imports
    `spawnKernelWorker` from `@riftydev/kernel`, closing the late-binding
    cycle that the original split worked around.
  - The kernel index no longer exports `registerDefaultHandlers`,
    `setExecSyncScriptResolver`, `ScriptResolver`, `RecursiveWorkerRunner`,
    `DefaultHandlerOptions`, or `ExecSyncPayload`. Callers import from
    `@riftydev/runtime-js/install-process` and `@riftydev/runtime-js`'s
    `ipc/handlers.ts` instead.
  - `getKernelDispatcher()` ships with **no** pre-registered handlers.
    Higher layers register methods explicitly at boot.

### Added

- **ADR-0039 — `KernelProcessSpec` published on Worker boot.** New
  `shared-globals.ts` exports `KernelProcessSpec`, `KernelProcessStdioPorts`,
  `KERNEL_PROCESS_SPEC_KEY`, `publishKernelProcessSpec`, and
  `readKernelProcessSpec`. The kernel-side worker bootstrap publishes a
  typed `{pid, ppid, argv, env, cwd, stdio}` snapshot on each spawn so the
  higher runtime layer can build its own `process` object (Node-shape in
  runtime-js, WASI-shape in runtime-wasi). The kernel itself never touches
  `globalThis.process`.
- **ADR-0039 — pre-entry hook on `worker-entry.ts`.** New
  `setKernelPreEntryHook(fn)` / `getKernelPreEntryHook()` exports let the
  host register a function the kernel calls between publishing the
  `KernelProcessSpec` and running the user entry. Runtime-js uses this
  hook to install its `installNodeProcessShim` for kind:'source' entries.
  Pass `null` to unregister.
- **`spawnKernelWorker` exported from the package root.** Previously
  reachable only via the deep `./src/spawn-worker.ts` path; now part of the
  `@riftydev/kernel` public surface so runtime-js's recursive runner can
  statically import it.
- **Typed cross-realm globals (P1 review fix).** New `shared-globals.ts` module exports `KernelSyncApi`, `KernelSabRing`, `publishKernelSyncApi` / `readKernelSyncApi`, and `publishKernelSabRing` / `readKernelSabRing`. Consumers (runtime-js `child_process-sync.ts`) now go through the typed read API instead of indexing `globalThis[KERNEL_SYNC_CALL_KEY]`. The string hook keys remain implementation detail but are re-exported for the rare test that needs to assert against them.
- **`ProcessHandle` discriminator (P1 review fix).** `ProcessHandle` is now a sealed `SameRealmProcessHandle | WorkerProcessHandle` union tagged by `kind: 'same-realm' | 'worker'`. Callers branch on `handle.kind` instead of probing for `handle.ports`; the worker-backed variant's `ports` is statically known to be present.
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
- Subpath export `@riftydev/kernel/worker-entry` so bundler entries can
  `import '@riftydev/kernel/worker-entry'` to install the auto-bootstrap.
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
