# Changelog

## [Unreleased]

### Added

- Package skeleton for `@riftydev/ts-language-service`.
- Pinned `typescript@5.9.3` as a prod dependency (ADR-0166: the vendored fixed
  compiler is the single source of truth for both the compiler and its lib files).
- `scripts/vendor-ts-lib.mjs`: build-time generator that reads every `lib*.d.ts`
  from the installed compiler and emits `vendor/lib-bundle.json` (the committed,
  vendored std-lib asset). Wired into `build` via a `prebuild` hook.
- `src/lib-dts.ts`: std-lib `.d.ts` loader. `loadLibDts()` returns a memoized
  `Map<filename, contents>` — Node reads from the installed compiler's `lib/`,
  the browser fetches the vendored bundle via `getTsLibUrl()` (env-config URL
  precedence, D-004: bootstrap global → `import.meta.env` → `process.env` →
  `/ts-lib/lib-bundle.json`).
- Engine core (ADR-0166): a real `ts.LanguageService` driven over the rifty VFS,
  Node-provable end to end.
  - `src/lsp-types.ts` + `src/position.ts`: LSP diagnostic shapes (`Position`,
    `Range`, `DiagnosticSeverity`, `Diagnostic`) and 0-based offset↔position
    mapping (UTF-16, LSP convention).
  - `src/tsconfig.ts`: `loadTsConfig(fsSync, projectRoot)` parses `tsconfig.json`
    over the VFS via tsc's own `ParseConfigHost` (file globs expanded by
    `ts.matchFiles` — the real tsc matcher); no tsconfig → tsc default options
    over the discovered loose files.
  - `src/host.ts`: `createVfsLanguageServiceHost` — a `ts.LanguageServiceHost`
    over `FsSync`. Serves the std lib by basename interception (synthetic
    `/ts-lib/<name>` default-lib path), versions files by overlay/mtime, and
    resolves modules via `resolveModuleNameLiterals` against the VFS
    `node_modules/**/*.d.ts` (mode-aware, shared resolution cache).
  - `src/overlay.ts`: open-document overlay (`open`/`update`/`close`/
    `invalidate`) — diagnostics reflect the editor buffer; `close` reverts to
    disk; `invalidate` re-reads after an external write even when the backend
    cannot move mtime.
  - `src/service.ts` (public): `createTsLanguageService({ fsSync, projectRoot })`
    → `getSemanticDiagnostics` / `getSyntacticDiagnostics` (mapped to LSP
    `Diagnostic`: 0-based range, severity, TS error `code`, `source: 'ts'`) plus
    `openDocument`/`updateDocument`/`closeDocument`/`invalidate`.
- Added `@riftydev/vfs` as a workspace dependency (lower tier; the engine reads
  the project through the VFS).

### Changed

- biome: ignore `packages/ts-language-service/vendor/**` (the generated 3.1 MiB
  std-lib bundle is a build asset, not source — it tripped biome's per-file size
  limit, a pre-existing lint break on the branch baseline).
