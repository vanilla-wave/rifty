# Changelog

## [Unreleased]

### Added

- Host-side `spawnRuntime` controller + Worker entry that evaluates code and streams `stdout`/`stderr`/`error` events. `reset()` terminates and respawns the Worker.
- Console capture: replaces `console.log/info/debug/warn/error/dir/trace` with sinks that serialise non-primitives via a Node-style inspector.
- `detectCapabilities()` checks for `crossOriginIsolated`, `SharedArrayBuffer`, `Atomics.waitAsync`, and OPFS sync handle.
- Module loader (`createModuleLoader`):
  - Shared Node resolver: walk-up `node_modules`, `package.json` `main`/`exports`/`imports`, conditional exports (`node`/`default`/`import`/`require`), extension fallbacks, directory `index.js`/`index.mjs`.
  - CJS loader (`new Function('module','exports','require',...)`) with cycle support via the half-populated `module.exports` pattern.
  - ESM loader: `es-module-lexer` for fast scanning, transform to async-function form, top-level await, live bindings via getters on the module namespace, dynamic `import()`, cycle support.
  - CJS ↔ ESM interop: ESM importing CJS through a `default` + namespace wrapper, CJS loading ESM only via async `import()`.
- Conformance tests (resolution, cycles, live bindings, interop) and integration test fixtures (`lodash` CJS, `nanoid` ESM).
- **M10:** `fs.watch` / `fs.watchFile` / `fs.unwatchFile` (polling-based). Watcher emits Node-compatible `'rename'` / `'change'` events; directory watches report changed filename; abort via `AbortSignal`; idle interval doesn't fire. New `./builtins/fs-watch` subpath export. 8 conformance tests.
- **M10:** `RuntimeController.writeFile(path, content)` for editor↔VFS sync (used by the playground's Dev Mode).
- **ADR-0012:** `builtins/{events,buffer,stream}.ts` became thin re-export shims over `@rifty/io` — the primitives now live in `@rifty/io`. `builtins/child_process.ts` allocates PIDs via `@rifty/kernel.globalProcessManager.spawn(...)` so `ChildProcess.pid`, `exitCode`, `signalCode`, and `cwd` (ADR-0019) come from the kernel record. Added `@rifty/kernel` as a direct dependency.
- **ADR-0011 phase 2:** `builtins/child_process.ts` (and `fork`) now branches on `isSabIpcSupported() && getKernelWorkerUrl()` — when both hold it routes through `globalProcessManager.spawnWorker(...)` (real Web Worker realm) via the new `builtins/child_process-worker.ts` helper, which builds a `SpawnWorkerSpec` from the script bytes in `syncMirror()` and pumps the worker's stdout/stderr `MessagePort`s into the existing `Readable`s. Non-`node` commands and the SAB-less fallback path keep the existing in-realm `execScript` behaviour (marked `// fallback per ADR-0011`). `execSync` stays in-realm — true sync blocking is phase 3. `builtins/worker_threads.Worker` carries the same branching: `startViaKernel()` for the SAB path, `startSameRealm()` for the fallback. 2 new conformance tests (`tests/conformance/builtins/child_process-worker.test.ts`, skip in Node-without-isolation).
- **ADR-0011 phase 3:** `builtins/child_process-sync.ts` houses the new `execSync` body. When `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]` (i.e. we are inside a kernel-spawned Worker) it delegates to the global hook `__riftyKernelSyncCall('execSync', { cmd, opts })`, decoding the parent dispatcher's stdout reply as a UTF-8 `Buffer`. The hook itself is installed by `@rifty/kernel`'s `worker-entry.ts` and backed by a `SyncRpcClient` that `Atomics.wait`s on the SAB reply slot — this is the first path that truly blocks the calling realm. Outside a kernel Worker (no hook, no isolation, or main realm) the function falls back to the existing in-realm `new Function(...)` evaluation, marked `// fallback per ADR-0011 phases 2/3`. The 5 existing `child_process` conformance tests cover that fallback. A new skip-by-default suite under `tests/conformance/builtins/exec-sync-worker.test.ts` documents the SAB contract for the browser e2e harness. `builtins/child_process.ts` re-exports `execSync` from the new module so the public Node-shape surface is unchanged. The same file also calls `setExecSyncScriptResolver` at import time so the kernel's default `execSync` handler can read scripts from this realm's `syncMirror()` without taking a runtime dependency on `@rifty/vfs`.

### Changed

- **ESM loader** now uses an **AST-based transformer** (`acorn` + scope-tracking walker) instead of the regex / zone-scanner approach. Scope-aware rewriting fixes parameter-shadowing of imported bindings, which previously broke real Vite's pre-bundled deps (e.g. `dep-BK3b2jBa.js` with `function format(win32, …)`). See ADR 0009. Adds `acorn` and `acorn-walk` to dependencies; removes `module-loader/source-scanner.ts`.
