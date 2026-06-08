# ADR 0019: `cwd` lives in `kernel.ProcessRecord`

Status: Implemented (2026-05-26)
Date: 2026-05

> TL;DR: `cwd` lives in the kernel's `ProcessRecord`; `chdir` resolves+VFS-validates (throws `ENOENT`/`ENOTDIR`), children snapshot parent `cwd` at `spawn`

## Context

`riftyProcess.cwd()` hardcodes `'/'`; `chdir(path)` is a silent no-op. Relative-path resolution is broken by design, and the silent semantics mean no test exercises chdir. Flagged by REVIEW_ACTIONS A-019. The clean fix needs the per-process kernel model from ADR 0011, since `cwd` is process-scoped state the runtime has no record for yet.

## Decision

Store `cwd` in the kernel's `ProcessRecord`.

- `ProcessManager` (registry from ADR 0012, used by ADR 0011) holds one `ProcessRecord` per process, each with at least `pid`, `argv`, `env`, `cwd`, `stdio`.
- `cwd()` reads the active record's `cwd`.
- `chdir(path)` resolves against current `cwd`, validates against the VFS (exists + is dir), writes the resolved value back; errors throw Node-shape `ENOENT` / `ENOTDIR`.
- At `kernel.spawn`, the child inherits a snapshot of the parent's `cwd`; later `chdir` in parent or child does not affect the other.
- Implementation deferred to M11 (depends on ADR 0011's process model).

## Consequences

- Relative-path resolution becomes correct under the new process model.
- `chdir` failures surface instead of being swallowed.
- Negative: code incidentally relying on `cwd()` always returning `'/'` (none in-repo, possible in user code) sees a different value once the kernel model lands.
- Negative: the `riftyProcess` singleton must look up the active record per call instead of reading a module-level variable — small but real overhead.
- Follow-up: M11. A Wave 1 partial fix (unit test asserting the current `'/'` / no-op behavior to document the silent semantics) lands outside this ADR.

## Acceptance criteria

- [x] `chdir('/tmp'); cwd() === '/tmp'`.
- [x] `chdir('/does/not/exist')` throws an `ENOENT`-shape error.
- [x] Child spawned via `kernel.spawn` inherits parent's `cwd` at spawn time; a later `chdir` in the parent does not change the child's.
- [x] `fs.promises.readFile('./pkg.json')` resolves against the active record's `cwd`.

## Implementation notes (2026-05-24)

- `kernel.ProcessRecord` gained `cwd: string`; `ProcessHandle.cwd` is a read-only view, `setCwd` mutates the record. `DEFAULT_CWD = '/workspace'` for root processes.
- `ProcessManager.spawn(command, handler, ppid?, options?)` snapshots the parent's `cwd` (or `options.cwd` override) into the child at spawn time.
- In the Worker realm, `cwd()` reads a per-Worker cell defaulting to `/workspace`; `chdir(dir)` resolves against it, validates via `syncMirror().statSync` (throws `ENOENT` / `ENOTDIR`), writes back. Post ADR-0011 the cell becomes a `SharedArrayBuffer`-mirrored slot tied to the kernel record.
- `fs.ts` `resolvePath` now reads the runtime's own cwd via `getProcessCwd()` instead of `globalThis.process.cwd()`, so behavior is identical under Node (parity-runner) and Web Worker.
- Tests: 6 conformance (`tests/conformance/builtins/process-cwd.test.ts`) + 4 kernel unit (`packages/kernel/tests/process-manager.test.ts`).

## Implementation notes (2026-05-26 — host eval wiring)

- `EvalRequest.cwd?: string` (declared in `runtime-js/src/protocol.ts`) is now consumed: `runtime-js/src/worker-entry.ts:handleEval` reads `req.cwd` and seeds the per-Worker cwd cell via `setProcessCwd(req.cwd)` before running user code.
- `RuntimeController.eval(code, { cwd })` lets the host pass cwd to the worker. The kernel-spawned Worker path threads the parent `ProcessRecord.cwd` snapshot via `WorkerSpawnSpec.cwd` (handled in `kernel.worker-entry.ts:installProcessShim` — unchanged since the original ADR-0019 landing).
- Tests: `tests/conformance/builtins/process-cwd.test.ts` covers cell mutation; `packages/runtime-js/tests/host-eval-cwd.test.ts` covers host → worker propagation through the protocol.
