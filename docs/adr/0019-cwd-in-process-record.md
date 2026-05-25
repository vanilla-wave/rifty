# ADR 0019: `cwd` lives in `kernel.ProcessRecord`

Status: Implemented (2026-05-26)
Date: 2026-05

## Context

`riftyProcess.cwd()` returns the hardcoded string `'/'` and `riftyProcess.chdir(path)` is a silent no-op. Any code that relies on relative-path resolution against the current working directory is broken by design. Existing tests don't exercise the chdir path because the existing behaviour is silent.

REVIEW_ACTIONS entry A-019 flags it. The clean fix depends on the per-process kernel model introduced in ADR 0011 — `cwd` is process-scoped state, and the runtime currently has no notion of a process record.

## Decision

Locate `cwd` in the kernel's `ProcessRecord`.

- `ProcessManager` (the registry introduced in ADR 0012, used by ADR 0011) carries a `ProcessRecord` per spawned process. Each record holds at minimum: `pid`, `argv`, `env`, `cwd`, `stdio`.
- `riftyProcess.cwd()` reads the active record's `cwd`.
- `riftyProcess.chdir(path)` resolves `path` against the current `cwd`, validates it against the VFS (existence + directory check), and writes the resolved value back to the record. Errors throw the Node-shape `ENOENT` / `ENOTDIR`.
- At `kernel.spawn` time the child inherits the parent's `cwd` snapshot. Subsequent `chdir` calls in the parent do not affect the child (and vice versa).
- Implementation deferred to M11 because it depends on ADR 0011's process model existing.

## Consequences

- Relative-path resolution becomes correct under the new process model.
- `chdir` failures surface clearly instead of being silently swallowed.
- Negative: any code that incidentally depended on `cwd()` always returning `'/'` (none in-repo, but possible in user code) will see a different value once the kernel model lands.
- Negative: per-process state means the `riftyProcess` singleton must look up the active record per call rather than reading a module-level variable. Small overhead, but real.
- Follow-up: M11. A small Wave 1 partial fix (a unit test asserting the current `'/'` / no-op behavior, so the silent semantics are at least documented) lands outside this ADR.

## Acceptance criteria

- [x] `riftyProcess.chdir('/tmp'); riftyProcess.cwd() === '/tmp'`.
- [x] `riftyProcess.chdir('/does/not/exist')` throws an `ENOENT`-shape error.
- [x] A child spawned via `kernel.spawn` inherits the parent's `cwd` at spawn time; a subsequent `chdir` in the parent does not change the child's `cwd`.
- [x] Relative-path resolution in `fs.promises.readFile('./pkg.json')` resolves against the active record's `cwd`.

## Implementation notes (2026-05-24)

- `kernel.ProcessRecord` gained a `cwd: string` field; `ProcessHandle.cwd` exposes a read-only view and `setCwd` mutates the record. `DEFAULT_CWD = '/workspace'` for root processes.
- `ProcessManager.spawn(command, handler, ppid?, options?)` snapshots the parent's `cwd` (or `options.cwd` override) into the child's record at spawn time.
- Inside the Worker realm `riftyProcess.cwd()` reads a per-Worker cell defaulting to `/workspace`; `chdir(dir)` resolves against the cell, validates via `syncMirror().statSync` (throws `ENOENT` / `ENOTDIR`), and writes the resolved value back. Once ADR-0011 lands the cell becomes a `SharedArrayBuffer`-mirrored slot tied to the kernel record.
- `fs.ts` `resolvePath` now reads the runtime's own cwd source via `getProcessCwd()` instead of `globalThis.process.cwd()`, so behaviour is identical whether the runtime runs under Node (parity-runner) or a Web Worker.
- 6 conformance tests (`tests/conformance/builtins/process-cwd.test.ts`) + 4 kernel unit tests (`packages/kernel/tests/process-manager.test.ts`).

## Implementation notes (2026-05-26 — host eval wiring)

- `EvalRequest.cwd?: string` (declared in `runtime-js/src/protocol.ts`) is now consumed: `runtime-js/src/worker-entry.ts:handleEval` reads `req.cwd` and seeds the per-Worker cwd cell via `setProcessCwd(req.cwd)` before running user code.
- `RuntimeController.eval(code, { cwd })` lets the host pass a cwd through to the worker. The kernel-spawned Worker path threads the parent `ProcessRecord.cwd` snapshot via `WorkerSpawnSpec.cwd` (handled in `kernel.worker-entry.ts:installProcessShim` — no change needed; that's been in place since the original ADR-0019 landing).
- `tests/conformance/builtins/process-cwd.test.ts` covers cell mutation; `packages/runtime-js/tests/host-eval-cwd.test.ts` covers the host → worker propagation through the protocol.
