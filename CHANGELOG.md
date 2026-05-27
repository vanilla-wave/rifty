# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Documented

- **ADR-0044 — esbuild ships gojs; substitute swc for M8/M10; defer Go-runtime bridge.** Planning correction: all published `esbuild-wasm` builds (0.21.5 / 0.25.0 / 0.28.0) import Go's `js/wasm` (`gojs`) ABI, not `wasi_snapshot_preview1`, so `@rifty/runtime-wasi` cannot host them. swc takes esbuild's place as the M8 vendoring target and the M10 Vite shadow-binding target. Q-2026-05-27-003 (preopens/cwd API) keeps its A/B/C options but its forcing consumer is now swc; status stays Active. PROJECT_PLAN.md, TASKS.md, and OPEN_QUESTIONS.md updated; the Go-runtime bridge work is parked in TASKS.md Follow-ups.

### Added

- M0 Foundation: pnpm workspace, TypeScript strict, Biome, Vitest, Playwright (three engines), GitHub Actions.
- Playground app (Vite + SolidJS) with Monaco editor and xterm.js terminal, COOP/COEP cross-origin isolation, Run button.
- Service Worker skeleton, runtime-js worker entry stub.
- ADRs 0001–0008 (decisions D-001 through D-007).
- M1 JS Execution: Worker REPL, console capture, stdout/stderr streaming with colors, capabilities detection, traceback, `.reset`.
- M2 Modules: VFS interface + memory backend, unified resolver (CJS+ESM), CJS loader with cycle handling, ESM loader via `es-module-lexer` with live bindings and top-level await, dynamic `import()`, CJS↔ESM interop.
- M3–M9 (already shipped earlier; see TASKS.md for the verified acceptance).
- **M10 Real Tooling foundations:**
  - `fs.watch` and `fs.watchFile` (polling-based; tracked as ⚠️ in compat-matrix). 8 conformance tests covering rename/change events, EventEmitter interface, directory-watch filename reporting, `unwatchFile`, idle-no-fire.
  - `@rifty/net` `WebSocket` + `WebSocketServer` + `WebSocketConnection`: in-process URL-routed duplex with `'open'` / `'message'` / `'close'` semantics matching the browser / Node `ws` API surface; `broadcast` for HMR. 5 conformance tests.
  - `@rifty/shell` package: tokenizer (quotes, env-assignments, redirection), built-ins (`pwd`, `cd`, `echo`, `ls`, `cat`, `mkdir`, `rm`, `env`, `touch`), `>` / `>>` redirection, custom command registration, exit codes. 13 unit tests.
  - `@rifty/service-worker` preview bridge: `installPreviewInterceptor` (SW side) + `setupPreviewBridge` (window side) for routing `/preview/<port>/*` fetches into the runtime's port registry over `MessageChannel`. 3 unit tests on the URL matcher.
  - `examples/vite-like-dev`: tiny Vite-equivalent dev server demonstrating the M10 vision end-to-end — serves HTML/JS from VFS over `@rifty/net.http`, watches files via `fs.watch`, emits HMR over `WebSocketServer`, injects an HMR client into the served HTML. 3 integration tests.
  - Playground: `PreviewPanel` iframe component, `Dev Mode` toggle in `App.tsx`, editor↔VFS sync wired via `useRuntime.writeFile` and the dev-mode adapter.
  - `runtime-js/host`: `RuntimeController.writeFile(path, content)` for pushing editor edits into the in-Worker VFS.
  - `@rifty/vfs` `OpfsFsSync` (ADR-0013) + `detectVfsBackend()`/`initBackend()` boot helpers: synchronous OPFS file ops via `FileSystemSyncAccessHandle` in a Worker realm; directory ops throw `NotImplementedError` (handled via paired `OpfsVfs`). Browser e2e persistence round-trip deferred to M11 follow-up.
- **M11 Vite-in-Worker (ADR-0043, supersedes ADR-0025 for the Real Vite path):**
  - `@rifty/net`: new `cross-realm/preview-port.ts` module ships `previewPortChannelUrl(port)`, `serveCrossRealmPreview(port, dispatch)`, and `bridgeCrossRealmPreview(port, opts?)` over `BroadcastChannel` (same primitive as the HMR bridge). 6 unit tests cover GET round-trip, 4 KiB POST body preservation, worker-side throw → 502, and timeout → 502. Exported from the package index.
  - `apps/playground/src/glue/vfs-write-port.ts`: page→worker VFS write mailbox (`sendVfsWrite` / `serveVfsWrites`) so editor edits in the page realm hit the worker's local `syncMirror()`. 5 unit tests.
  - `apps/playground/src/workers/real-vite-bootstrap.ts`: new worker entry that boots Vite inside the kernel-spawned Real Vite worker. Installs `Buffer`/timer globals on the worker realm (no leakage onto the page's `Promise.prototype.then`), seeds the project, runs the npm-client install, overlays the esbuild/rollup-native shims, hosts the HMR `BridgedWebSocketServer`, opens the cross-realm preview + VFS-write bridges, starts `vite.createServer`.
  - `apps/playground/src/glue/realVite.ts`: rewritten to `globalProcessManager.spawnWorker(...)` the bootstrap, wire the page-side `bridgeCrossRealmPreview` into the `@rifty/net` registry, pump worker stdout/stderr into the playground terminal, and forward `updateEntry(content)` over the VFS write port. Gated on `isSabIpcSupported()`; throws `NotImplementedError` otherwise.
  - ADRs: new ADR-0043. Cross-references: ADR-0025 status header points at ADR-0043 as the Real Vite superseder; ADR-0011 status header notes A-026 landed; ADR-0017 M12 scope expanded to include the new preview-port bridge in the BroadcastChannel→MessagePort swap.
- **M11 nested-install diamond regression test (ADR-0042, ADR-0021):**
  - `tests/integration/nested-install.test.ts` exercises first-wins-flat + nest-on-conflict end-to-end via real `.tgz` bytes (`debug@4.4.1`, `ms@2.1.3`, `ms@2.0.0`) plus one synthesized wrapper (`diamond-conflict-parent@1.0.0`, MIT, 613 B). Mirrors the live express conflict; asserts placement on disk, the duplicate `(name, version)` entries in the result set, and the npm-v3 lockfile keys carrying the install path. Pre-2026-05-27 this scenario was only covered by `express-live.opt-in.test.ts`, which is skipped in CI by default.
  - `tests/integration/fixtures/registry/`: added `ms-2.0.0.tgz` (2.9 KB), `debug-4.4.1.tgz` (13.4 KB), `diamond-conflict-parent-1.0.0.tgz` (613 B) plus their per-version manifest JSON. `local-registry.ts` now picks the highest semver across vendored entries for `dist-tags.latest` instead of "last entry wins" so multi-version coexistence stays correct.
  - `tools/integration-fixtures/diamond-conflict-parent/`: source files for the synthesized wrapper (README documents the manual `npm pack` re-flow; the broader `refresh.ts` script for live-registry tarballs remains on the M11 backlog per ADR-0021).
