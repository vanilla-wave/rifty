# Changelog

## [Unreleased]

### Added

- **`ModuleLoaderOptions` gains `workspace?` + `transformSource?`; new
  `TransformSourceHook` type (ADR-0052, feature-02 T2).** Additive optional
  public-API fields on the `@rifty/runtime-js/loader` surface. `transformSource`
  is an injected per-file source transform
  (`{ source, id, loader: 'ts'|'tsx'|'jsx', workspace } => Promise<string>`,
  the load-bearing contract) invoked for every `.ts`/`.tsx`/`.jsx` module on the
  ESM execute path BEFORE the AST rewriter parses it; `workspace` (defaults to
  `cwd`) is the esbuild guest cwd/preopen threaded into each call. The loader
  gains zero new package import edges — the caller injects the closure (the same
  DI seam the WASI esbuild binding uses for `runWasi`). When no hook is
  configured the source passes through unchanged (no behaviour change for
  plain-JS loaders). Unit: `loader-transform.test.ts`.

- **`.ts`/`.tsx`/`.jsx` reached with no `transformSource` now throws a directed
  error on the ESM execute path (ADR-0052, feature-02 T3).** `executeEsm`
  previously deferred the no-hook case, letting raw TS fall through to acorn and
  die with an opaque `SYNTAX_ERROR` (`Unexpected token`). It now throws a
  `ModuleLoadError('SYNTAX_ERROR', …)` whose message is
  `TS transform not configured for <id>: …` BEFORE the AST rewriter parses the
  source — honest, no silent stub. The happy path (hook present) and plain-JS
  modules are unchanged. Unit: `esm.test.ts`.

- **`require()` of a `.ts`/`.tsx` module (CJS scope) throws a directed
  `NotImplementedError`, never silently `new Function`s raw TS (ADR-0052 D1
  alt-C, feature-02 T4).** `executeCjs` previously fed any `.ts`/`.tsx` that
  classified as CJS (a non-`type:module` scope) straight to `new Function`,
  dying with an opaque `SyntaxError: Unexpected token`. It now throws
  `NotImplementedError('module-loader.ts-via-require')` BEFORE touching the
  registry (so repeated `require()` calls throw idempotently rather than the
  second returning a stale loading record): the esbuild type-strip is async and
  a synchronous `require()` cannot await it, so `.ts` is only loadable as ESM via
  `import()` under a `type:module` scope. JSON and plain-JS CJS are unchanged.
  Registered in `docs/compat/modules.md` as not-supported. Unit:
  `loader-transform.test.ts`.

- **`.ts`/`.tsx` are first-class resolvable + ESM module extensions (ADR-0053).**
  The resolver now adds `.ts`,`.tsx` to `DEFAULT_EXTENSIONS`/`INDEX_FILES` —
  AFTER the `.js` family (so plain-Node packages shipping `foo.js`, or both
  `foo.js` and `foo.ts`, resolve byte-identically to Node) and before `.json`;
  `detectKind` classifies a `.ts`/`.tsx` as `esm` under a `type:module` scope,
  else `cjs` (mirroring the `.js` branch). This is a deliberate, scoped
  deviation from Node resolution (Node never resolves bare `.ts`), required for
  the opencode `.ts` graph (M12). Resolve-side only — a `.ts` that resolves with
  no transform hook still throws a directed error at execute time (transform
  side is feature-02 T2/T3). Conformance:
  `tests/conformance/modules/resolver.test.ts` `describe('TS extension
  resolution')`.

### Fixed

- **Resolver excludes `*.d.ts`/`.d.cts`/`.d.mts` from candidate matching
  (review.md correctness-MAJOR, feature-02 F02-DTS-EXCLUDE, ADR-0053).** When
  `.ts`/`.tsx` joined `DEFAULT_EXTENSIONS`/`INDEX_FILES` there was no declaration
  -file exclusion, so a target shipping only a `.d.ts` resolved it: a relative
  `./foo.d` matched `foo.d.ts` (`${base}.ts`), an explicit `./foo.d.ts` matched
  via the `st.isFile` early return, and a package whose `exports`/`main` named a
  `.d.ts` handed it back — the strip-types path then fed types-only source to
  acorn and threw `SYNTAX_ERROR`. Declaration files are now rejected at every
  file-acceptance point in `resolveAsFileOrDir`/`resolveAsDirectory`, resolving
  as if the file did not exist (`MODULE_NOT_FOUND`), matching how Node's own
  strip-types loaders skip `.d.ts`. Surgical: a runnable sibling `foo.js` next to
  `foo.d.ts` still wins. Conformance:
  `tests/conformance/modules/resolver.test.ts` `describe('declaration-file
  exclusion')`.

- **`node:fs` `realpath`/`lstat` implement no-symlink semantics; `readdir`
  callback honours options (ADR-0050).** Reverses the prior loud-throw: for the
  symlink-free VFS, `lstatSync ≡ statSync` and `realpathSync` = normalise to an
  absolute path + `ENOENT` if missing (with `.native` alias); added async
  callback `lstat`/`realpath`/`access`/`readlink`/`copyFile`/`rename`; the
  callback `readdir` now accepts `(p, {withFileTypes}, cb)`. These are the
  correct POSIX semantics when no symlinks exist (a missing path still throws
  `ENOENT` — not a silent stub). Unblocks **real upstream Vite 5** — its watcher
  (chokidar/readdirp) calls these on the happy path; `vite createServer` +
  `listen` + `transformRequest` now run in-process. Regression:
  `tests/conformance/builtins/fs-realpath-readdir.test.ts`, the rewritten
  `src/builtins/fs.test.ts` contract block, and the opt-in
  `tests/integration/vite-live-run.opt-in.test.ts` (spawns
  `tests/integration/fixtures/real-vite-smoke.ts`). M12 symlink rewrite tracked
  by a `TODO(M12)` anchor in `fs.ts`.

- **`node:string_decoder` `StringDecoder` is now a callable constructor.**
  iconv-lite's `InternalDecoder` does `StringDecoder.call(this, enc)` then
  borrows `StringDecoder.prototype.write` — a class threw "cannot be invoked
  without 'new'", breaking body-parser's request decoding. Reimplemented as a
  function-style constructor (utf-8). Conformance:
  `tests/conformance/builtins/string-decoder.test.ts`.
- **`async_hooks.AsyncResource.runInAsyncScope` forwards `thisArg` + args +
  return value.** The stub called `fn()` and dropped everything; raw-body@2.5.x
  binds its completion callback through it, so `(err, buf)` were lost and
  body-parser left `req.body` as `{}`. Conformance:
  `tests/conformance/builtins/async-hooks.test.ts` (+ `http-incoming-body.test.ts`
  pins `IncomingMessage` POST-body streaming). Both found running real express@4.

### Added

- **`child_process.execSync` loud-throw replaces in-realm fallback (2026-05-27 audit item #2).** `packages/runtime-js/src/builtins/child_process-sync.ts` now throws `NotImplementedError('child_process.execSync', …)` when the SAB-Worker path is unavailable (no `crossOriginIsolated`, no kernel-worker URL, or main-realm call). The previous `new Function('__stdout_write', …)` fallback was a silent stub: no exit code, no stdio isolation, no PID, while pretending to be a child process — direct violation of CLAUDE.md "Hard rules → No silent stubs". Removed the dead `syncMirror` import. The existing `describe('child_process.execSync')` block in `tests/conformance/builtins/child_process.test.ts` is rewritten to assert the new contract (`NotImplementedError`); `tests/conformance/builtins/exec-sync-worker.test.ts` gains a parity `describe.skipIf(sabReady)` block for the non-SAB path so both branches are pinned end-to-end.

- **ADR-0045 — fork-IPC for Worker-backed children (M6).** `installNodeProcessShim`
  now installs `process.send(msg)` / `process.disconnect()` and emits
  `'message'` / `'disconnect'` on the Node shim (extends `EventEmitter`).
  The shim wires the kernel-supplied `KernelProcessSpec.stdio.ipc`
  `MessagePort`, dispatching `ipc:message` frames as `'message'` events and
  closing on `ipc:disconnect`. `ChildProcess.send` routes through
  `WorkerProcessHandle.send` for the SAB path (in-realm path keeps its
  existing `inboundIpc` bus). `ChildProcess.disconnect()` added; mirrors
  the handle's disconnect for the worker path and flips the local
  `ipcEnabled` gate for the in-realm fallback. Conformance:
  `tests/conformance/builtins/fork-ipc-worker.test.ts` (round-trip,
  auto-disconnect on exit, explicit disconnect), skipped outside
  SAB-capable environments.

### Changed

- **ADR-0041 — `fs.readdirSync({ withFileTypes: true })` no longer re-stats children.** `FsSync.readdirSync` returns `VfsDirent[]` directly, so the `withFileTypes` branch now reads `isFile`/`isDirectory` from the dirent shape instead of doing an N+1 `statSync` per child. `fs-watch.ts` and other internal callers are updated to read `.name` instead of bare strings.
- **`child_process.spawn` worker path uses `handle.stdout()` / `stderr()`.** The `wireWorkerStdio` helper is removed — the kernel `WorkerProcessHandle` now owns the `MessagePort` → `Readable` wiring (port start, push-on-message, EOF on exit). `spawnWorkerChild` no longer takes `stdout`/`stderr` args; the caller reads streams from the handle. `worker_threads.Worker` (kernel path) likewise drops its hand-rolled `ports.stdout.onmessage` setup. Follow-ups doc item #3.
- **`ChildProcess.stdin` wired through `WorkerProcessHandle.stdin()` for the SAB-Worker path.** `ChildProcess.stdin` is now a real `Writable` instead of a loud-throw struct (`{ write: never, end: never }`). For Worker-backed children, `spawnViaWorker` passes the kernel `bindPortAsWritable`-backed accessor — `child.stdin.write(chunk)` posts to the worker's stdin `MessagePort` and `child.stdin.end()` closes it. The in-realm `spawnViaSameRealm` fallback still has no worker, so its `stdin` is an `InRealmStdinUnsupported` subclass whose `write` / `end` throw `NotImplementedError` synchronously (kept loud per CLAUDE.md "no silent stubs"). Closes the M6 "Open acceptance" `ChildProcess.stdin IPC` row. Conformance: `tests/conformance/builtins/child_process-stdin.test.ts` (skipped outside SAB-capable environments — Vitest's plain Node runner — runs in the browser e2e harness). Worker-side `process.stdin` Readable wiring (so user scripts can do `process.stdin.on('data', …)`) remains a separate follow-up.

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

- Builtin registration sites in `src/builtins/index.ts` drop the
  `as unknown as Record<string, unknown>` cast on every `registerBuiltin(...)`
  call (34 sites). `BuiltinFactory` is now generic over its return type
  (see `@rifty/io` changelog), so TypeScript infers each factory's concrete
  module shape and a typo against an exported namespace becomes a
  typecheck error rather than a runtime surprise. No behaviour change. The
  remaining structural-assertion casts on `EventEmitter` (used as a
  namespace) and `globalThis` (capability probes in `env/capabilities.ts`)
  are intentional and unrelated to the registry boundary.

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
