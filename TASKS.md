# Tasks

Per-milestone task tracking with acceptance review. See `PROJECT_PLAN.md` for the original acceptance criteria.

## Verification snapshot

- **Unit + conformance + integration:** 867 passed | 16 skipped — last counted 2026-05-31 after the M12 opencode no-vendored-tree slice landed (F02 TS-on-import + transform-execution, F05 Effect↔node:http bridge, F09 tool-ceiling marker). Earlier 2026-05-29 baseline was 810 passed after the "run real express@4" pass.
- **Parity-runner:** 43 cases (assert, buffer, events, fs, http, modules incl. the gold multi-file `ts-graph-cross-file` `.ts` case, os, path, querystring, stream, url, util) compared against real Node — all match (runner spawns real `node` children; run with the sandbox disabled).
- **E2E (Playwright, Chromium):** 15 passed (M0 boot, M1 REPL+`.reset`, M2 modules, M4 fs); M10 dev-mode flow not yet covered by Playwright (verified manually).
- **Typecheck:** `tsc --noEmit` clean across workspace (16 projects).
- **Lint:** `biome check` clean on all changed files; whole-tree `biome check .` has 2 pre-existing errors in `packages/npm-client/src/installer.ts:508,511` (predate the M12 slice, tracked separately).
- **Circular deps:** none (madge).
- **D-002 isolation:** clean (no `solid-js` imports outside `apps/playground/**`).
- **Playground build:** `vite build` succeeds.

### Real bugs caught during M1–M9 verification

- Typecheck was broken (workspace-wide): reverse imports `kernel → runtime-js`, deep paths into `runtime-js/src/builtins/*` from `net` and `runtime-wasi`, missing `allowImportingTsExtensions`. Fixed by moving `sync-mirror` into `@riftydev/vfs`, exposing a `@riftydev/runtime-js/builtins` subpath export, and giving `net` a side-effect `register-builtins` module.
- Vite dev server port 5173 collided with an unrelated local project — Playwright was hitting the wrong app. Pinned `strictPort: true` on 5273.
- `path.normalize` dropped trailing slashes (vs Node).
- `fs.readFileSync(...)` didn't resolve relative paths against `process.cwd()`.
- `worker_threads.Worker`: parent→child IPC was wired to a dead event name; only child→parent worked.
- `child_process.fork`: child script had no `send` / `on('message')` / `onMessage` API.
- `node-parity-runner` was a no-op stub. Now has a real harness + 15 cases that drive real `node` child processes and diff stdouts.

### Real bugs caught running real express@4 end-to-end (Phase 1, 2026-05-29)

`tests/integration/express-live-run.opt-in.test.ts` installs express@^4 from the
live registry, loads it through the module loader, and serves real requests
through the `@riftydev/net` port registry. Getting all 5 cases green surfaced six
real defects (each fixed with a regression test):

1. **`require('stream')` wasn't callable** — `send` does `util.inherits(SendStream, require('stream'))`; the module default was a plain object. Added the legacy callable `Stream` base in `@riftydev/io`.
2. **`EventEmitter` didn't lazy-init** — express builds `app` by mixing `EventEmitter.prototype` onto a function (`merge-descriptors`); `this.listenersMap` was undefined. Moved state to lazy getters.
3. **`Buffer.allocUnsafeSlow` missing** — `safe-buffer` fell back to a shim without `isBuffer`, so `res.send` threw `Buffer.isBuffer is not a function`. Added `allocUnsafeSlow` + `isEncoding`.
4. **Semver picked next-major prereleases** — `^4` matched `5.0.0-beta.3`, so `install({express:'^4'})` resolved an express 5 beta (body-parser@2-beta + raw-body@3-beta). Added the node-semver prerelease-exclusion rule. **Highest-impact: mis-resolved any `^X` range.**
5. **`StringDecoder` wasn't callable** — iconv-lite does `StringDecoder.call(this, enc)`. Reimplemented as a function-style constructor.
6. **`AsyncResource.runInAsyncScope` dropped args** — raw-body binds its callback through it; `(err, buf)` were lost so `req.body` stayed `{}`. Now forwards `thisArg` + args + return.

---

## M0 — Foundation — DONE

- [x] `pnpm dev` boots playground at localhost.
- [x] UI shows editor (Monaco), terminal (xterm.js), Run button.
- [x] Run click starts a Worker that posts a ready message and streams `worker alive` to stdout.
- [x] Service Worker registers (visible in DevTools → Application).
- [x] COOP `same-origin` + COEP `credentialless` headers verified live (`crossOriginIsolated === true`).
- [x] CI workflows: `ci.yml` (per-PR) + `ci-cross-browser.yml` (weekly cron).
- [x] ADRs 0001–0008 cover D-001 through D-007.
- [x] `OPEN_QUESTIONS.md` + `adr:new` / `adr:promote` / `todo:adr` scripts.
- [x] `pnpm check:deps` (madge), `pnpm check:isolation` (D-002 enforcement).
- [x] Compat-matrix bootstrap (`docs/compat/modules.md`).

### Closed acceptance

- [x] **Prod COOP/COEP headers — done.** `/vercel.json` (line 5-8) emits `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` + `Cross-Origin-Resource-Policy: cross-origin` on every route. `apps/playground/public/_headers` mirrors the same triple for non-Vercel deploys (Netlify, Cloudflare Pages). Both match the dev Vite COOP/COEP triple.

## M1 — JS Execution — DONE

- [x] Worker REPL evaluates expressions and statements; `1 + 1` → `2`.
- [x] `console.log/info/debug/warn/error/dir/trace` captured, streamed; stderr is red.
- [x] Errors render with stack traces.
- [x] `.reset` terminates and respawns the Worker.
- [x] Stream output is non-blocking (postMessage-based; long loops don't freeze main thread).
- [x] Capabilities detection at boot, with UI fallback panel.

## M2 — Modules — DONE

- [x] CJS resolution: `./other.js`, `./other` (extension fallback), `./dir` (`index.js`).
- [x] Node algorithm: `node_modules` walk-up; nearer wins over farther.
- [x] `package.json` `main`, `exports` (subpaths + wildcards + conditional `node`/`default`/`import`/`require`).
- [x] ESM: static `import`, dynamic `import()`, top-level `await`.
- [x] **Live bindings** (both re-export and direct named imports).
- [x] CJS cycles (half-populated exports visible).
- [x] ESM cycles (eventual values stable).
- [x] CJS ↔ ESM interop: ESM imports CJS via `default` + named keys; `require()` of ESM throws clearly.
- [x] Integration: `lodash`-shape CJS, `nanoid`-shape ESM, `chalk`-style ANSI helper.
- [x] **Conformance: 40 test cases in 3 files** (34 resolver + 1 ESM cycle + 5 imports-field) under `tests/conformance/modules/`. Integration coverage extends through `tests/integration/real-packages.test.ts` (4 cases) and `tests/integration/builtins-via-require.test.ts` (7 cases).

## M3 — Node Core — DONE

- [x] `path` (POSIX): join, resolve, normalize, dirname, basename, extname, relative, parse/format.
- [x] `events`: `EventEmitter` with on/off/emit/once/`'error'`/snapshot semantics + `once(emitter, name)` promise variant.
- [x] `util`: `inspect`, `format` (%s/%d/%j/%o), `promisify`, `callbackify`, `deprecate`, `inherits`, `types.*`.
- [x] `querystring`: parse/stringify with arrays and percent-encoding; `escape`/`unescape`.
- [x] `url`: re-exports global `URL`/`URLSearchParams`, legacy `parse`/`format`/`resolve`, `pathToFileURL`/`fileURLToPath`.
- [x] `assert` + `assert/strict`: ok/equal/strictEqual/deepStrictEqual/throws + `AssertionError`.
- [x] `buffer`: `Buffer.from/alloc/concat/byteLength/isBuffer`, `toString('utf8'|'hex'|'base64')`, `equals`.
- [x] **process**: env, cwd, argv, platform, nextTick (drains BEFORE Promise.then via prototype patch), hrtime.
- [x] **timers**: setTimeout/setInterval/clearImmediate; `setImmediate` polyfilled via `MessageChannel`.
- [x] `node:`-prefix resolver routes built-ins; non-prefixed `'path'`, `'events'`, etc. also resolve to built-ins.
- [x] Worker entry installs `process`, `Buffer`, `setImmediate`/`clearImmediate` as globals.
- [x] **Event-loop order tests:** `nextTick` beats `Promise.then`; `setImmediate` runs after current task.
- [x] **chalk-shape integration test** passes (`chalk.red('hi') === '[31mhi[39m'`).
- [x] **73 conformance test cases in 9 files** under `tests/conformance/builtins/{path,events,util,inspect,querystring-url,assert,buffer,process-cwd,event-loop}.test.ts` + `tests/conformance/inspect.test.ts`. Backed by 48 package-level cases in `@riftydev/io` (`buffer.test.ts` 36 + `event-emitter.test.ts` 12) for a total of 121 cases covering M3-area built-ins. (The "121" historical headline reflected the combined conformance + package surface; the audit on 2026-05-27 unified the formulation as "X cases in Y files".)

## M4 — FileSystem — PARTIAL — see open acceptance below

- [x] Sync API: `readFileSync`/`writeFileSync`/`appendFileSync`/`readdirSync`(+withFileTypes)/`mkdirSync`/`statSync`/`existsSync`/`unlinkSync`/`rmSync`/`rmdirSync`/`renameSync`/`copyFileSync`.
- [x] Async callback API: readFile/writeFile/mkdir/stat/unlink/readdir.
- [x] `fs.promises`: full Promise mirror.
- [x] `mkdir({ recursive: true })` semantics.
- [x] `fs.stat` returns correct `size`, `isFile()`, `isDirectory()`.
- [x] **OPFS backend** (`OpfsVfs`) for browser Workers; Memory backend for everything else. Sync mirror seam lets us swap.
- [x] Streams: `createReadStream` / `createWriteStream` with pipe + finish.
- [x] **17 conformance test cases in 2 files** (`fs.test.ts` 15 + `fs-streams.test.ts` 2) + 72 package-level cases in `@riftydev/vfs` (`memory.test.ts` 24 + `opfs-sync.test.ts` 25 + `opfs-errors.test.ts` 17 + `path.test.ts` 6).

### Open acceptance

- [ ] OPFS persistence (write→reload round-trip in a real browser session).
- [x] **`OpfsFsSync` sync backend — done.** `packages/vfs/src/opfs-sync.ts` (~21 KB) implements the `FsSync` surface against `FileSystemSyncAccessHandle` in a Worker realm; 25 conformance cases in `packages/vfs/src/opfs-sync.test.ts` cover read/write/stat/utimes/rmdir/rename paths plus the in-memory mtime side-table ADR-0029 requires.
- [x] **Unified async + sync VFS — done.** ADR-0037 ratified one backing tree exposing both surfaces; `packages/vfs/src/sync-mirror.ts:79-83` is the seam (the async `Vfs` and sync `FsSync` share the same `MemoryBackend` map / `FileSystemDirectoryHandle`). The earlier "two trees" risk is gone.

## M5 — Streams & IO — DONE

- [x] `Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` with backpressure + drain.
- [x] Async iterators on `Readable`.
- [x] Object mode supported.
- [x] `Readable.from(iterable)`.
- [x] `pipeline(...)` and `finished(stream)`.
- [x] `node:stream` and `node:stream/promises` exposed.
- [x] **9 conformance test cases in 1 file** (`tests/conformance/builtins/stream.test.ts`) covering Readable/Writable/Duplex/Transform/PassThrough + pipeline + finished + async iterators + object mode + backpressure. fs-stream coverage lives in M4's `fs-streams.test.ts`.

## M6 — Processes — PARTIAL — see open acceptance below

- [x] `child_process.spawn('node', [script])` runs a VFS-stored JS file as a child with stdout/stderr streams.
- [x] `exec(cmd, cb)` buffers stdout/stderr.
- [x] `fork(modulePath)` returns a child with IPC. **Worker-backed path closed by ADR-0045** (`packages/kernel/src/process-manager.ts` `WorkerProcessHandle.send` / `disconnect` / `'message'`; worker-side `process.send` / `'message'` / `'disconnect'` in `packages/runtime-js/src/ipc/install-process.ts`); the SAB path no longer silently drops messages. Conformance: `tests/conformance/builtins/fork-ipc-worker.test.ts`.
- [x] `execSync` returns stdout as a Buffer.
- [x] `worker_threads.Worker` with parentPort-style IPC.
- [x] `ProcessManager` in `@riftydev/kernel` for PID tracking.
- [x] **22 conformance test cases in 7 files** under `tests/conformance/builtins/` (`child_process.test.ts` 8, `child_process-worker.test.ts` 2, `child_process-stdin.test.ts` 1, `fork-ipc.test.ts` 2, `fork-ipc-worker.test.ts` 3 (ADR-0045), `exec-sync-worker.test.ts` 3, `worker_threads.test.ts` 3). The SAB-only suites (`*-worker`, `*-stdin`, `*-sync-worker`) gate on `crossOriginIsolated && getKernelWorkerUrl()`.

### Open acceptance

- [x] **`child_process.execSync` via SharedArrayBuffer+Atomics — done.** `packages/runtime-js/src/builtins/child_process-sync.ts:37-46` → `packages/kernel/src/ipc/sab-ring.ts:220` (`Atomics.wait`). Conformance: `tests/conformance/builtins/exec-sync-worker.test.ts` ("ADR-0011 phase 3").
- [ ] "Process = Web Worker" model (real Worker per child, not `new Function` in the parent realm).
- [ ] cwd state per-process (lives in `kernel.ProcessRecord`).
- [x] **`ChildProcess.stdin` IPC — SAB-Worker path wired.** `packages/runtime-js/src/builtins/child_process.ts:220-224` passes `handle.stdin()` into the `ChildProcess` constructor so `child.stdin.write(chunk)` / `child.stdin.end()` post to the worker's stdin `MessagePort` via the kernel-side `bindPortAsWritable` accessor (`packages/kernel/src/process-manager.ts:328-331`). The in-realm fallback keeps a loud-throw `InRealmStdinUnsupported` Writable — that path has no worker to route to. Conformance: `tests/conformance/builtins/child_process-stdin.test.ts` (skipped outside SAB-capable environments, runs in the browser e2e harness). Worker-side `process.stdin` Readable wiring remains a separate follow-up.
- [ ] Pipe stdio over `MessagePort` with backpressure.

## M7 — Network — PARTIAL — see open acceptance below

- [x] `net.createServer().listen(3000)` registers a handler in the port registry.
- [x] `http.createServer(...)` runs Express-style handlers; GET / POST / headers / body.
- [x] `IncomingMessage` is a `Readable`.
- [x] `http.request` (outgoing) backed by `fetch()`.
- [x] Port registry with `dispatchToPort` — consumed by Service Worker for `/preview/<port>/...` routing.
- [x] **4 http conformance tests** + 2 Express-style integration tests.
- [x] **E2E SW round-trip:** `tests/e2e/m7-preview-sw.spec.ts` — `fetch('/preview/3000/')` from the playground page reaches a main-thread `http.createServer().listen(3000)` through `installPreviewInterceptor` + `setupPreviewBridge` + `packSerializedResponse` and returns the registered handler's HTML body. Closes the audit gap where `tests/integration/express-style.test.ts` bypassed the SW path via direct `dispatchToPort`.
- [x] **Real upstream `express@4` runs end-to-end (Phase 1, 2026-05-29).** `tests/integration/express-live-run.opt-in.test.ts` (opt-in, `RIFTY_LIVE_REGISTRY`) installs express@^4 (86 pkgs) from the live registry, loads it through the module loader, and serves real requests via `dispatchToPort`: `GET /` (router + `res.send`), `GET /api` (`res.json` + etag + content-type), `POST /echo` (`express.json()` body-parser round-trips JSON), `GET /missing` (finalhandler 404). Surfaced + fixed six compat/installer defects — see "Real bugs caught running real express@4" above. This supersedes the old hand-rolled `express-style.test.ts` shape as the real "Express runs" proof.

### Open acceptance

- [x] **Chunked transfer encoding / streaming response — done.** `packages/net/src/http/response.ts:1-50,134-136,160-183` — `Response` body is a `ReadableStream<Uint8Array>`; `res.write` returns `Promise<boolean>` for backpressure; `Transfer-Encoding: chunked` auto-set when no `Content-Length`. Conformance: `tests/conformance/builtins/http.test.ts:56-145` (SSE, long-poll, chunked write).
- [ ] SW → Worker routing (today the bridge terminates in the main-thread realm).
- [ ] Real-TCP `net.Socket` semantics (current `Socket` is HTTP-only).
- [ ] Cross-realm WebSocket bridge (iframe-loaded HMR client over a real `WebSocket`).

## M8 — WASI Runner — PARTIAL — see open acceptance below

- [x] `@riftydev/runtime-wasi` package with `Wasi` class + `runWasi(bytes, opts)` helper.
- [x] preview1 syscalls: args_*, environ_*, fd_read/write/close/seek/fdstat_get/prestat_*, path_open / path_filestat_get / path_create_directory, proc_exit, clock_time_get, random_get, sched_yield. `poll_oneoff` → ENOSYS.
- [x] Preopens route to shared `syncMirror()` so files written via `fs` are visible to WASI binaries.
- [x] `proc_exit` surfaces as `WasiExit`.
- [x] **4 WASI conformance tests**.

### Open acceptance

- [x] **Vendor `esbuild.wasm` end-to-end through the WASI runner — DONE 2026-05-27 (ADR-0047).** `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs` vendors `@esbuild/wasi-preview1@0.28.0` (build-time, pinned by version + SHA-512 integrity, NOT a runtime dep) into `tools/shadow-registry/vendor/esbuild-wasi-preview1/`. The binary imports ONLY `wasi_snapshot_preview1` and runs on the existing shim (`esbuild --version` → exit 0). _Reverses ADR-0044's swc substitution: swc has no WASI build (its published wasm is wasm-bindgen, not WASIp1); ADR-0044's "esbuild has no WASI build" was based on inspecting `esbuild-wasm` (the gojs build) only. `@esbuild/wasi-preview1` is a separate, real WASIp1 binary._ Conformance `tests/conformance/wasi/esbuild-wasi-binary.test.ts`; the cwd/preopen API it forced is ADR-0049.
- [x] **WASI file decomposition — done.** `packages/runtime-wasi/src/syscalls/{fd,path,proc}.ts` + `shared.ts` carry the preview1 syscall implementations; the umbrella `wasi.ts` now wires the imports table and orchestrates lifecycle. 56 package-level test cases (`syscalls/{clock,fd,fd-stat-readdir,path,path-mutate}.test.ts` + `wasi-link.test.ts` + `process-handle.test.ts`) cover the split surface.

## M10 — Real Tooling — PARTIAL — see open acceptance below

What's landed (mini-equivalent of Vite/HMR; "vite-like" not literal upstream Vite):

- [x] `fs.watch` + `fs.watchFile`: polling-based, event names match Node (`'rename'` / `'change'`), EventEmitter + callback APIs, `unwatchFile`. 8 conformance tests.
- [x] `@riftydev/net` WebSocket layer: in-process URL-routed `WebSocket` + `WebSocketServer` + `WebSocketConnection`; `'open'` / `'message'` / `'close'` lifecycle; `broadcast` for HMR. 5 conformance tests. (Real-TCP `WebSocket` over the network is a follow-up; the API is shaped to swap cleanly.)
- [x] `@riftydev/shell` package: tokenizer, built-ins (`pwd`/`cd`/`ls`/`cat`/`echo`/`mkdir`/`rm`/`env`/`touch`), `>`/`>>` redirection, env-assignment prefix (`FOO=bar cmd`), pluggable `registerCommand` (so `npm install`/`npm run` plug in from a higher layer without shell knowing about them).
- [x] `@riftydev/service-worker` preview bridge: matches `/preview/<port>/*`, posts to the first window client over `MessageChannel`, awaits a serialised response. Window-side `setupPreviewBridge(handler)` dispatches via the `@riftydev/net` port registry. Closes the M7 SW-fetch follow-up.
- [x] `examples/vite-like-dev`: minimal Vite-equivalent dev server — serves HTML/JS from VFS, watches files, broadcasts HMR over WebSocket, injects an HMR client that reloads the iframe on update. 3 integration tests: index.html injection, JS serving, HMR round-trip.
- [x] Playground: `PreviewPanel` iframe + port input, `Dev Mode` toggle in `App.tsx`. In dev mode, editor edits write to `/workspace/src/main.js` via a new `useRuntime.writeFile()` and a main-thread `startDevMode()` adapter wires the SW preview-bridge to the port registry.
- [x] `RuntimeController.writeFile(path, content)` host API for editor↔VFS sync.

### Open acceptance

- [x] **Real upstream `vite@5.4` runs in-process (2026-05-30).** `npm install vite` (57 pkgs) → module loader `import('vite')` → `createServer` → `server.listen()` → `server.transformRequest('/src/main.js')` all succeed, replicating the worker bootstrap (`apps/playground/src/workers/real-vite-bootstrap.ts`) steps 1-6. Required two fs fixes (ADR-0050: realpath/lstat no-symlink semantics for chokidar; `readdir(p, {withFileTypes}, cb)` for readdirp) on top of the prior esbuild.wasm (ADR-0047) + esbuild/rollup shim overlays. Regression: opt-in `tests/integration/vite-live-run.opt-in.test.ts` spawns `tests/integration/fixtures/real-vite-smoke.ts`.
  - [ ] **Remaining (full browser e2e):** the worker-realm + HMR + iframe-preview + SW preview-routing flow (`realVite.ts` → `real-vite-bootstrap.ts`) end-to-end in a cross-origin-isolated browser via Playwright. The runtime + dev-server core is proven headless; the browser wiring (incl. ADR-0048 streaming preview for large bodies) is the remaining slice.
- [x] **Vite ↔ esbuild.wasm shadow-binding (TS/JSX transformation in the dev path) — DONE 2026-05-27 (ADR-0047).** `tools/shadow-registry/src/esbuild-binding.ts` `transformWithEsbuild()` runs Vite's TS/JSX transform surface through `runWasi(esbuild.wasm, …)` over real preopens (stdin source + `--loader`). Integration `tests/integration/esbuild-wasi-transform.test.ts` (TS type-strip, JSX lowering, syntax-error-throws). esbuild via Go-runtime bridge stays deferred (ADR-0044 D3) but is now moot for esbuild — `@esbuild/wasi-preview1` is a real WASI binary, not the gojs build.
- [x] **Cross-realm HMR bridge — DONE 2026-05-26** (ADR-0017 phase 1 addendum). `apps/playground/src/glue/hmr-bridge.ts` + `BridgedWebSocketServer` over `BroadcastChannel`; the iframe HMR client is injected via a Vite plugin and rides the same channel name without depending on `@riftydev/net`. 9 unit tests + the manual / E2E flow below.
- [x] **Playwright E2E: edit-in-editor → see-iframe-reload — done.** `tests/e2e/m10-hmr.spec.ts` ("preview iframe receives HMR update when src/main.js changes") covers the full path: load → toggle Real Vite → Monaco edit → assert iframe content updates. Gated on `RIFTY_E2E_HMR=1` (skipped by default in CI to avoid the ~20s Vite install per run).
- [ ] Shadow-registry consolidation (per ADR 0015) — move `overrides.ts` + shim files under `tools/shadow-registry/`.
- [x] **Vite-in-Worker (per ADR-0011 / ADR-0043) — DONE 2026-05-27.** Real Vite runs inside a kernel-spawned Worker realm. `apps/playground/src/glue/realVite.ts` rewrote as `globalProcessManager.spawnWorker(...)` against `apps/playground/src/workers/real-vite-bootstrap.ts`. Cross-realm preview-port bridge: `@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview` over `BroadcastChannel` (6 unit tests). HMR bridge moved into the worker realm (M10's wiring stays since `BroadcastChannel` reaches the iframe regardless of host realm). Editor edits flow page→worker through `apps/playground/src/glue/vfs-write-port.ts` (5 unit tests). `installProcessGlobals` / `installTimerGlobals` no longer run on the page realm in Real Vite mode. ADR-0025 superseded for the Real Vite path; M10 Dev Mode retained on main thread as the non-isolated fallback. A-023 (SW→Worker direct) remains the next consumer of the bridge primitive — Q-2026-05-27-002 stays open until then.

## M9 — npm install — PARTIAL — see open acceptance below

- [x] **Semver** (`matchesRange`/`pickBestVersion`): exact, x-ranges, caret, tilde, comparator sets, unions, dist-tags.
- [x] **RegistryClient** with pluggable fetcher; base URL configurable per D-004.
- [x] **gzip + tar extractor** (no external deps).
- [x] **Linker** writes node_modules tree; dedupes by name.
- [x] **Lockfile** generation (npm v3 shape).
- [x] **Shadow registry** (D-005): user `overrides` + baked-in `bcrypt → bcryptjs`.
- [x] **`install(name, version, deps, opts)`** end-to-end pipeline: resolve → tarball → unpack → link → lockfile.
- [x] **22 conformance test cases in 3 files** under `tests/conformance/npm/` (`semver.test.ts` 15 + `install.test.ts` 3 + `lockfile-reuse.test.ts` 4) + 62 package-level cases in `@riftydev/npm-client` (across 9 files: semver, registry, unpacker, fetch-and-unpack, installer, installer-pipeline, installer-lockfile, installer-lockfile-reader, installer-peer-optional) + 10 integration cases (`tests/integration/real-install.test.ts` 3 + `nested-install.test.ts` 2 + `real-packages.test.ts` 4 + `express-live.opt-in.test.ts` 1).

### Open acceptance

- [ ] Lockfile reuse on subsequent `install` (currently regenerated each call — per ADR 0023).
- [x] **Nested install for version conflicts — DONE 2026-05-27.** ADR-0042 ratified first-wins-flat + nest-on-conflict placement. `walkAndPin` rewritten; `ResolvedPackage.installPath` added; lockfile keyed by install path. Live express install passes end-to-end (86 packages, `ms × 5`, `debug × 3`, `statuses × 3`). EVERSIONCONFLICT is now dead code. Lockfile fast-path replay for nested entries — DONE 2026-05-27 (ADR-0042 follow-on): `pinnedEntryForParent` in `installer-lockfile-reader.ts` implements the npm walk-up algorithm, `createLockfileSource` uses it, the `lockfileHasNestedEntries` opt-out is gone; reinstall of a diamond-bearing lockfile is now a pure cache replay (verified: second live express install 86 packages / 44 ms / 0 packuments / 0 tarballs vs first install 18 100 ms / 72 packuments / 83 tarballs).
- [ ] Integration tests against real npm tarballs (currently hand-rolled mocks — per ADR 0021).
  - First slice landed 2026-05-24 (`tests/integration/real-install.test.ts` — picocolors, ms, kleur as zero-dep tarballs).
  - Nested-install diamond coverage landed 2026-05-27 (`tests/integration/nested-install.test.ts` — real `debug@4.4.1` + real `ms@2.1.3` + real `ms@2.0.0` + synthesized `diamond-conflict-parent@1.0.0` wrapper; mirrors the live express conflict shape). Regression-detector: temporarily collapsing the nest-on-conflict branch in `walkAndPin` makes both new tests fail loudly.
  - Still open: `chalk` and full `express` fixtures, and `tools/integration-fixtures/refresh.ts` script (manual `npm pack` flow documented at `tools/integration-fixtures/diamond-conflict-parent/README.md` for the synthesized wrapper).
- [ ] Prod-proxy decision (`Q-2026-05-24-007`).

---

## M12 — opencode server facade (proposed) — PARTIAL — no-vendored-tree slice DONE

Run anomalyco/opencode's Effect HTTP server headlessly in rifty up to the
tool-execution ceiling. Full plan + gates: `docs/opencode/README.md`; ADR-draft
register: `docs/opencode/decisions.md`. opencode is **NOT vendored** in the repo.

- [x] **TS-on-import across the module graph (F02)** — `.ts`/`.tsx` first-class resolvable + ESM, injected esbuild `transformSource` hook, `.d.ts` excluded, `require()`-of-`.ts` loud-throw, transform cache. **ADR-0052 + ADR-0053.** Gold multi-file `.ts` parity case green → P0 language unit closed.
- [x] **Effect consumes rifty `node:http` AS-IS (F05)** — listen options overload, `ServerResponse` `'drain'`, buffered 200, upgrade-boundary lock, parity-net mode. **ADR-0054** (pipe-sink deferred).
- [x] **SSE-over-streaming-HTTP, no `ws` shim (F07, page-direct)** — **ADR-0055**. v3 page↔Worker frame bump deferred (ADR-0060 draft).
- [x] **F09 tool-ceiling marker** — pure-JS `vfsGrep`, read-substitute parity, spawn-ceiling conformance (`git`/`bash` → ENOENT-127), `docs/compat/opencode-tool-ceiling.md`. `vfsGrep` global-RegExp fix landed.

### Blocked (gates in `docs/opencode/README.md`)

- [ ] **Vendor opencode (F01)** — network-gated; unblocks Spike C + F03/04/06/07-T1/08 + F02-T9.
- [ ] **Spike C** — real createRoutes layer-build against the tier-A throw-stub; decides WASM-SQLite P2-vs-P4.
- [ ] **`#db`/`#pty` + WASM-SQLite + drizzle (F03/04)** — ADR-0055/0056 draft, gated on Spike C.
- [ ] **Headless boot (F06)** — ADR-0058 draft; needs the tree.
- [ ] **LLM round-trip + `node:https`→fetch (F08)** — ADR-0061 draft (supersedes ADR-0010), behind the C1 `https.Agent` pre-flight.

---

## Definition-of-done summary across milestones

| Check | Result |
|---|---|
| Unit + conformance + integration tests | **867 pass | 16 skip** — last counted 2026-05-31 after the M12 no-vendored-tree slice (F02/F05/F09) |
| TypeScript strict typecheck | **clean (16 projects)** |
| Biome lint | **clean on changed files; 2 pre-existing whole-tree errors in `npm-client/src/installer.ts:508,511`** |
| Circular dependency check (madge) | **clean** |
| D-002 isolation (no `solid-js` outside `apps/playground/**`) | **clean** |
| Playground production build (`vite build`) | **succeeds** |
| Dev server with COOP/COEP headers | **verified live** |
| `TODO(ADR)` markers in source | resolve to active `OPEN_QUESTIONS.md` entries (`pnpm todo:adr` exit 0) |
| `OPEN_QUESTIONS.md` entries pending review | ~10 active — Q-2026-05-24-007 (prod-proxy), Q-2026-05-27-001 (process.version), Q-2026-05-30-061/062/063 (F09 markers), Q-2026-05-30-101/102 + 202 (F05/F02), Q-2026-05-31-201 (ts-esm parity). Q-2026-05-29-001 (streaming preview) promoted to ADR-0048. |

## Follow-ups (not blocking M0–M9)

- `import.meta.url` (M3 follow-up).
- `package.json` `imports` (`#name` subpath imports).
- True parallel Web Workers for `worker_threads.Worker` (M6 follow-up).
- Service Worker `fetch` interceptor handler that bridges to the port registry over a `MessageChannel` (M7 deploy task — registry contract is in place).
- ~~Vendor a real `hello.wasm` / `swc.wasm` and run them end-to-end against the WASI shim~~ — **DONE for esbuild (ADR-0047).** `@esbuild/wasi-preview1` is vendored and runs end-to-end; the synthetic-memory cases are now backed by a real binary. (A `hello.wasm`/sqlite guest remains a nice-to-have but esbuild covers the M8/M10 forcing-consumer need.)
- **Go-runtime (gojs) bridge — deferred per ADR-0044 D3 (still valid; now moot for esbuild per ADR-0047 D3).** The `esbuild-wasm` package (0.21.5 / 0.25.0 / 0.28.0) targets Go's `js/wasm` ABI (`gojs.runtime.*` / `gojs.syscall/js.*`), but **esbuild no longer needs it** — we run the separate `@esbuild/wasi-preview1` WASIp1 build on the existing shim (ADR-0047). The Go-runtime bridge (`@riftydev/runtime-go-wasm`: full `syscall/js` handle protocol, `wasm_exec.js`-equivalent host shim, GC + goroutine scheduling) is only relevant if some *other* gojs guest appears. Multi-week design; blocks nothing. Pick up when a Go-WASM guest with no WASI build actually shows up.
- Live registry roundtrip (`registry.npmjs.org` through the Vite proxy) — the mock-based pipeline is verified; live integration needs a manual smoke.
- Postinstall scripts in npm-client (most packages don't need them).
- Nested resolution for conflicting transitive versions (flat install + conflict report works today).
