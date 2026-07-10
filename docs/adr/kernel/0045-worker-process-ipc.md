# ADR 0045: Worker-process IPC — fork-mode `send` / `'message'` / `disconnect` over a parent↔child MessagePort

Status: Accepted
Date: 2026-05-27
Corrected: 2026-07-10

> Correction (2026-07-10, ADR-0211): the dedicated MessagePort transport stays
> active, but Node `child_process` messages are JSON-shaped at the runtime-js
> boundary. Structured-clone failure is synchronous on the raw transport and
> never implies disconnect; default child IPC serialization failure likewise
> leaves the channel usable. This replaces the original frame-payload and
> clone-failure clauses only.

> Correction (2026-07-10, ADR-0217): physical port presence no longer implies
> public Node IPC. The port carries separate structured-clone control and
> optional runtime-IPC lanes; a worker capability enables `process.send` and
> related state only for fork. Runtime disconnect closes that lane while
> control survives. The public `channel` is a Node-shaped facade, never the raw
> control port; `ref()`/`unref()` stay loud until lifecycle parity. Stdin
> data/EOF use the dedicated stdin port's framed contract. The
> fourth-MessageChannel transport decision remains active.

> TL;DR: Worker fork-IPC (`send`/`'message'`/`disconnect`) rides a dedicated parent↔child `MessagePort` pair with `ipc:message`/`ipc:disconnect` frames, not SAB

## Context

ADR-0011 phase 2 ratified Worker-backed children for `child_process.spawn('node', script)` and `execSync`, but `fork()`-style IPC (`child.send` / `process.on('message', …)`) was left pending. `SameRealmProcessHandle.send` ships; `WorkerProcessHandle.send` does not. M6 `TASKS.md` claims fork-IPC ✅, but the SAB path silently drops messages: `ChildProcess.send` routes to an in-realm `EventEmitter` (`inboundIpc.emit('childMessage', …)`) that the Worker child never subscribes to — a contract violation flagged in the 2026-05-27 architecture review (item #1).

Same-realm fork-IPC works (predates ADR-0011 phase 2 — see `child_process-exec.ts`). The gap is purely the Worker-backed branch, which is the default in any `crossOriginIsolated` host (playground, future Vite-in-Worker).

## Options considered

- **A — parent↔child `MessagePort` pair allocated at spawn (chosen).** A `MessageChannel` in `spawnKernelWorker`; `port1` on parent (`WorkerProcessHandle`), `port2` transferred to the Worker. Symmetric frame vocabulary in both directions: structured-cloned `{ kind: 'ipc:message', payload }` for user payloads, `{ kind: 'ipc:disconnect' }` for tear-down.
- **B — SAB-Atomics IPC.** Rejected: fork-IPC is async (`child.send` returns sync, receive fires next tick), so `Atomics.wait` blocking buys nothing. SAB-Atomics is correct only for genuinely sync flows (`execSync`, `readFileSync` on an out-of-realm fd).
- **C — reuse the stdio port with frame discrimination.** Rejected: couples IPC and stdio lifecycles, breaks transferables (a `MessagePort` passed via `send` collides with stdio bytes), and complicates EOF semantics.

## Decision

Adopt option **A**.

- **Channel allocation.** `spawnKernelWorker` builds a fourth `MessageChannel` alongside the three stdio channels. `port1` → parent; `port2` → `WorkerStdioPorts` under a new `ipc` field (the `stdio` name is kept for ABI continuity). Transfer list grows to `[stdout, stderr, stdin, ipc]` in `worker.postMessage(init, …)`.
- **Frame shape.** Structured-cloned objects:
  - `{ kind: 'ipc:message', payload: unknown }` — user-space message; `payload` is whatever was passed to `child.send` / `process.send`. Structured-clone handles serialization; symbols/functions/class instances surface as `messageerror` (wired in `spawn-worker.ts`).
  - `{ kind: 'ipc:disconnect' }` — disconnect signal; either side posts it, receiver tears down its local port and emits `'disconnect'`.

  No version field. The channel stays within one host realm (kernel ↔ kernel-spawned worker), both built from the same bundle. ADR-0040's SW frame versioning does not apply: the SW boundary crosses bundle generations, but the worker boundary is replaced atomically by a new bundle.
- **Disconnect semantics.**
  - `WorkerProcessHandle.disconnect()` is idempotent: first call posts `{ kind: 'ipc:disconnect' }`, `close()`s the port, marks the handle disconnected, synchronously emits `'disconnect'`.
  - Worker exit (natural, terminate, `kill`) auto-disconnects via the same internal routine in the spawn result's `onExit` callback and in `WorkerHandle.kill`. `'disconnect'` fires once.
  - Worker side: receiving `{ kind: 'ipc:disconnect' }` triggers `process.emit('disconnect')` and closes the local port. Re-`send` after disconnect returns false (matches Node).
- **send semantics.** `WorkerProcessHandle.send(message): boolean`:
  - `false` if disconnected (post-exit or after `disconnect()`) — matches Node's `subprocess.send`, which returns `false` and does NOT throw.
  - `true` otherwise; message posted to the parent port.
  Structured-clone failures surface as `messageerror` on the handle (existing `spawn-worker.ts` listener), NOT as a `send` return value — `postMessage` does not throw on clone failure on the Worker side; the failure surfaces asynchronously to the parent.
- **Worker-side process surface.** Kernel stays Node-API-agnostic (ADR-0039). `process.send` / `process.on('message', …)` wiring lives in `@riftydev/runtime-js`'s `install-process.ts`: the pre-entry hook reads the kernel's `KernelProcessSpec` (now carrying `ipc: MessagePort` via the renamed `stdio` field) and binds the IPC port to the Node `process` shim.
- **Type contract.** `WorkerStdioPorts` and its mirror `KernelProcessStdioPorts` (in `shared-globals.ts`) gain `ipc: MessagePort`. `WorkerProcessHandle` gains public `send`, `disconnect`, and emits `'message'` / `'disconnect'`. `ProcessHandleKind` and the discriminated-union shape are unchanged.

## Consequences

- `WorkerProcessHandle` public surface widens (new `send`, `disconnect`; new events `'message'`, `'disconnect'`) — additive; no in-repo caller branches on whether the handle has `send`.
- `ChildProcess` (`@riftydev/runtime-js`) routes `send` to `handle.send` for the SAB path; same-realm path keeps `inboundIpc.emit('childMessage', …)`. Receive is symmetric: `handle.on('message', …)` re-emits on `ChildProcess`. New `ChildProcess.disconnect()` forwards to the worker handle (no-op for same-realm — no separate channel to close).
- `WorkerStdioPorts` carries one more port; callers pattern-matching `{ stdout, stderr, stdin }` see a wider object — TS strict catches mismatches at compile time.
- `install-process.ts` owns the worker-side `process` IPC surface (`send`, `on('message', …)`, `disconnect`); kernel exposes the raw port via `KernelProcessSpec.stdio.ipc`, installer wraps it. Layering stays top-down (vfs → kernel → runtime-js).
- Same-realm `fork()` semantics untouched (`child_process-exec.ts` path stays). `ChildProcess.send` branches on `handle.kind === 'worker'`.
- No new external dependency. No reverse imports.
- Negative: structured-clone failures on `send` surface as `messageerror`, not a synchronous throw (matches browser-Worker `postMessage`); tests should assert on the `'messageerror'` event for the negative path.

## Acceptance criteria

- [ ] `WorkerStdioPorts` gains `ipc: MessagePort`; mirror in `KernelProcessStdioPorts`.
- [ ] `spawnKernelWorker` allocates a fourth `MessageChannel`, transfers `port2` alongside stdio ports.
- [ ] `WorkerProcessHandle` exposes `send(message): boolean`, `disconnect(): void`, emits `'message'` / `'disconnect'`.
- [ ] `WorkerHandle.kill` and the spawn-result exit callback both tear down IPC idempotently — single `'disconnect'` regardless of exit path.
- [ ] `installNodeProcessShim` (`@riftydev/runtime-js`) installs `process.send`, `process.on('message', …)`, `process.disconnect`, and emits `process.emit('disconnect')` on incoming `{ kind: 'ipc:disconnect' }`.
- [ ] `ChildProcess.send` routes to `handle.send` for the SAB-Worker path; `ChildProcess.disconnect()` forwards to `handle.disconnect`; same-realm path unchanged.
- [ ] Conformance tests (skipped without SAB capability, mirrored from `child_process-stdin.test.ts`):
      - happy round-trip: parent `child.send(msg)` → worker echoes via `process.send({ echo: m })` → parent receives `{ echo: msg }`.
      - auto-disconnect on natural worker exit: `'disconnect'` fires on parent handle; subsequent `child.send(...)` returns `false`.
      - explicit `child.disconnect()` from parent: `'disconnect'` fires on worker side; subsequent `child.send(...)` returns `false`.
- [ ] CHANGELOGs for `@riftydev/kernel` and `@riftydev/runtime-js` updated with a one-line ADR-0045 / M6 fork-IPC reference.

## References

- ADR-0011 — sync IPC via SharedArrayBuffer + Atomics; this ADR extends phase 2 with fork-IPC.
- ADR-0039 — Node-API knowledge lives in `@riftydev/runtime-js`; kernel exposes the raw IPC port, installer wraps it.
- ADR-0040 — SW frame versioning. Not applied: the worker boundary is in-bundle, not cross-bundle.
- ADR-0211 — Node-default child-process IPC serialization correction.
- ADR-0217 — explicit control/runtime-IPC lanes and stdin capability correction.
- `docs/follow-ups-architecture-review-2026-05-27.md` item #1.
