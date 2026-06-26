# Changelog

## [Unreleased]

### Fixed

- **Diagnostics compat row no longer overclaims tags/related info.** The
  generated TS language-service matrix now marks diagnostics `⚠️` until
  `relatedInformation` plus unused/deprecated diagnostic tags are plumbed through
  the LSP wire shape, worker/client, Monaco markers, and parity oracle.

- **Worker boot is idempotent for explicit hosts.** A host wrapper can call
  `bootTsLanguageServiceWorker()` directly to pin bundler reachability without
  double-registering fork-IPC handlers if the guarded auto-boot already ran.

- **TS rename/inlay parity holes closed.** Import-path rename now follows
  TypeScript's `getRenameInfo().fileToRename` → `getEditsForFileRename` path, so
  renaming `"./impl"` to a new file emits the same relative import edit real TS
  emits instead of inserting the raw absolute path. Inlay hints now pass the
  caller's TS preferences faithfully, including `undefined`, rather than forcing
  editor defaults into headless service calls. Interactive inlay label parts and
  encoded semantic format variants are explicit parked backlog rows, not ✅ claims.

- **TS edit/action APIs now reach the clone-safe option ceiling.** Code fixes,
  organize imports, fix-all, file-rename edits, JSDoc templates, and paste edits
  now accept and forward their structured-clone-safe TS preferences/format
  settings instead of hardcoding `{}`/default formatting; refactor action
  precompute honors formatting options and gates `getEditsForRefactor` before
  calling it. Workspace edits now preserve `FileTextChanges.isNewFile`, and
  completion lists/items preserve TS list flags, global/member/new-identifier
  metadata, list `metadata`, kind modifiers, label/source metadata, resolved source display, and
  recommendation/import flags. Organize imports honors TS `mode` /
  `skipDestructiveCodeActions`; paste edits preserve `fixId`; refactor actions
  preserve parent/action metadata and TypeScript's already-zero-based action
  ranges, and unavailable refactor edits now cross the worker protocol as a
  normal `null`, not a transport error. Completion
  Deprecated completion `includeExternalModuleExports` is forwarded as a
  clone-safe alias. Completion `includeSymbol` is now a loud
  `NotImplementedError` in both top-level and preferences forms because TS
  returns a live compiler `Symbol` graph.

- **Endpoint serializes frames behind the in-flight `ts:init`** (ADR-0166; fixes the chromium e2e `received a request before ts:init` race). The fork-IPC pump dispatches each frame independently, and `ts:init` is async (it awaits the ~3 MB std-lib over the owner relay + parses tsconfig over fs.* sync-RPC), so an `open`/diagnostics frame the page sent right after init reached the endpoint while the service was still building and FAILED with a misleading "before ts:init" — which the page never re-sent, so no diagnostics ever appeared on a slow (2-core CI) cold boot. The endpoint now stores the build promise synchronously and every later frame `await`s it (ordering preserved, no barrier), so a frame racing a slow cold init WAITS instead of failing. A *failed* init now surfaces the REAL cause on the failing frame AND every queued frame (e.g. an owner-store error), never the misleading "before ts:init". Only a frame with NO `ts:init` ever sent still errors. New endpoint tests (concurrent-frame-before-init-resolves; real-init-error-surfacing).
- **Out-of-program paths are honest-empty, never a "Could not find source file" throw** (fixes the chromium e2e `Could not find source file: '/workspace/src/main.js'` crash). The raw `ts.LanguageService` throws for any path it has no `SourceFile` for — e.g. the default playground's `.js` entry, opened in the editor but excluded from the program because `allowJs` is off and there is no tsconfig. Every path-taking query/diagnostic now gates on `getProgram().getSourceFile(path)` and returns an honest empty (`[]`/`null`/empty edit) for a file outside the program — what real tsserver answers for a file in no project — instead of crashing. NOT a lying empty: such a file genuinely has no program-level result.
- **Endpoint error frames serialize non-object throwables.** If dependency setup throws `null`/a string instead of an `Error`, the worker now returns a normal `Error` frame and only reads `feature` from object throwables, never crashing while trying to report the crash.
- **Clone-safe TypeScript query options are no longer dropped or hardcoded.** Hover honors `maximumLength`; completions/details pass clone-safe TS preferences and format settings, including trigger-character contexts; signature help forwards character-typed trigger reasons; rename exposes `allowRenameOfImportPath`, `findInStrings`, and `findInComments`; inlay hints and refactors accept the real TS preferences/filter knobs. Older workspace TypeScript methods now fail as feature-tagged `NotImplementedError`s instead of raw `TypeError`s.

### Added

- **Hard-ceiling TS language-service surface.** The service now exposes the
  remaining achievable `ts.LanguageService` editor/agent surface: refactors,
  navigation/folding/workspace symbols, inlay hints, highlights,
  classifications, call hierarchy, on-type formatting, implementation,
  suggestion/compiler-options diagnostics, definition links, fix-all,
  file-rename edits, selection ranges, file references, JSX close tag, linked
  editing, paste edits, JSDoc templates, TODO comments, name/dotted spans,
  breakpoint spans, navigation bar items, brace matching, indentation,
  comment toggles, move-to-file suggestions, emit output, supported-code-fix
  inventory, and exact completion resolve via `source`/`data`. Completion list
  items now preserve TS replacement spans, snippets, commit characters, and
  completion code-action edits/commands. Refactor edits preserve TS post-edit
  rename metadata and command/not-applicable metadata. Raw
  `getSemanticClassifications` / `getSyntacticClassifications` are exposed
  separately from encoded token classifications; `getNavigateToItems` preserves
  `maxResultCount`/`fileName`/exclude flags; `toLineColumnOffset`,
  `getReferencesAtPosition`, `cleanupSemanticCache`, and `dispose` are wired
  through service/protocol/client. Workspace
  `node_modules/typescript` is used when
  present and valid (ADR-0169), with loud failure on a broken installed compiler;
  `applyCodeActionCommand` is a loud `NotImplementedError` because TS uses it for
  package-install side effects, not VFS text edits. `getProgram` and
  `getCompletionEntrySymbol` are also loud feature-tagged `NotImplementedError`s:
  they return live compiler object graphs/Symbols, not structured-clone-safe
  protocol values.

- **`ts:init` phase-timing logs** (`CreateTsLanguageServiceDeps.log`, wired from the worker entry to stdout → owner → page console): std-lib loaded / tsconfig parsed / language service created, each with elapsed ms, so a slow or wedged cold boot is observable end-to-end on CI.

- **Quick-fixes / organize-imports / formatting** (ADR-0166 task 4.1).
  `TsLanguageService` gains `getCodeFixes(path, range, errorCodes)` (→ LSP
  `CodeAction[]` from `getCodeFixesAtPosition`; each `CodeFixAction` → `{ title:
  description, kind: 'quickfix', edit: WorkspaceEdit }`. NB tsc only returns a fix
  when the request span lies WITHIN the diagnostic span, so an editor passes a
  diagnostic's own range + that diagnostic's `code`s), `organizeImports(path)` (→
  `WorkspaceEdit` from `organizeImports({type:'file'})`; sorts + de-dups + drops
  unused imports; empty `changes` on an already-organized file — an honest no-op),
  `getFormattingEdits(path, options)` (→ `TextEdit[]` from
  `getFormattingEditsForDocument`), and `getRangeFormattingEdits(path, range,
  options)` (→ `TextEdit[]` from `getFormattingEditsForRange`). New LSP shapes
  `CodeAction` (string `kind`) + `FormattingOptions` (`{tabSize, insertSpaces}`).
  Two shared `mapping.ts` helpers: `fileTextChangesToWorkspaceEdit` (ts
  `FileTextChanges[]` → `WorkspaceEdit`, grouped by fileName, each span mapped
  against that file's text — reused by code-fixes AND organize-imports) and
  `formattingOptionsToFormatCodeSettings` (a full `ts.FormatCodeSettings` from
  `ts.getDefaultFormatCodeSettings('\n')` — tsserver's exact defaults — overriding
  only `tabSize`/`indentSize`←`options.tabSize` and `convertTabsToSpaces`←
  `options.insertSpaces`; code-fixes + organize-imports use the tabSize-4/spaces
  default). New worker frames `ts:getCodeFixes`/`ts:organizeImports`/
  `ts:getFormattingEdits`/`ts:getRangeFormattingEdits` → `codeActions` / reused
  `workspaceEdit` / `textEdits` responses. Every query is parity-checked against
  the real `ts.LanguageService` (gold standard, IDENTICAL FormatCodeSettings on
  both sides — the same `formattingOptionsToFormatCodeSettings` feeds both):
  missing-import quick-fix (TS2304: import + decl fixes); organize-imports on an
  unsorted+unused import set; formatting a badly-spaced + wrongly-INDENTED file
  (whole-doc + a scoped range; the indentation makes the edits depend on `tabSize`
  so a divergent setting would break parity, not hide).

- **Find-references / rename (+prepare-rename) / signature-help** (ADR-0166 task 3.1).
  `TsLanguageService` gains `getReferences` (→ LSP `Location[]` from
  `findReferences` flattened; honors `ReferenceContext.includeDeclaration` by
  filtering `isDefinition` entries — note tsc only flags definitions when the
  query originates at the declaration), `prepareRename` (→ `PrepareRenameResult |
  null` from `getRenameInfo`; `null` on keywords/string-literals/non-renameable
  import paths, `allowRenameOfImportPath: false`), `getRenameEdits` (→
  `WorkspaceEdit` keyed by VFS path from `findRenameLocations` with
  `providePrefixAndSuffixTextForRename`, honoring each location's prefix/suffix
  text so property-shorthand `{ x }` → `{ x: newName }` is correct; empty
  `changes` when not renameable), and `getSignatureHelp` (→ `SignatureHelp | null`
  from `getSignatureHelpItems`; label = prefix + params joined by separator +
  suffix, `activeSignature` = selectedItemIndex, `activeParameter` =
  argumentIndex). New LSP shapes (`ReferenceContext`, `TextEdit`, `WorkspaceEdit`,
  `PrepareRenameResult`, `SignatureHelp`, `SignatureInformation`,
  `ParameterInformation`) + worker frames (`ts:getReferences`, `ts:prepareRename`,
  `ts:getRenameEdits`, `ts:getSignatureHelp` → `locations` / `prepareRename` /
  `workspaceEdit` / `signatureHelp` responses). Every query is parity-checked
  against the real `ts.LanguageService` (gold standard) for cross-file symbols
  (references with includeDeclaration both ways, cross-file rename incl. shorthand
  prefix, prepareRename true/null, signature-help between args).

- **Hover / go-to-definition (+type-definition) / completions** (ADR-0166 task 2.1).
  `TsLanguageService` gains `getQuickInfo` (→ LSP `Hover`: signature as a
  `typescript` code block + rendered JSDoc/tags, range from the symbol span),
  `getDefinition`/`getTypeDefinition` (→ `Location[]`, target span mapped against
  the target file's own text via the host), `getCompletions` (→ `CompletionList`;
  `ts.ScriptElementKind` → LSP `CompletionItemKind`), and `getCompletionDetails`
  (resolves one entry's `detail`+`documentation`, threading the entry's real
  `source`/`data` so same-name auto-imports resolve exactly). New LSP
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

### Documented

- **Long-tail parity test granularity tracked.** Added a backlog contract to split
  the broad TS-LS long-tail parity test by feature with non-vacuity guards.

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
