# ADR 0012: `@riftydev/io` owns shared primitives; `@riftydev/kernel` owns processes

Status: Implemented (2026-05-25)
Date: 2026-05

> TL;DR: `@riftydev/io` owns shared primitives (`EventEmitter`/`Buffer`/streams), `kernel.ProcessManager` owns PID allocation; `net` imports from `io`, not `runtime-js`

## Context

`io` and `kernel` are near-empty skeletons. Shared Node primitives — `EventEmitter`, `Buffer`, the stream classes (`Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`), `NotImplementedError` — live in `packages/runtime-js/src/builtins/` and are imported from there. `net` imports `EventEmitter` from `@riftydev/runtime-js`, inverting the layering in `PROJECT_PLAN.md` §2 (`net` should depend on `io`, not `runtime-js`).

REVIEW_ACTIONS A-003 (skeleton packages) and A-014 (reverse import `net → runtime-js`) are the same problem. ADR 0011 assumes `kernel.ProcessManager` is the registry behind `child_process` and `worker_threads`, but that registry has no implementation.

## Decision

Promote `io` to the shared-primitives layer; commit `kernel` to the process layer.

- Move `EventEmitter`, `Buffer`, `NotImplementedError`, and the stream classes into `packages/io/src/`.
- `runtime-js` re-exports them via its `node:` builtins: `builtins/{events,buffer,stream}.ts` become thin re-export modules bridging the registry to the `io` sources.
- `net` imports primitives directly from `@riftydev/io`; the `@riftydev/runtime-js/builtins/...` imports disappear.
- `kernel.ProcessManager` becomes the registry for `child_process`, `worker_threads`, and ADR 0011's `kernel.spawn`. PID allocation unifies: today `child_process` (1000+) and `worker_threads` (2+) hold separate counters; both move to one `kernel` allocator.
- No new external dependencies; all moves are within the workspace.

## Consequences

- Layer diagram becomes truthful: `vfs → kernel → runtime-* → net → ...` with `io` as a shared peer of `kernel`; `pnpm check:deps` regains meaning.
- A-014 auto-resolves.
- ADR 0011's `kernel.spawn` gets a concrete home in `kernel.ProcessManager`.
- Negative: ~30 file moves across 4 packages with import-path churn in every consumer — mechanical but tree-wide.
- Negative: `runtime-js`'s public surface shrinks (primitives no longer re-exported from `builtins/events`, etc.). In-repo consumers updated as part of the move; external consumers not yet a concern.
- Follow-up: implementation lands in M11, ideally before ADR 0011's `kernel.spawn` work to keep the import graph linear.

## Acceptance criteria for the deferred implementation

- [x] `pnpm check:deps` shows `net → io` and `runtime-js → io`, no path from `io`/`kernel` back to `runtime-js`. (`packages/kernel/src`, `packages/io/src` have zero `@riftydev/runtime-js` imports.)
- [x] `runtime-js` no longer exports `EventEmitter` as source of truth from any subpath; only the re-exporting `node:events` adapter remains. (`builtins/{events,buffer,stream}.ts` are now ~10-line re-exports over `@riftydev/io`.)
- [~] `child_process.spawn` and `worker_threads.Worker` allocate PIDs from a single `ProcessManager` counter. **`child_process.spawn` is wired** — `ChildProcess.pid`, `exitCode`, `signalCode`, `cwd` come from `globalProcessManager.spawn(...)`. `worker_threads.Worker` still uses its own counter, pending the ADR-0011 worker-as-process migration that consolidates Worker allocation through the same path.
- [x] No package outside `apps/playground/**` imports `solid-js` (unchanged from D-002; `pnpm check:isolation` clean).

### Implementation notes (2026-05-25)

- Stream classes split across `packages/io/src/streams/{readable,writable,duplex,transform,pass-through,pipeline,index}.ts` to stay under the ADR-0024 line budget; the EXCEPTIONS entry for `packages/runtime-js/src/builtins/stream.ts` (now a shim) is removed.
- `packages/runtime-js/src/builtins/buffer.ts` also drops from EXCEPTIONS; Buffer now lives in `packages/io/src/buffer{,-codec,-methods}.ts`, each ≤ 260 lines.
- `packages/net/src/{http,net,ws}.ts` import primitives from `@riftydev/io` directly. `packages/net/src/register-builtins.ts` still imports `registerBuiltin` from `@riftydev/runtime-js` — a forward-direction wiring call from a higher-layer side-effect entrypoint (used by `apps/playground` to plug `net` into runtime-js's loader registry), not a reverse import of primitives.
- `child_process` synchronous fallback (`execSync`) keeps the legacy in-realm `new Function` path; the proper SAB-Atomics route is ADR-0011's scope.

> **Correction 2026-07-26 (ADR-0326):** the promised unified ProcessManager
> registry is owner-wide, not one independent registry per Worker realm.
> Nested managers retain direct physical-Worker ownership but proxy process
> identity/tree transitions to the owner-root kernel authority. `threadId`
> remains distinct from Node process PID.
