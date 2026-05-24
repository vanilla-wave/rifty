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

### Changed

- **ESM loader** now uses an **AST-based transformer** (`acorn` + scope-tracking walker) instead of the regex / zone-scanner approach. Scope-aware rewriting fixes parameter-shadowing of imported bindings, which previously broke real Vite's pre-bundled deps (e.g. `dep-BK3b2jBa.js` with `function format(win32, …)`). See ADR 0009. Adds `acorn` and `acorn-walk` to dependencies; removes `module-loader/source-scanner.ts`.
