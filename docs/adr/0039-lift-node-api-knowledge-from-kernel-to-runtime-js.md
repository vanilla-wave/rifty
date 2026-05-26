# ADR 0039: Lift Node-API knowledge from kernel to runtime-js

Status: Accepted
Date: 2026-05

## Context

The 2026-05-26 kernel architecture audit surfaced three findings that are all
symptoms of the same root cause: `@rifty/kernel` carried knowledge of the
Node runtime shape that should live one layer up in `@rifty/runtime-js`.

- **P0-1. Node-shape `process` shim inside the kernel.** The kernel's worker
  bootstrap (`packages/kernel/src/worker-entry.ts`) defined a `ProcessShim`
  with `pid` / `ppid` / `argv` / `env` / `cwd()` / `stdout` / `stderr` /
  `exit()`. That is a Node API surface, declared deep inside a layer that is
  meant to be runtime-agnostic. The shim's own TSDoc admitted as much:
  *"Phase 2's runtime-js layer will replace this with the full builtin."*
- **P0-2. `'execSync'` semantics + `node <script>` parsing in the kernel.**
  `packages/kernel/src/ipc/default-handlers.ts` registered an `'execSync'`
  handler that knew how to parse `cmd.split(/\s+/)`, rejected anything that
  wasn't `node <script>`, base64-loaded the script from a caller-supplied
  resolver and ran it in a recursive Worker. None of that is a kernel
  concern — it is the inside of `child_process.execSync`.
- **P1-2. Late-binding cycle between `spawn-worker.ts` and the dispatcher.**
  `spawn-worker.ts` registered itself with the dispatcher at module load via
  `setKernelRecursiveSpawn(spawnKernelWorker)` to break a static import cycle
  caused by the `execSync` recursive runner. That cycle existed only because
  the runner lived in the kernel.

The result was a kernel that could not be reused outside a Node-style host:
any consumer that wanted a different process abstraction (or that did not
need `execSync` at all) still imported the Node shim and the `'execSync'`
handler unconditionally.

## Decision

Move the Node-API surface out of `@rifty/kernel` into `@rifty/runtime-js`:

- `installProcessShim` and the internal `ProcessShim` interface (Node-shape
  `process` global) move from `packages/kernel/src/worker-entry.ts` to a new
  module `packages/runtime-js/src/ipc/install-process.ts` as
  `installNodeProcessShim(spec)`.
- The kernel's worker bootstrap publishes a typed `ProcessSpec` on a
  documented `globalThis` key (`__riftyProcessSpec__`) via
  `publishKernelProcessSpec` / `readKernelProcessSpec` in
  `packages/kernel/src/shared-globals.ts`. The kernel itself never touches
  `globalThis.process`.
- Higher layers consume `ProcessSpec` to build whatever process abstraction
  they need: `runtime-js` builds a Node-shape shim, `runtime-wasi` reads the
  spec directly into a WASI-shaped `process` proxy (see
  `packages/runtime-wasi/src/worker-entry.ts`).
- `default-handlers.ts`, `script-resolver.ts`, and `recursive-runner.ts`
  move from `packages/kernel/src/ipc/` into
  `packages/runtime-js/src/ipc/handlers.ts` and
  `packages/runtime-js/src/ipc/recursive-runner.ts`. The script resolver
  collapses into the same handlers module (its only consumer was the
  runtime-js execSync handler).
- The kernel exposes a *pre-entry hook* the host may register on
  `worker-entry.ts`: `setKernelPreEntryHook(fn)`. The kernel calls the hook
  immediately after publishing `ProcessSpec` and immediately before running
  the user's entry. `runtime-js` registers `installNodeProcessShim` through
  this hook so user scripts of `kind: 'source'` still see `globalThis.process`
  when they run.
- `kernel-dispatcher.ts` becomes a thin generic singleton: `getKernelDispatcher()`
  returns an empty `SyncRpcDispatcher` and ships no pre-registered handlers.
  `setKernelRecursiveSpawn` is deleted — the recursive runner now lives in
  `runtime-js` and imports `spawnKernelWorker` from `@rifty/kernel` directly
  (top-down, layer-clean).
- The host's kernel-worker chunk
  (`apps/playground/src/workers/kernel-worker-entry.ts`) composes the
  kernel bootstrap with the runtime-js installer module so the kernel-spawned
  worker is fully wired before user code runs:
  `import '@rifty/runtime-js/install-process'; import '@rifty/kernel/worker-entry';`.
- `child_process.execSync` (in `runtime-js`) registers the `'execSync'`
  handler on the kernel dispatcher at module load via the same install hook,
  so the previous `setExecSyncScriptResolver` module-load side-effect
  collapses into a single explicit `dispatcher.register('execSync', ...)`.

## Consequences

- **Positive — kernel becomes runtime-agnostic.** `@rifty/kernel` no longer
  knows what a Node `process` looks like, what `execSync` means, or how to
  resolve a script path. A non-Node embedder can take the kernel as-is and
  install whatever process model fits their runtime (the runtime-wasi
  worker entry is a worked example: WASI guests get a minimal proxy
  derived from `ProcessSpec`, no Node shape at all).
- **Positive — late-binding cycle closed.** `setKernelRecursiveSpawn` is
  gone. The recursive runner in `runtime-js` statically imports
  `spawnKernelWorker` from `@rifty/kernel`. No more module-load handshake;
  the dependency graph is top-down and the static cycle that the original
  split worked around no longer exists.
- **Negative — hosts must compose two boot side-effects.** The kernel-worker
  chunk previously imported `@rifty/kernel/worker-entry` only. Hosts that
  spawn Node-style children must now also import the runtime-js installer
  module to get `installNodeProcessShim` wired into the pre-entry hook.
  Documented in `packages/runtime-js/README.md`; the playground's existing
  `kernel-worker-entry.ts` chunk grows one import line.
- **Negative — public surface trim is breaking.** `@rifty/kernel` no longer
  exports `installProcessShim`, `ProcessShim`, `setKernelRecursiveSpawn`,
  `setExecSyncScriptResolver`, `registerDefaultHandlers`, `ScriptResolver`,
  `RecursiveWorkerRunner`, `DefaultHandlerOptions`, or `ExecSyncPayload`.
  Callers that imported these from `@rifty/kernel` now import from
  `@rifty/runtime-js/install-process` instead. Within this repo, the only
  external caller was `child_process.ts`; updated in the same commit. The
  matching CHANGELOG entries record the removals.
- **Out of scope (P1 follow-ups).** Unifying `WorkerHandle.send` (still a
  loud-throw stub for fork-mode IPC, ADR-0011 P2 follow-up), the
  `stdio` port abstraction lift flagged as P1-1 in the audit, and
  `process.env.RIFTY_FALLBACK_NO_SAB` indirection (P2-2) all remain. This
  ADR addresses only the P0 Node-API leak and the P1-2 cycle that fell out
  of it.

## References

- 2026-05-26 kernel architecture audit (findings P0-1, P0-2, P1-2).
- ADR 0011 — kernel spawn pipeline and the recursive-spawn handshake this
  ADR closes.
- ADR 0019 — `cwd` ownership on `ProcessRecord`; `ProcessSpec.cwd` is the
  same field, propagated unchanged.
- ADR 0024 / ADR 0033 — file-size budget context (the new
  `runtime-js/src/ipc/*` files stay within the per-file working budget;
  `runtime-js/src/builtins/child_process.ts` does not grow).
