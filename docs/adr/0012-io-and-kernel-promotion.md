# ADR 0012: `@rifty/io` owns shared primitives; `@rifty/kernel` owns processes

Status: Implemented (2026-05-25)
Date: 2026-05

## Context

`packages/io` and `packages/kernel` exist as near-empty skeletons. The shared Node primitives — `EventEmitter`, `Buffer`, the stream classes (`Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`), `NotImplementedError` — currently live inside `packages/runtime-js/src/builtins/` and are imported from there by other packages. `packages/net` imports `EventEmitter` from `@rifty/runtime-js`, which inverts the layering described in `PROJECT_PLAN.md` §2: `net` is meant to depend on `io`, not on `runtime-js`.

REVIEW_ACTIONS entries A-003 (skeleton packages) and A-014 (reverse import `net → runtime-js`) are two views of the same problem. ADR 0011 also assumes `@rifty/kernel.ProcessManager` is the registry behind `child_process` and `worker_threads`; that registry currently has no implementation.

## Decision

Promote `@rifty/io` to the shared primitives layer and commit `@rifty/kernel` to the process layer.

- Move sources of `EventEmitter`, `Buffer`, `NotImplementedError`, and the stream classes into `packages/io/src/`.
- `@rifty/runtime-js` re-exports them through its `node:` builtins (`packages/runtime-js/src/builtins/{events,buffer,stream}.ts` become thin re-export modules that bridge the registry to the `io` sources).
- `@rifty/net` imports primitives from `@rifty/io` directly. The current `import from '@rifty/runtime-js/builtins/...'` lines disappear.
- `@rifty/kernel.ProcessManager` becomes the registry used by `child_process`, `worker_threads`, and `kernel.spawn` from ADR 0011. PID allocation is unified — today `child_process` and `worker_threads` hold separate counters (1000+ and 2+ respectively) — both move to a single `kernel` allocator.
- No new external dependencies. All moves are within the workspace.

## Consequences

- Layer diagram becomes truthful: `vfs → kernel → runtime-* → net → ...` with `io` available as a shared peer of `kernel`. `pnpm check:deps` regains its intended meaning.
- A-014 auto-resolves once primitives live in `@rifty/io`.
- ADR 0011's `kernel.spawn` has a concrete home in `kernel.ProcessManager`.
- Negative: ~30 file moves across 4 packages, with import-path churn in every consumer. The change is mechanically obvious but spreads across the tree.
- Negative: `@rifty/runtime-js`'s public surface shrinks (primitives stop being re-exported from `builtins/events`, etc.). Consumers within the repo are updated as part of the move; external consumers are not yet a concern.
- Follow-up: implementation lands in M11, ideally before ADR 0011's `kernel.spawn` work to keep the import graph linear.

## Acceptance criteria for the deferred implementation

- [x] `pnpm check:deps` shows `net → io` and `runtime-js → io` with no path from `io` or `kernel` back to `runtime-js`. (`packages/kernel/src` and `packages/io/src` contain zero `@rifty/runtime-js` imports.)
- [x] `@rifty/runtime-js` no longer exports `EventEmitter` as the source of truth from any subpath; only the re-exporting `node:events` adapter remains. (`builtins/events.ts`, `builtins/buffer.ts`, `builtins/stream.ts` are now ~10-line re-exports over `@rifty/io`.)
- [~] `child_process.spawn` and `worker_threads.Worker` allocate PIDs from a single `ProcessManager` counter. **`child_process.spawn` is wired** — `ChildProcess.pid`, `exitCode`, `signalCode`, and `cwd` come from `globalProcessManager.spawn(...)`. `worker_threads.Worker` still uses its own counter pending the ADR-0011 worker-as-process migration that consolidates Worker allocation through the same path.
- [x] No package outside `apps/playground/**` imports `solid-js` (re-check unchanged from D-002). (`pnpm check:isolation` clean.)

### Implementation notes (2026-05-25)

- The stream classes split across `packages/io/src/streams/{readable,writable,duplex,transform,pass-through,pipeline,index}.ts` to stay under the ADR-0024 line budget; the EXCEPTIONS entry for `packages/runtime-js/src/builtins/stream.ts` (now a shim) is removed.
- `packages/runtime-js/src/builtins/buffer.ts` also drops from the EXCEPTIONS list; the Buffer implementation now lives in `packages/io/src/buffer{,-codec,-methods}.ts`, each ≤ 260 lines.
- `packages/net/src/{http,net,ws}.ts` import primitives from `@rifty/io` directly. `packages/net/src/register-builtins.ts` still imports `registerBuiltin` from `@rifty/runtime-js` — that's a forward-direction wiring call from a higher-layer side-effect entrypoint (consumed by `apps/playground` to plug `net` into runtime-js's loader registry), not a reverse import of primitives.
- `child_process` synchronous fallback (`execSync`) keeps the legacy in-realm `new Function` path; the proper SAB-Atomics route is ADR-0011's scope.
