# ADR 0038: WasiProcessHandle — kernel adapter for WASI guests

Status: Accepted
Date: 2026-05

> TL;DR: `createWasiProcess` routes WASI guests through `kernel.spawnWorker`, returning a worker `ProcessHandle` with one PID space and stdio shape as `node` children

## Context

`@riftydev/runtime-wasi` exposes a synchronous, callback-stdio entry point —
`Wasi.start(instance)` / `runWasi(bytes, opts)` in
`packages/runtime-wasi/src/wasi.ts`. The caller passes `stdout`/`stderr`
closures and gets the exit code when `_start` returns.

The 2026-05-26 architecture audit flagged this P0 (finding **F1 — WASI guest
has no kernel `ProcessHandle` integration**):

- `Wasi.start()` runs on the caller's stack; large guests (`esbuild.wasm`,
  `tsc.wasm`, `swc.wasm`) block the main thread for hundreds of ms per call.
- The kernel already has a process model — `ProcessHandle`, `ProcessIO`,
  `ProcessManager`, `spawnWorker` (ADR-0011) — consumed by `runtime-js`'s
  `child_process.spawn`. `runtime-wasi` bypasses it.
- M8 needs `spawn('esbuild.wasm', ['--bundle', 'a.js'])`. Without a bridge
  from `runWasi` to `ProcessHandle`, the dispatch site has nothing to return:
  no PID, no binary-stdio `MessagePort`s, no `cwd` ownership, no `kill()`.

## Decision

Add `createWasiProcess(opts): ProcessHandle` in
`packages/runtime-wasi/src/process-handle.ts` — a thin adapter that funnels a
WASI invocation through `globalProcessManager.spawnWorker(...)`, giving the
guest the same kernel treatment as a `node`-backed worker child.

- **Adapter location.** `packages/runtime-wasi/src/process-handle.ts`.
  `runtime-wasi` imports `@riftydev/kernel` (top-down per CLAUDE.md layer
  order vfs → kernel → runtime-*); dependency declared in
  `packages/runtime-wasi/package.json`.
- **Realm.** WASI guests run in a Worker. Reusing `kernel.spawnWorker` gives
  one PID space, one `SyncRpcDispatcher` singleton (ADR-0011 phase 3 fix), one
  stdio port shape across `node` and `wasm` children. Cost: one extra startup
  message hop. Benefit: no main-thread blocking for large WASI tools.
- **Worker entry.** New module `packages/runtime-wasi/src/worker-entry.ts`
  runs in the kernel-side worker realm. Host bundles it as a dedicated Worker
  chunk and registers its URL via `setWasiWorkerUrl(url)`; the adapter sets it
  on `spec.entry.url` so the kernel's `await import(entry.url)` (fired AFTER
  `installProcessShim`) evaluates it. The module reads the WASM URL + preopens
  from `process.env`, fetches/instantiates the guest, and calls
  `process.exit(code)` on non-zero exit. Guest stdout/stderr go through
  `process.stdout.write` / `process.stderr.write`, which `installProcessShim`
  already pipes into the parent's stdio `MessagePort`s.
  The two URLs MUST be distinct — `setKernelWorkerUrl(...)` (boot chunk
  importing `@riftydev/kernel/worker-entry`) and `setWasiWorkerUrl(...)` (entry
  chunk importing `@riftydev/runtime-wasi/worker-entry`): a shared bundle would
  auto-install the WASI side before the kernel runs the init shim and crash on
  a missing `globalThis.process`.
- **Stdio shape.** WASI fd 1/fd 2 map to kernel
  `WorkerStdioPorts.stdout`/`stderr` `MessagePort`s. The worker installs thin
  `(chunk) => process.stdout.write(chunk)` callbacks on the `Wasi` instance —
  no new framing/primitives. Encoding (`TextEncoder` → `Uint8Array`) lives in
  the existing kernel-side `process.stdout.write` shim.
- **VFS sharing.** The spawned worker is a fresh realm. For M8 toolchain calls
  it uses the standard `setSyncMirror` / `MemoryFsSync` route that
  `runtime-js`'s worker-entry uses (ADR-0014 + ADR-0037); the existing WASI
  preopen mapping (`@riftydev/vfs:syncMirror()`) carries forward unchanged.
  No new VFS plumbing — preopens forwarded as the same
  `Record<guestPath, hostPath>` the in-process `Wasi` already accepts.
- **Type contract.** Adapter returns the kernel's `ProcessHandle` (concretely
  `WorkerProcessHandle`, `kind: 'worker'`). Callers use `wireWorkerStdio` from
  `runtime-js/src/builtins/child_process-worker.ts` (or any equivalent pump) —
  same surface as every Worker-backed child.

### Out of scope

- **Dispatch from `runtime-js`'s `child_process.spawn`.** Choosing the WASI
  adapter when `argv[0]` resolves to `.wasm` is the M8 hook. The seam exists;
  the dispatch decision is a follow-up M8 task. No caller dispatches to
  `createWasiProcess` today — that wiring is a genuine TODO.
- **Sync exec of WASI guests.** `execSync('esbuild.wasm …')` would need a
  SAB-based sync transport between main realm and WASI worker. M8 needs async
  only; ADR-0011's `Atomics.wait` path suffices for a later sync extension.
- **Stdin into the guest.** WASI fd 0 is preserved as a port
  (`spec.stdio.stdin`) but the adapter does not yet pump bytes into the fd 0
  buffer. M8 toolchains (esbuild --bundle of file inputs) don't read stdin.

## Consequences

- M8 unblocks: the future `child_process.spawn('esbuild.wasm', [...])`
  dispatch returns a handle shape-identical to `spawn('node', [...])`; callers
  wire stdout/stderr/exit identically.
- Main thread no longer blocks on `_start`; cost paid by the cross-realm hop,
  acceptable for M8 toolchains.
- One PID space across `node` and `wasm` children — `pm.list()` consumers
  (playground process inspector, future `ps`-like tooling) don't branch by kind.
- New package edge `@riftydev/runtime-wasi → @riftydev/kernel`: downward per
  CLAUDE.md, no cycle (`pnpm check:deps` enforces).
- In-process `Wasi` / `runWasi(...)` API stays unchanged — still the right
  tool for WASI syscall unit tests (`syscalls/*.test.ts` use it directly) and
  any future same-realm call site (e.g. a dev-only inspector). Left alone
  deliberately.

## References

- 2026-05-26 architecture audit — F1 (Process model gap).
- ADR-0011 — sync IPC + Worker-as-process model; `kernel.spawnWorker` and the
  `WorkerStdioPorts` shape reused here.
- ADR-0014 + ADR-0037 — shared sync VFS the WASI worker consumes for preopens.
- `PROJECT_PLAN.md` M8 acceptance criteria — toolchain spawn.
