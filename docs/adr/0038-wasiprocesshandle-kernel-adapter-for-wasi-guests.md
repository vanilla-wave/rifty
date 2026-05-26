# ADR 0038: WasiProcessHandle — kernel adapter for WASI guests

Status: Accepted
Date: 2026-05

## Context

`@rifty/runtime-wasi` today exposes a synchronous, callback-stdio entry
point — `Wasi.start(instance)` and `runWasi(bytes, opts)` in
`packages/runtime-wasi/src/wasi.ts`. The caller passes
`stdout(chunk: string) => void` / `stderr(chunk: string) => void`
closures and gets the exit code back when `_start` returns.

The 2026-05-26 architecture audit flagged this as P0 (finding **F1 —
Process model: WASI guest has no kernel `ProcessHandle` integration**):

- `Wasi.start()` runs inside the caller's stack. Large guests
  (`esbuild.wasm`, `tsc.wasm`, `swc.wasm`) block the main thread for
  hundreds of milliseconds per invocation.
- The kernel already has a real process model — `ProcessHandle`,
  `ProcessIO`, `ProcessManager`, `spawnWorker` (ADR-0011) — that
  `runtime-js`'s `child_process.spawn` consumes. `runtime-wasi`
  bypasses it.
- M8 needs `spawn('esbuild.wasm', ['--bundle', 'a.js'])`. With no
  bridge between `runWasi` and `ProcessHandle`, the dispatch site in
  `child_process.spawn` has nothing to dispatch to: no PID, no
  binary-stdio `MessagePort`s, no `cwd` ownership, no `kill()`.

## Decision

Introduce `createWasiProcess(opts): ProcessHandle` in
`packages/runtime-wasi/src/process-handle.ts`. It is a thin adapter
that funnels a WASI invocation through
`globalProcessManager.spawnWorker(...)` so the guest gets the same
kernel-level treatment as a `node`-backed worker child.

- **Adapter location.** `packages/runtime-wasi/src/process-handle.ts`.
  `runtime-wasi` imports `@rifty/kernel` — top-down per CLAUDE.md
  layer order (vfs → kernel → runtime-* → …). The dependency is
  declared in `packages/runtime-wasi/package.json`.
- **Realm.** WASI guests run in a Worker. Reusing
  `kernel.spawnWorker` means one PID space, one `SyncRpcDispatcher`
  singleton (ADR-0011 phase 3 fix), one stdio port shape across
  `node` and `wasm` children. The cost is one extra message hop to
  start; the benefit is no main-thread blocking for large WASI
  tools.
- **Worker entry.** `packages/runtime-wasi/src/worker-entry.ts` is a
  new module that runs inside the kernel-side worker realm. The host
  bundles it as a dedicated Worker chunk and registers its URL via
  `setWasiWorkerUrl(url)`. The adapter sets that URL on
  `spec.entry.url` so the kernel's `await import(entry.url)` (which
  fires AFTER `installProcessShim`) evaluates it. The module reads
  the WASM URL + preopens from `process.env`, fetches and
  instantiates the guest, and propagates the exit via
  `process.exit(code)` when non-zero. Stdout / stderr from inside
  the guest go through `process.stdout.write` /
  `process.stderr.write` — the kernel's `installProcessShim` already
  pipes those into the parent's stdio `MessagePort`s. The two URLs
  (`setKernelWorkerUrl(...)` for the boot chunk that imports
  `@rifty/kernel/worker-entry`, and `setWasiWorkerUrl(...)` for the
  entry chunk that imports `@rifty/runtime-wasi/worker-entry`) MUST
  be distinct: a shared bundle would auto-install the WASI side
  before the kernel runs the init shim and crash on a missing
  `globalThis.process`.
- **Stdio shape.** WASI fd 1 / fd 2 map to the kernel
  `WorkerStdioPorts.stdout` / `stderr` `MessagePort`s. The runtime-wasi
  worker installs thin `(chunk: string) => process.stdout.write(chunk)`
  callbacks when constructing the `Wasi` instance — no new framing,
  no new primitives. The encoding (`TextEncoder` → `Uint8Array`)
  lives in the kernel-side `process.stdout.write` shim that already
  exists.
- **VFS sharing.** The spawned worker is a fresh realm. For M8
  toolchain calls the worker will need access to the host's VFS;
  that's the standard `setSyncMirror` / `MemoryFsSync` route that
  `@rifty/runtime-js`'s worker-entry uses (ADR-0014 + ADR-0037), and
  the existing in-process WASI preopen mapping
  (`@rifty/vfs:syncMirror()`) carries forward unchanged inside the
  worker. No new VFS plumbing — preopens are forwarded as the same
  `Record<guestPath, hostPath>` the in-process `Wasi` already
  accepts.
- **Type contract.** The adapter returns the kernel's existing
  `ProcessHandle` (concretely a `WorkerProcessHandle`, `kind:
  'worker'`). Callers use `wireWorkerStdio` from
  `runtime-js/src/builtins/child_process-worker.ts` (or any
  equivalent pump) to consume the stdio ports — same surface as
  every other Worker-backed child.

### Out of scope

- **Dispatch from `runtime-js`'s `child_process.spawn`.** Choosing
  the WASI adapter when `argv[0]` resolves to a `.wasm` is the M8
  hook. The seam is in place; the dispatch decision is a follow-up
  task in the M8 milestone. Today no caller in the repo dispatches
  `child_process.spawn` to `createWasiProcess`; that wiring is
  genuinely a TODO.
- **Sync exec of WASI guests.** `execSync('esbuild.wasm …')` would
  need a SAB-based sync transport between the main realm and the
  WASI worker. M8 needs async only; ADR-0011's `Atomics.wait` path
  is enough infrastructure for a later sync extension.
- **Stdin into the guest.** WASI fd 0 is preserved as a port
  (`spec.stdio.stdin`) but the adapter does not yet pump bytes from
  the parent into the WASI fd 0 buffer. Toolchains used at M8
  (esbuild --bundle of file inputs) don't read stdin.

## Consequences

- M8 unblocks: a `WasiProcessHandle` lets the future
  `child_process.spawn('esbuild.wasm', [...])` dispatch site return
  a handle indistinguishable in shape from
  `child_process.spawn('node', [...])`. Callers wire stdout / stderr
  / exit identically.
- Main-thread no longer blocks on `_start`. The cost is paid by the
  cross-realm hop, which is acceptable for the toolchains M8 cares
  about.
- One PID space across `node` children and `wasm` children. Existing
  `pm.list()` consumers (playground process inspector, future
  `ps`-like tooling) don't branch by kind.
- New package-level edge: `@rifty/runtime-wasi → @rifty/kernel`.
  Downward per CLAUDE.md; no cycle introduced (`pnpm check:deps`
  enforces).
- The existing in-process `Wasi` / `runWasi(...)` API stays
  unchanged. It remains the right tool for unit tests of the WASI
  syscall surface (the `syscalls/*.test.ts` files all use it
  directly) and for any future call sites that genuinely need a
  same-realm guest (e.g. a dev-only inspector). They are deliberately
  left alone.

## References

- 2026-05-26 architecture audit — F1 (Process model gap).
- ADR-0011 — sync IPC + Worker-as-process model;
  `kernel.spawnWorker` and the `WorkerStdioPorts` shape this ADR
  reuses.
- ADR-0014 + ADR-0037 — shared sync VFS that the WASI worker will
  consume for preopens.
- `PROJECT_PLAN.md` M8 acceptance criteria — toolchain spawn.
