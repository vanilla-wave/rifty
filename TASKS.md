# Tasks

Per-milestone task tracking with acceptance review. See `PROJECT_PLAN.md` for the original acceptance criteria.

## Verification snapshot

- **Unit + conformance + integration:** 222 passed (33 files).
- **Parity-runner:** 15 cases (path, buffer, util, events, querystring, url, fs, stream) compared against real Node — all match.
- **E2E (Playwright, Chromium):** 15 passed (M0 boot, M1 REPL+`.reset`, M2 modules, M4 fs); M10 dev-mode flow not yet covered by Playwright (verified manually).
- **Typecheck:** `tsc --noEmit` clean across workspace (16 projects).
- **Lint:** `biome check .` clean.
- **Circular deps:** none (madge).
- **D-002 isolation:** clean (no `solid-js` imports outside `apps/playground/**`).
- **Playground build:** `vite build` succeeds.

### Real bugs caught during M1–M9 verification

- Typecheck was broken (workspace-wide): reverse imports `kernel → runtime-js`, deep paths into `runtime-js/src/builtins/*` from `net` and `runtime-wasi`, missing `allowImportingTsExtensions`. Fixed by moving `sync-mirror` into `@rifty/vfs`, exposing a `@rifty/runtime-js/builtins` subpath export, and giving `net` a side-effect `register-builtins` module.
- Vite dev server port 5173 collided with an unrelated local project — Playwright was hitting the wrong app. Pinned `strictPort: true` on 5273.
- `path.normalize` dropped trailing slashes (vs Node).
- `fs.readFileSync(...)` didn't resolve relative paths against `process.cwd()`.
- `worker_threads.Worker`: parent→child IPC was wired to a dead event name; only child→parent worked.
- `child_process.fork`: child script had no `send` / `on('message')` / `onMessage` API.
- `node-parity-runner` was a no-op stub. Now has a real harness + 15 cases that drive real `node` child processes and diff stdouts.

---

## M0 — Foundation — PARTIAL — see open acceptance below

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

### Open acceptance

- [ ] Prod COOP/COEP headers (`vercel.json` / `_headers` — being added in this session).

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
- [x] **Conformance:** 33 resolution + 1 ESM cycle + 4 integration tests pass.

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
- [x] **121 conformance tests** spanning all built-ins.

## M4 — FileSystem — PARTIAL — see open acceptance below

- [x] Sync API: `readFileSync`/`writeFileSync`/`appendFileSync`/`readdirSync`(+withFileTypes)/`mkdirSync`/`statSync`/`existsSync`/`unlinkSync`/`rmSync`/`rmdirSync`/`renameSync`/`copyFileSync`.
- [x] Async callback API: readFile/writeFile/mkdir/stat/unlink/readdir.
- [x] `fs.promises`: full Promise mirror.
- [x] `mkdir({ recursive: true })` semantics.
- [x] `fs.stat` returns correct `size`, `isFile()`, `isDirectory()`.
- [x] **OPFS backend** (`OpfsVfs`) for browser Workers; Memory backend for everything else. Sync mirror seam lets us swap.
- [x] Streams: `createReadStream` / `createWriteStream` with pipe + finish.
- [x] **17 fs conformance tests** + 2 fs-streams tests.

### Open acceptance

- [ ] OPFS persistence (write→reload round-trip in a real browser session).
- [ ] `OpfsFsSync` sync backend (`FileSystemSyncAccessHandle` in Worker realm).
- [ ] Unify async + sync VFS to one backing tree (single `MemoryBackend` exposing both surfaces).

## M5 — Streams & IO — DONE

- [x] `Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` with backpressure + drain.
- [x] Async iterators on `Readable`.
- [x] Object mode supported.
- [x] `Readable.from(iterable)`.
- [x] `pipeline(...)` and `finished(stream)`.
- [x] `node:stream` and `node:stream/promises` exposed.
- [x] **9 stream conformance tests**.

## M6 — Processes — PARTIAL — see open acceptance below

- [x] `child_process.spawn('node', [script])` runs a VFS-stored JS file as a child with stdout/stderr streams.
- [x] `exec(cmd, cb)` buffers stdout/stderr.
- [x] `fork(modulePath)` returns a child with IPC.
- [x] `execSync` returns stdout as a Buffer.
- [x] `worker_threads.Worker` with parentPort-style IPC.
- [x] `ProcessManager` in `@rifty/kernel` for PID tracking.
- [x] **5 child_process conformance tests**.

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

### Open acceptance

- [x] **Chunked transfer encoding / streaming response — done.** `packages/net/src/http/response.ts:1-50,134-136,160-183` — `Response` body is a `ReadableStream<Uint8Array>`; `res.write` returns `Promise<boolean>` for backpressure; `Transfer-Encoding: chunked` auto-set when no `Content-Length`. Conformance: `tests/conformance/builtins/http.test.ts:56-145` (SSE, long-poll, chunked write).
- [ ] SW → Worker routing (today the bridge terminates in the main-thread realm).
- [ ] Real-TCP `net.Socket` semantics (current `Socket` is HTTP-only).
- [ ] Cross-realm WebSocket bridge (iframe-loaded HMR client over a real `WebSocket`).

## M8 — WASI Runner — PARTIAL — see open acceptance below

- [x] `@rifty/runtime-wasi` package with `Wasi` class + `runWasi(bytes, opts)` helper.
- [x] preview1 syscalls: args_*, environ_*, fd_read/write/close/seek/fdstat_get/prestat_*, path_open / path_filestat_get / path_create_directory, proc_exit, clock_time_get, random_get, sched_yield. `poll_oneoff` → ENOSYS.
- [x] Preopens route to shared `syncMirror()` so files written via `fs` are visible to WASI binaries.
- [x] `proc_exit` surfaces as `WasiExit`.
- [x] **4 WASI conformance tests**.

### Open acceptance

- [ ] Vendor `esbuild.wasm` end-to-end through the WASI runner (current cases use synthetic memory).
- [ ] WASI file decomposition (`wasi.ts` → `syscalls/{fd,path,proc}.ts` — per ADR 0024).

## M10 — Real Tooling — PARTIAL — see open acceptance below

What's landed (mini-equivalent of Vite/HMR; "vite-like" not literal upstream Vite):

- [x] `fs.watch` + `fs.watchFile`: polling-based, event names match Node (`'rename'` / `'change'`), EventEmitter + callback APIs, `unwatchFile`. 8 conformance tests.
- [x] `@rifty/net` WebSocket layer: in-process URL-routed `WebSocket` + `WebSocketServer` + `WebSocketConnection`; `'open'` / `'message'` / `'close'` lifecycle; `broadcast` for HMR. 5 conformance tests. (Real-TCP `WebSocket` over the network is a follow-up; the API is shaped to swap cleanly.)
- [x] `@rifty/shell` package: tokenizer, built-ins (`pwd`/`cd`/`ls`/`cat`/`echo`/`mkdir`/`rm`/`env`/`touch`), `>`/`>>` redirection, env-assignment prefix (`FOO=bar cmd`), pluggable `registerCommand` (so `npm install`/`npm run` plug in from a higher layer without shell knowing about them).
- [x] `@rifty/service-worker` preview bridge: matches `/preview/<port>/*`, posts to the first window client over `MessageChannel`, awaits a serialised response. Window-side `setupPreviewBridge(handler)` dispatches via the `@rifty/net` port registry. Closes the M7 SW-fetch follow-up.
- [x] `examples/vite-like-dev`: minimal Vite-equivalent dev server — serves HTML/JS from VFS, watches files, broadcasts HMR over WebSocket, injects an HMR client that reloads the iframe on update. 3 integration tests: index.html injection, JS serving, HMR round-trip.
- [x] Playground: `PreviewPanel` iframe + port input, `Dev Mode` toggle in `App.tsx`. In dev mode, editor edits write to `/workspace/src/main.js` via a new `useRuntime.writeFile()` and a main-thread `startDevMode()` adapter wires the SW preview-bridge to the port registry.
- [x] `RuntimeController.writeFile(path, content)` host API for editor↔VFS sync.

### Open acceptance

- [ ] `npm install vite && npm run dev` literally running upstream Vite — Vite has hundreds of transitive deps and many edge cases; the equivalent dev-server is the architectural acceptance. Real Vite likely lands incrementally with `unenv` polyfills + esbuild.wasm.
- [ ] Vite ↔ esbuild.wasm shadow-binding (TS/JSX transformation in the dev path) — needs the WASI runner's esbuild.wasm binary vendored end-to-end (M8 follow-up).
- [x] **Cross-realm HMR bridge — DONE 2026-05-26** (ADR-0017 phase 1 addendum). `apps/playground/src/glue/hmr-bridge.ts` + `BridgedWebSocketServer` over `BroadcastChannel`; the iframe HMR client is injected via a Vite plugin and rides the same channel name without depending on `@rifty/net`. 9 unit tests + the manual / E2E flow below.
- [x] **Playwright E2E: edit-in-editor → see-iframe-reload — done.** `tests/e2e/m10-hmr.spec.ts` ("preview iframe receives HMR update when src/main.js changes") covers the full path: load → toggle Real Vite → Monaco edit → assert iframe content updates. Gated on `RIFTY_E2E_HMR=1` (skipped by default in CI to avoid the ~20s Vite install per run).
- [ ] Shadow-registry consolidation (per ADR 0015) — move `overrides.ts` + shim files under `tools/shadow-registry/`.
- [x] **Vite-in-Worker (per ADR-0011 / ADR-0043) — DONE 2026-05-27.** Real Vite runs inside a kernel-spawned Worker realm. `apps/playground/src/glue/realVite.ts` rewrote as `globalProcessManager.spawnWorker(...)` against `apps/playground/src/workers/real-vite-bootstrap.ts`. Cross-realm preview-port bridge: `@rifty/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview` over `BroadcastChannel` (6 unit tests). HMR bridge moved into the worker realm (M10's wiring stays since `BroadcastChannel` reaches the iframe regardless of host realm). Editor edits flow page→worker through `apps/playground/src/glue/vfs-write-port.ts` (5 unit tests). `installProcessGlobals` / `installTimerGlobals` no longer run on the page realm in Real Vite mode. ADR-0025 superseded for the Real Vite path; M10 Dev Mode retained on main thread as the non-isolated fallback. A-023 (SW→Worker direct) remains the next consumer of the bridge primitive — Q-2026-05-27-002 stays open until then.

## M9 — npm install — PARTIAL — see open acceptance below

- [x] **Semver** (`matchesRange`/`pickBestVersion`): exact, x-ranges, caret, tilde, comparator sets, unions, dist-tags.
- [x] **RegistryClient** with pluggable fetcher; base URL configurable per D-004.
- [x] **gzip + tar extractor** (no external deps).
- [x] **Linker** writes node_modules tree; dedupes by name.
- [x] **Lockfile** generation (npm v3 shape).
- [x] **Shadow registry** (D-005): user `overrides` + baked-in `bcrypt → bcryptjs`.
- [x] **`install(name, version, deps, opts)`** end-to-end pipeline: resolve → tarball → unpack → link → lockfile.
- [x] **18 npm conformance tests** (15 semver + 3 install).

### Open acceptance

- [ ] Lockfile reuse on subsequent `install` (currently regenerated each call — per ADR 0023).
- [x] **Nested install for version conflicts — DONE 2026-05-27.** ADR-0042 ratified first-wins-flat + nest-on-conflict placement. `walkAndPin` rewritten; `ResolvedPackage.installPath` added; lockfile keyed by install path. Live express install passes end-to-end (86 packages, `ms × 5`, `debug × 3`, `statuses × 3`). EVERSIONCONFLICT is now dead code. Lockfile fast-path replay for nested entries — DONE 2026-05-27 (ADR-0042 follow-on): `pinnedEntryForParent` in `installer-lockfile-reader.ts` implements the npm walk-up algorithm, `createLockfileSource` uses it, the `lockfileHasNestedEntries` opt-out is gone; reinstall of a diamond-bearing lockfile is now a pure cache replay (verified: second live express install 86 packages / 44 ms / 0 packuments / 0 tarballs vs first install 18 100 ms / 72 packuments / 83 tarballs).
- [ ] Integration tests against real npm tarballs (currently hand-rolled mocks — per ADR 0021).
  - First slice landed 2026-05-24 (`tests/integration/real-install.test.ts` — picocolors, ms, kleur as zero-dep tarballs).
  - Nested-install diamond coverage landed 2026-05-27 (`tests/integration/nested-install.test.ts` — real `debug@4.4.1` + real `ms@2.1.3` + real `ms@2.0.0` + synthesized `diamond-conflict-parent@1.0.0` wrapper; mirrors the live express conflict shape). Regression-detector: temporarily collapsing the nest-on-conflict branch in `walkAndPin` makes both new tests fail loudly.
  - Still open: `chalk` and full `express` fixtures, and `tools/integration-fixtures/refresh.ts` script (manual `npm pack` flow documented at `tools/integration-fixtures/diamond-conflict-parent/README.md` for the synthesized wrapper).
- [ ] Prod-proxy decision (`Q-2026-05-24-007`).

---

## Definition-of-done summary across milestones

| Check | Result |
|---|---|
| Unit + conformance + integration tests | **761 pass (99 files)** — last counted 2026-05-27 after ADR-0043 (cross-realm preview port + VFS write port adds 11 unit tests) |
| TypeScript strict typecheck | **clean (16 projects)** |
| Biome lint | **clean** |
| Circular dependency check (madge) | **clean** |
| D-002 isolation (no `solid-js` outside `apps/playground/**`) | **clean** |
| Playground production build (`vite build`) | **succeeds** |
| Dev server with COOP/COEP headers | **verified live** |
| `TODO(ADR)` markers in source | 5 (Q-002 process, Q-003 platform, Q-004 esbuild-shim, Q-005 subpath exports × 2 files) |
| `OPEN_QUESTIONS.md` entries pending review | 4 (Q-002, Q-003, Q-004, Q-2026-05-24-007 prod proxy) |

## Follow-ups (not blocking M0–M9)

- `import.meta.url` (M3 follow-up).
- `package.json` `imports` (`#name` subpath imports).
- True parallel Web Workers for `worker_threads.Worker` (M6 follow-up).
- Service Worker `fetch` interceptor handler that bridges to the port registry over a `MessageChannel` (M7 deploy task — registry contract is in place).
- Vendor a real `hello.wasm` / `esbuild.wasm` and run them end-to-end against the WASI shim (M8 follow-up — the shim is verified against synthetic memory).
- Live registry roundtrip (`registry.npmjs.org` through the Vite proxy) — the mock-based pipeline is verified; live integration needs a manual smoke.
- Postinstall scripts in npm-client (most packages don't need them).
- Nested resolution for conflicting transitive versions (flat install + conflict report works today).
