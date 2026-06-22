# Changelog

## [Unreleased]

### Added

- **Hover / go-to-definition (+type-definition) / completions** (ADR-0166 task 2.1).
  `TsLanguageService` gains `getQuickInfo` (→ LSP `Hover`: signature as a
  `typescript` code block + rendered JSDoc/tags, range from the symbol span),
  `getDefinition`/`getTypeDefinition` (→ `Location[]`, target span mapped against
  the target file's own text via the host), `getCompletions` (→ `CompletionList`;
  `ts.ScriptElementKind` → LSP `CompletionItemKind`), and `getCompletionDetails`
  (resolves one entry's `detail`+`documentation`, threading the entry's real
  `source`/`data` so uniquely-named auto-imports resolve exactly — same-name
  collisions tracked: backlog `protocol/ts-completion-resolve-by-label`). New LSP
  shapes (`MarkupContent`, `Hover`, `Location`, `CompletionItemKind`,
  `CompletionItem`, `CompletionList`) + worker frames (`ts:getQuickInfo`,
  `ts:getDefinition`, `ts:getTypeDefinition`, `ts:getCompletions`,
  `ts:getCompletionDetails` → `hover`/`locations`/`completions`/`completionItem`
  responses). Every query is parity-checked against the real `ts.LanguageService`
  (gold standard) for cross-file + node_modules symbols.
- **Light browser-host subpaths `./protocol` + `./lsp-types`** (ADR-0166 task 1.9).
  The playground page + owner relay need the `rifty:ts-lsp` frame guards
  (`isTs{Request,Response}Message`, `TS_IPC_TYPE`, the request/response types) and
  the LSP shapes (`Diagnostic`, `DiagnosticSeverity`) WITHOUT pulling the whole TS
  language service — the `.` index re-exports `service.ts` → `typescript`, so
  importing it into a page/owner bundle would drag the entire compiler in. The two
  subpaths are pure types/constants (zero `typescript` import), so the editor +
  relay stay lean; only the LS worker bundle carries the engine.
- **`./vendor/lib-bundle.json` asset export** (ADR-0166 task 1.9). The browser
  host fetches the vendored TS std-lib bundle by URL (`getTsLibUrl()`); exposing it
  as a published asset lets the playground LS worker import it `?url` and seed
  `__RIFTY_TS_LIB_URL`. An asset, not a JS entry (no tsup bundling / `.d.ts`).

### Fixed

- **`isNode()` no longer mistakes a rifty worker for real Node** (ADR-0166 task
  1.9). rifty's in-worker `process` shim impersonates Node (`process.versions.node`
  is set — see the `process-versions-node-honesty` backlog), so the lib-d.ts loader
  wrongly took the Node path (`import('node:fs')` → Vite's empty browser stub →
  crash) in a kernel-spawned LS worker. Gate on the ABSENCE of a browser/worker
  realm too (`window`/`WorkerGlobalScope`/`importScripts`), routing the browser
  worker to the vendored-bundle fetch. Node (vitest/parity) is unaffected.

- Worker hosting (ADR-0166 task 1.8): host the proven engine in a kernel-spawned
  `serve:true` worker that reads the authoritative VFS over the EXISTING `fs.*`
  sync-RPC seam (ADR-0150) — one shared instance for both consumers (the page
  editor and the out-of-rifty M12 agent). No parallel FS channel.
  - `src/worker/host-fs-rpc.ts`: `createRpcFsSync(call): FsSync` — the engine's
    FsSync over the owner store, delegating to the parity-tested `SyncRpcFsSync`
    from `@riftydev/runtime-js` (one impl of the `fs.*` contract, not two:
    chunked `fs.readChunk` reassembly keyed by offset, `fs.statOrNull`
    null-on-ENOENT, `fs.readdir`, `fs.exists`). Construction is side-effect-free
    (NOT the `installRemoteSyncFs` global-mirror install). Node-proven over a
    fake `call` incl. a >256 KiB multi-chunk file + the real service end-to-end.
  - `src/worker/protocol.ts`: discriminated request/response frame union
    (`ts:init`/`ts:open`/`ts:update`/`ts:close`/`ts:invalidate`/`ts:get{Semantic,
    Syntactic,ConfigFile}Diagnostics`), fork-IPC envelope `rifty:ts-lsp` + type
    guards. Pure types/constants (modelled on the playground pty-protocol).
  - `src/worker/service-endpoint.ts`: `createServiceEndpoint` — the pure,
    Node-tested core mapping a request frame → response frame against a
    `TsLanguageService`. First `ts:init` builds the service (async lib load);
    a query before init is an ERROR frame, not a silent empty (Fidelity).
  - `src/worker/entry.ts`: the THIN, guarded boot — reads `readKernelSyncApi().call`
    to build the RPC FsSync, builds the endpoint, wires it to the page over
    fork-IPC (`process.send`/`process.on('message')`, ADR-0045/0157). Auto-boot
    is gated to a real Worker realm with the sync API present, so a type-only
    import spawns nothing (worker-entry side-effect trap). Worker logging routes
    through `process.stdout` (console is not captured). Validated by the
    playground e2e in the next task (worker globals are browser-only).
  - Public exports (`src/index.ts`): `createRpcFsSync`, `createServiceEndpoint`,
    the protocol types + guards + `TS_IPC_TYPE`; the worker boot is the
    `./worker/entry` subpath (referenced by URL, mirrors kernel/runtime-wasi).
- `getConfigFileDiagnostics()` on `TsLanguageService` (ADR-0166): surfaces
  tsconfig config-file errors (e.g. an unknown `compilerOptions` value) real
  tsserver reports, mapped through the same LSP mapper. Parity-tested vs
  `ts.parseJsonConfigFileContent` (`src/config-diagnostics.test.ts`).
- Added `@riftydev/io`, `@riftydev/kernel`, `@riftydev/runtime-js` workspace deps
  (lower tiers; the worker host reaches the kernel sync API + the proven
  `SyncRpcFsSync`). Registered the package in the publish-config generator
  (`tools/publishing/sync-publish-config.mjs`) with the `./worker/entry` export.
- `src/parity.test.ts`: parity harness (gold standard, ADR-0166). Per fixture:
  Side A builds a real `ts.LanguageService` over real Node fs (tmp dir + `ts.sys`,
  pinned `typescript@5.9.3`, NO rifty code) and computes expected semantic
  diagnostics at runtime; Side B loads the SAME bytes into a `createMemoryFs()`
  and runs `createTsLanguageService`. The SAME symmetric normalization (file,
  code, range, message; deterministic sort) is applied to both and Side B must
  deep-equal Side A. 8 divergence-prone fixtures: cross-file wrong-typed arg
  (TS2345); strict + noUnusedLocals (TS7006/6133/18047); no-tsconfig loose
  defaults (strict-only diagnostics suppressed, plain TS2322 kept);
  node_modules `.d.ts` used wrongly (TS2345, not "cannot find module");
  multiple errors per file (ordering + flatten); re-export barrel chain (TS2345);
  extensionless relative import under bundler (TS2345, no TS5097); `paths`/
  `baseUrl` alias (TS2345). All match real TS on the first run — no host bug
  surfaced. Harness teeth verified: a deliberate Side-B code mutation fails all
  fixtures with a precise gold-vs-rifty diff.
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
