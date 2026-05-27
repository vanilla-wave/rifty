# ADR 0045: Worker-process IPC — fork-mode `send` / `'message'` / `disconnect` over a parent↔child MessagePort

Status: Accepted
Date: 2026-05-27

## Context

ADR-0011 phase 2 ratified Worker-backed children for
`child_process.spawn('node', script)` and `execSync`, but
`fork()`-style IPC (`child.send(msg)` / `process.on('message', …)`) was
left pending. `SameRealmProcessHandle.send` ships today;
`WorkerProcessHandle.send` is missing. M6 `TASKS.md` claims fork-IPC
✅ but the SAB path silently drops messages — `ChildProcess.send`
routes to an in-realm `EventEmitter` (`inboundIpc.emit('childMessage',
…)`) that the Worker child never subscribes to. This is a direct
contract violation, flagged in the 2026-05-27 architecture review
(item #1).

Same-realm fork-IPC still works (it predates ADR-0011 phase 2 — see
`child_process-exec.ts`). The gap is purely on the Worker-backed
branch, which becomes the default in any `crossOriginIsolated` host
(the playground, the future Real Vite-in-Worker path).

## Options considered

- **A — Parent↔child `MessagePort` pair allocated at spawn (chosen).**
  Allocate a `MessageChannel` inside `spawnKernelWorker`. Parent port
  lives on `WorkerProcessHandle`; child port transferred to the
  Worker via `postMessage`. Frame shape is structured-cloned
  `{ kind: 'ipc:message', payload: unknown }` for user payloads and
  `{ kind: 'ipc:disconnect' }` for tear-down. Symmetric: both
  directions use the same frame vocabulary.
- **B — SAB-Atomics-based IPC.** Overkill — fork-IPC is async by
  nature (Node's `child.send` returns synchronously, but the receive
  side fires on the next tick), so blocking via `Atomics.wait` buys
  nothing. SAB-Atomics is the right primitive only for genuinely
  synchronous flows (`execSync`, `readFileSync` against an out-of-realm
  fd).
- **C — Reuse the stdio port with frame discrimination.** Couples
  IPC and stdio lifecycles, breaks transferables (a sender wanting to
  pass a `MessagePort` through `send` would collide with stdio bytes),
  and complicates EOF semantics on either side.

## Decision

Adopt option **A**.

- **Channel allocation.** `spawnKernelWorker` constructs a fourth
  `MessageChannel` alongside the three stdio channels. `port1` stays
  on the parent (handed to `WorkerProcessHandle`); `port2` is added
  to the `WorkerStdioPorts` (renamed conceptually — `stdio` is a
  misnomer once IPC joins the same struct, but the field name stays
  for ABI continuity) under a new `ipc` field. Transfer list grows by
  one — the kernel passes `[stdout, stderr, stdin, ipc]` to
  `worker.postMessage(init, …)`.
- **Frame shape.** Structured-cloned objects:
  - `{ kind: 'ipc:message', payload: unknown }` — user-space message.
    The `payload` is whatever the caller passed to `child.send(msg)` /
    `process.send(msg)`. The browser's structured-clone algorithm
    handles the heavy lifting; symbols, functions, and class
    instances surface as `messageerror` (already wired in
    `spawn-worker.ts`).
  - `{ kind: 'ipc:disconnect' }` — explicit disconnect signal.
    Either side can post this; the receiver tears down its local
    port and emits its `'disconnect'` event.

  No version field. The channel stays within a single host realm
  (kernel ↔ kernel-spawned worker) — both peers are built from the
  same bundle in any practical deploy. ADR-0040's SW frame
  versioning does not apply: the SW boundary crosses bundle
  generations (page-side updates land before SW activation), but the
  worker boundary does not (a new bundle replaces both sides
  atomically).
- **Disconnect semantics.**
  - `WorkerProcessHandle.disconnect()` is idempotent. The first call
    posts `{ kind: 'ipc:disconnect' }` over the parent port,
    `close()`s the port, marks the handle disconnected, and synchronously
    emits `'disconnect'` on the handle.
  - Worker exit (natural, terminate, or `kill`) auto-disconnects:
    the kernel calls the same internal disconnect routine inside the
    spawn result's `onExit` callback and inside
    `WorkerHandle.kill`. The `'disconnect'` event fires once.
  - On the Worker side, receiving `{ kind: 'ipc:disconnect' }`
    triggers `process.emit('disconnect')` and closes the local IPC
    port. Re-`send` from the worker after disconnect returns false
    (matches Node's documented behaviour).
- **send semantics.** `WorkerProcessHandle.send(message)` returns
  `boolean`:
  - `false` if the handle is disconnected (post-exit or after
    `disconnect()`). Matches Node's `subprocess.send` behaviour:
    Node returns `false` and does NOT throw.
  - `true` otherwise; the message is posted to the parent port.
  Structured-clone failures bubble out as `messageerror` on the
  handle (the existing `spawn-worker.ts` `messageerror` listener
  surfaces them), NOT as a `send` return value — `postMessage`
  itself does not throw on clone failure on the Worker side; the
  failure surfaces asynchronously to the parent.
- **Worker-side process surface.** The kernel itself stays
  Node-API-agnostic (ADR-0039). Wiring `process.send` /
  `process.on('message', …)` lives in `@rifty/runtime-js`'s
  `install-process.ts` — the existing pre-entry hook reads the
  kernel's `KernelProcessSpec` (which now carries `ipc: MessagePort`
  via the renamed `stdio` field — see "Type contract" below) and
  binds the IPC port to the installed Node `process` shim.
- **Type contract.** `WorkerStdioPorts` (and the mirror
  `KernelProcessStdioPorts` in `shared-globals.ts`) gain one field:
  `ipc: MessagePort`. `WorkerProcessHandle` gains the public
  surface `send`, `disconnect`, and emits `'message'` and
  `'disconnect'`. `ProcessHandleKind` and the discriminated-union
  shape are unchanged.

## Consequences

- Public surface of `WorkerProcessHandle` widens: new methods `send`
  and `disconnect`, new emitted events `'message'` and
  `'disconnect'`. Additive — no caller in this repo branches on
  "does the worker handle have `send`?".
- `ChildProcess` in `@rifty/runtime-js` routes `send` to
  `handle.send` for the SAB path; the same-realm path keeps using
  `inboundIpc.emit('childMessage', …)`. Symmetric for receive:
  `handle.on('message', …)` re-emits on `ChildProcess`. `ChildProcess`
  gains an explicit `.disconnect()` method that forwards to the
  worker handle (or no-ops for the same-realm path — there's no
  separate channel to close).
- `WorkerStdioPorts` carries one more port. Existing callers that
  pattern-match `{ stdout, stderr, stdin }` see a wider object —
  TypeScript strict catches mismatches at compile time.
- `@rifty/runtime-js`'s `install-process.ts` becomes responsible for
  the worker-side `process` IPC surface (`send`, `on('message', …)`,
  `disconnect`). The kernel exposes the raw port via
  `KernelProcessSpec.stdio.ipc`; the installer wraps it. Layering
  stays top-down (vfs → kernel → runtime-js).
- Same-realm `fork()` semantics are untouched — the existing
  `child_process-exec.ts` IPC path stays. The decision-point in
  `ChildProcess.send` branches on `handle.kind === 'worker'`.
- No new external dependency. No reverse imports.
- Negative: structured-clone failures on `send` show up as
  `messageerror` rather than a synchronous throw. This matches
  browser-Worker `postMessage` semantics; tests should rely on the
  `'messageerror'` event for the negative path.

## Acceptance criteria

- [ ] `WorkerStdioPorts` gains `ipc: MessagePort`. Mirror change in
      `KernelProcessStdioPorts`.
- [ ] `spawnKernelWorker` allocates a fourth `MessageChannel` and
      transfers `port2` alongside the stdio ports.
- [ ] `WorkerProcessHandle` exposes `send(message): boolean`,
      `disconnect(): void`, and emits `'message'` / `'disconnect'`.
- [ ] `WorkerHandle.kill` and the spawn-result's exit callback both
      tear down IPC idempotently — a single `'disconnect'` event
      regardless of exit path.
- [ ] `@rifty/runtime-js`'s `installNodeProcessShim` installs
      `process.send`, `process.on('message', …)`, `process.disconnect`,
      and emits `process.emit('disconnect')` on incoming
      `{ kind: 'ipc:disconnect' }`.
- [ ] `ChildProcess.send` routes to `handle.send` for the SAB-Worker
      path; `ChildProcess.disconnect()` forwards to `handle.disconnect`.
      The same-realm path is unchanged.
- [ ] Conformance tests (skipped without SAB capability, mirrored
      from `child_process-stdin.test.ts`):
      - happy round-trip: parent `child.send(msg)` → worker
        `process.on('message', m => process.send({ echo: m }))` →
        parent receives `{ echo: msg }`.
      - auto-disconnect on natural worker exit: `'disconnect'` fires
        on the parent handle, subsequent `child.send(...)` returns
        `false`.
      - explicit `child.disconnect()` from the parent: `'disconnect'`
        fires on the worker side; subsequent `child.send(...)` returns
        `false`.
- [ ] CHANGELOGs updated for `@rifty/kernel` and `@rifty/runtime-js`
      with a one-line reference to ADR-0045 and M6 fork-IPC.

## References

- ADR-0011 — sync IPC via SharedArrayBuffer + Atomics; this ADR
  extends phase 2 with fork-IPC.
- ADR-0039 — Node-API knowledge lives in `@rifty/runtime-js`. The
  kernel exposes the raw IPC port; the installer wraps it.
- ADR-0040 — SW frame versioning. Explicitly not applied here —
  the worker boundary is in-bundle, not cross-bundle.
- `docs/follow-ups-architecture-review-2026-05-27.md` item #1.
