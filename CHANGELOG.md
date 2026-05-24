# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
