# ADR 0019: `cwd` lives in `kernel.ProcessRecord`

Status: Accepted
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

## Acceptance criteria for the deferred implementation

- [ ] `riftyProcess.chdir('/tmp'); riftyProcess.cwd() === '/tmp'`.
- [ ] `riftyProcess.chdir('/does/not/exist')` throws an `ENOENT`-shape error.
- [ ] A child spawned via `kernel.spawn` inherits the parent's `cwd` at spawn time; a subsequent `chdir` in the parent does not change the child's `cwd`.
- [ ] Relative-path resolution in `fs.promises.readFile('./pkg.json')` resolves against the active record's `cwd`.
