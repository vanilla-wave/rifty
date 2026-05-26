# Changelog

## [Unreleased]

### Added

- **ADR-0039 — Node-API knowledge moved here from `@rifty/kernel`.** Three
  new modules under `src/ipc/`:
  - `install-process.ts` — `installNodeProcessShim(spec)` builds the
    Node-shape `process` global from the kernel's `KernelProcessSpec`
    (pid/ppid/argv/env/cwd/stdout/stderr/exit). Module-load side-effect
    registers itself as the kernel's pre-entry hook (via
    `setKernelPreEntryHook`), so host chunks that import this module
    before `@rifty/kernel/worker-entry` get the wiring for free. Exposed
    via the new `@rifty/runtime-js/install-process` subpath export.
  - `handlers.ts` — `installRuntimeJsExecSyncHandler(dispatcher, resolveScript)`
    registers the `'execSync'` handler on the kernel dispatcher: parses
    `node <script>` command lines, resolves bytes from the runtime-js VFS
    sync mirror, dispatches to the recursive runner, decodes stdout.
    Exports `ExecSyncPayload`, `ScriptResolver`, and
    `InstallRuntimeJsExecSyncOptions`. 7 new unit tests in
    `handlers.test.ts` cover EUNSUPPORTED / ENOENT / happy path / child
    failure / cwd+env propagation / payload coercion.
  - `recursive-runner.ts` — `makeRecursiveRunner()` returns a runner that
    spawns a fresh kernel Worker per `execSync` invocation, captures its
    stdout, and resolves once the child exits. Statically imports
    `spawnKernelWorker` from `@rifty/kernel` (top-down, no late binding —
    closes the previous module-load handshake the kernel needed for
    `setKernelRecursiveSpawn`).
- **`builtins/child_process.ts` boot wiring.** Module-load side-effect
  now reads `getKernelDispatcher()` and calls
  `installRuntimeJsExecSyncHandler(...)` with a VFS-backed resolver. The
  previous `setExecSyncScriptResolver(...)` call is gone (and the helper
  itself was deleted from the kernel — see ADR-0039).

### Changed

- **ADR-0035: builtin registry sourced from `@rifty/io`.** The
  `name → factory` cache that backs `node:<name>` lookups
  (`registerBuiltin`, `loadBuiltin`, `isBuiltinSpecifier`, `listBuiltins`,
  `BuiltinFactory`) now lives in `@rifty/io`. The top-level public
  re-exports from `@rifty/runtime-js`'s `src/index.ts` are unchanged;
  `src/builtins/index.ts` re-exports the surface from `@rifty/io` so
  internal callers (`module-loader/loader.ts`, `module-loader/resolver.ts`,
  `builtins/module.ts`) keep their existing import paths. The internal
  module `src/builtins/registry.ts` is deleted (was not on the
  subpath-exports list, so no public path is broken). See ADR-0035 for
  the rationale.

- **ADR-0034 (D-B):** the re-exported `node:stream` surface from `@rifty/io`
  (via `src/builtins/stream.ts` shim) now matches Node's documented
  contract — `_readableState`/`_writableState` containers, `Readable.read(n)`
  honours `n`, `Writable.destroy` cancels in-flight queue, `Duplex`/`Transform`
  methods on the prototype (no per-instance rebinding), `pipeline()` destroys
  upstream on error. No source change in this package — the shim re-exports
  unchanged. Listed here so consumers of `@rifty/runtime-js/builtins/stream`
  can find the breaking-contract-restoration note from their own changelog.
  See `packages/io/CHANGELOG.md` and ADR-0034 for details.

### Added

- **Worker-globals owner table.** New internal module `src/internal/worker-globals.ts` consolidates the ad-hoc `globalThis` / `self` writes (`__riftyEsmStash`, `__riftyLastEsmBody`, `__riftyLastEsmFile`, plus the `__setCreateRequireImpl` closure, plus `require`/`__riftyImport` on `self`) under one typed publish/read/unpublish API rooted at `globalThis.__rifty.*`. Mirrors kernel's `shared-globals.ts` pattern; sub-namespace keeps the M11 A-026 multi-realm story collision-free against the kernel-owned flat `__riftyKernel*` keys. Closes the "Ungoverned globals" Tier 2 #10 finding from the 2026-05-26 architecture review. 17 unit tests cover publish/read roundtrip per documented key, unpublish cleanup, and isolation from kernel-owned flat keys.
- **D-E granular module invalidation.** `ModuleRegistry.invalidate(id?)` and `ModuleLoader.invalidate(id?)` — full reset with no `id`, single-entry drop with an absolute id (future HMR hook). `worker-entry`'s `load-fixture` handler now calls `loader.invalidate()` instead of rebuilding the loader, so the resolver and REPL bindings survive editor saves (was Tier 1 #4 in the 2026-05-26 architecture review).

### Removed

- **ADR-0037: parallel `SyncVfs` / `MemorySyncVfs` deleted.** The module loader (`createModuleLoader`, `createResolver`) now consumes `@rifty/vfs:FsSync` directly; the loader-local `SyncVfs` interface (`module-loader/vfs-sync.ts`) and the hand-rolled `MemorySyncVfs` backend (`module-loader/memory-sync-vfs.ts`) are removed, along with the corresponding `MemorySyncVfs` / `SyncVfs` re-exports on `@rifty/runtime-js/loader`. Inside the runtime Worker, `worker-entry.ts` now mints one `MemoryFsSync` (via `createMemoryFs()`), publishes it via `setSyncMirror(...)`, and feeds it to the loader — so `load-fixture`, `fs.readFileSync`, WASI preopens, and module resolution all reach the same `MemoryBackend` (ADR-0014's promise, finally redeemed for the Worker realm). Callers (tests, parity runner, playground adapter) construct `new MemoryFsSync()` from `@rifty/vfs/internal` and feed it to the loader; the playground's `realVite.ts` adapter drops its hand-rolled `makeSyncVfs()` wrapper and passes `syncMirror()` directly. Public API change for `@rifty/runtime-js/loader` — see ADR-0037.

### Fixed

- `readline.cursorTo` / `clearLine` / `clearScreenDown` / `emitKeypressEvents` now throw `NotImplementedError` instead of silently no-op'ing (no-silent-stubs).
- `perf_hooks.PerformanceObserver.observe` now throws `NotImplementedError('perf_hooks.PerformanceObserver.observe')` instead of silently no-op'ing. The constructor stays callable so defensive top-level `new PerformanceObserver(...)` (Vite, etc.) doesn't blow up at module load — mirrors ADR-0010's import-time-OK / use-time-loud pattern.

### Added

- **ADR-0019 host-eval cwd wiring.** `RuntimeController.eval(code, { cwd })` now propagates the cwd to the Worker via `EvalRequest.cwd`; the Worker bootstrap calls `setProcessCwd(req.cwd)` before running user code, so `process.cwd()` reflects the host-supplied value. New exported type `EvalOptions`. Conformance: a new case in `tests/conformance/builtins/process-cwd.test.ts` covers the inherited-cwd path.
- **Sync globals via typed reader.** `builtins/child_process-sync.ts` calls `readKernelSyncApi()` instead of indexing `globalThis[KERNEL_SYNC_CALL_KEY]`; the legacy untyped accessor has been removed.

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
- **ADR-0029:** `fs.utimesSync(path, atime, mtime)` and `fs.promises.utimes` route through `syncMirror().utimes`. Accepts numeric seconds or `Date` per Node semantics; mtime stored in ms.
- **ADR-0012:** `builtins/{events,buffer,stream}.ts` became thin re-export shims over `@rifty/io` — the primitives now live in `@rifty/io`. `builtins/child_process.ts` allocates PIDs via `@rifty/kernel.globalProcessManager.spawn(...)` so `ChildProcess.pid`, `exitCode`, `signalCode`, and `cwd` (ADR-0019) come from the kernel record. Added `@rifty/kernel` as a direct dependency.
- **ADR-0011 phase 2:** `builtins/child_process.ts` (and `fork`) now branches on `isSabIpcSupported() && getKernelWorkerUrl()` — when both hold it routes through `globalProcessManager.spawnWorker(...)` (real Web Worker realm) via the new `builtins/child_process-worker.ts` helper, which builds a `SpawnWorkerSpec` from the script bytes in `syncMirror()` and pumps the worker's stdout/stderr `MessagePort`s into the existing `Readable`s. Non-`node` commands and the SAB-less fallback path keep the existing in-realm `execScript` behaviour (marked `// fallback per ADR-0011`). `execSync` stays in-realm — true sync blocking is phase 3. `builtins/worker_threads.Worker` carries the same branching: `startViaKernel()` for the SAB path, `startSameRealm()` for the fallback. 2 new conformance tests (`tests/conformance/builtins/child_process-worker.test.ts`, skip in Node-without-isolation).
- **ADR-0011 phase 3:** `builtins/child_process-sync.ts` houses the new `execSync` body. When `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]` (i.e. we are inside a kernel-spawned Worker) it delegates to the global hook `__riftyKernelSyncCall('execSync', { cmd, opts })`, decoding the parent dispatcher's stdout reply as a UTF-8 `Buffer`. The hook itself is installed by `@rifty/kernel`'s `worker-entry.ts` and backed by a `SyncRpcClient` that `Atomics.wait`s on the SAB reply slot — this is the first path that truly blocks the calling realm. Outside a kernel Worker (no hook, no isolation, or main realm) the function falls back to the existing in-realm `new Function(...)` evaluation, marked `// fallback per ADR-0011 phases 2/3`. The 5 existing `child_process` conformance tests cover that fallback. A new skip-by-default suite under `tests/conformance/builtins/exec-sync-worker.test.ts` documents the SAB contract for the browser e2e harness. `builtins/child_process.ts` re-exports `execSync` from the new module so the public Node-shape surface is unchanged. The same file also calls `setExecSyncScriptResolver` at import time so the kernel's default `execSync` handler can read scripts from this realm's `syncMirror()` without taking a runtime dependency on `@rifty/vfs`.

### Changed

- **ESM loader** now uses an **AST-based transformer** (`acorn` + scope-tracking walker) instead of the regex / zone-scanner approach. Scope-aware rewriting fixes parameter-shadowing of imported bindings, which previously broke real Vite's pre-bundled deps (e.g. `dep-BK3b2jBa.js` with `function format(win32, …)`). See ADR 0009. Adds `acorn` and `acorn-walk` to dependencies; removes `module-loader/source-scanner.ts`.
