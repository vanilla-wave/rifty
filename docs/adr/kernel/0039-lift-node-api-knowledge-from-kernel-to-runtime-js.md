# ADR 0039: Lift Node-API knowledge from kernel to runtime-js

Status: Accepted
Date: 2026-05

> TL;DR: Node-API surface (`process` shim, `execSync`) leaves `kernel` for `runtime-js`; kernel publishes a typed `ProcessSpec` on `globalThis` + a pre-entry hook

## Context

The 2026-05-26 kernel architecture audit found three symptoms of one root cause: `@riftydev/kernel` carried Node-runtime-shape knowledge that belongs one layer up in `@riftydev/runtime-js`. The kernel was therefore unusable outside a Node-style host — any consumer wanting a different process abstraction (or no `execSync`) still imported the Node shim and `'execSync'` handler unconditionally.

- **P0-1. Node-shape `process` shim in the kernel.** `packages/kernel/src/worker-entry.ts` defined `ProcessShim` (`pid`/`ppid`/`argv`/`env`/`cwd()`/`stdout`/`stderr`/`exit()`) — a Node API surface inside a runtime-agnostic layer. Its TSDoc admitted it: *"Phase 2's runtime-js layer will replace this with the full builtin."*
- **P0-2. `'execSync'` + `node <script>` parsing in the kernel.** `packages/kernel/src/ipc/default-handlers.ts` registered an `'execSync'` handler that did `cmd.split(/\s+/)`, rejected non-`node <script>`, base64-loaded the script via a caller-supplied resolver, and ran it in a recursive Worker — i.e. the inside of `child_process.execSync`.
- **P1-2. Late-binding cycle between `spawn-worker.ts` and the dispatcher.** `spawn-worker.ts` called `setKernelRecursiveSpawn(spawnKernelWorker)` at module load to break a static import cycle caused by the `execSync` recursive runner. That cycle existed only because the runner lived in the kernel.

## Decision

Move the Node-API surface out of `@riftydev/kernel` into `@riftydev/runtime-js`:

- `installProcessShim` + the `ProcessShim` interface move from `packages/kernel/src/worker-entry.ts` to a new module `packages/runtime-js/src/ipc/install-process.ts` as `installNodeProcessShim(spec)`.
- The kernel bootstrap publishes a typed `ProcessSpec` on a documented `globalThis` key (`__riftyProcessSpec__`) via `publishKernelProcessSpec`/`readKernelProcessSpec` in `packages/kernel/src/shared-globals.ts`. The kernel never touches `globalThis.process`.
- Higher layers consume `ProcessSpec`: `runtime-js` builds a Node-shape shim; `runtime-wasi` reads the spec into a WASI-shaped `process` proxy (`packages/runtime-wasi/src/worker-entry.ts`).
- `default-handlers.ts`, `script-resolver.ts`, `recursive-runner.ts` move from `packages/kernel/src/ipc/` into `packages/runtime-js/src/ipc/handlers.ts` and `packages/runtime-js/src/ipc/recursive-runner.ts`. The script resolver collapses into the handlers module (its only consumer was the runtime-js execSync handler).
- The kernel exposes a *pre-entry hook* `setKernelPreEntryHook(fn)` on `worker-entry.ts`, called immediately after publishing `ProcessSpec` and before running the user entry. `runtime-js` registers `installNodeProcessShim` through it so `kind: 'source'` scripts still see `globalThis.process`.
- `kernel-dispatcher.ts` becomes a thin generic singleton: `getKernelDispatcher()` returns an empty `SyncRpcDispatcher` with no pre-registered handlers. `setKernelRecursiveSpawn` is deleted — the recursive runner now lives in `runtime-js` and imports `spawnKernelWorker` from `@riftydev/kernel` directly (top-down, layer-clean).
- The host kernel-worker chunk (`apps/playground/src/workers/kernel-worker-entry.ts`) composes both modules so the spawned worker is wired before user code: `import '@riftydev/runtime-js/install-process'; import '@riftydev/kernel/worker-entry';`.
- `child_process.execSync` (in `runtime-js`) registers the `'execSync'` handler via the same install hook, collapsing the previous `setExecSyncScriptResolver` module-load side-effect into a single explicit `dispatcher.register('execSync', ...)`.

## Consequences

- **Positive — kernel runtime-agnostic.** `@riftydev/kernel` no longer knows Node `process` shape, `execSync` semantics, or script-path resolution. A non-Node embedder installs whatever process model fits (runtime-wasi worker entry is the worked example: WASI guests get a minimal proxy from `ProcessSpec`, no Node shape).
- **Positive — late-binding cycle closed.** `setKernelRecursiveSpawn` gone; the runtime-js recursive runner statically imports `spawnKernelWorker` from `@riftydev/kernel`. No module-load handshake, no static cycle.
- **Negative — hosts compose two boot side-effects.** The kernel-worker chunk previously imported only `@riftydev/kernel/worker-entry`. Hosts spawning Node-style children must now also import the runtime-js installer to wire `installNodeProcessShim` into the pre-entry hook. Documented in `packages/runtime-js/README.md`; the playground chunk grows one import line.
- **Negative — public surface trim is breaking.** `@riftydev/kernel` no longer exports `installProcessShim`, `ProcessShim`, `setKernelRecursiveSpawn`, `setExecSyncScriptResolver`, `registerDefaultHandlers`, `ScriptResolver`, `RecursiveWorkerRunner`, `DefaultHandlerOptions`, `ExecSyncPayload`. Callers import from `@riftydev/runtime-js/install-process` instead. Only external caller in-repo was `child_process.ts`, updated in the same commit. CHANGELOG records the removals.
- **Out of scope (P1 follow-ups).** Unifying `WorkerHandle.send` (still a loud-throw stub for fork-mode IPC, ADR-0011 P2 follow-up), the `stdio` port abstraction lift (P1-1), and `process.env.RIFTY_FALLBACK_NO_SAB` indirection (P2-2) all remain. This ADR addresses only the P0 Node-API leak and the P1-2 cycle from it.

## References

- 2026-05-26 kernel architecture audit (P0-1, P0-2, P1-2).
- ADR 0011 — kernel spawn pipeline and the recursive-spawn handshake this ADR closes.
- ADR 0019 — `cwd` ownership on `ProcessRecord`; `ProcessSpec.cwd` is the same field, propagated unchanged.
- ADR 0024 / ADR 0033 — file-size budget context (new `runtime-js/src/ipc/*` files stay within per-file budget; `runtime-js/src/builtins/child_process.ts` does not grow).
