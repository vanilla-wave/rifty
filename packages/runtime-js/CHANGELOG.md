# Changelog

## [Unreleased]

### Fixed

- **A self-referential `export * as Self from "."` came back as an empty namespace.**
  `rebuildExports` allocated a fresh `record.exports` object on every call. A
  `export * as ns from SPEC` re-export captures the target's `exports` object
  identity at static-import preload time; for a SELF spec (`"."` resolving to the
  module itself — a common opencode idiom in `effect-drizzle-sqlite/index.ts`,
  `core/database.ts`, `migration.ts`) that capture happened before the module's
  first rebuild, so the captured reference stayed frozen as the initial empty
  object and the self-namespace lost every export (including names merged via a
  sibling `export * from "./driver"`). `rebuildExports` now mutates the namespace
  **in place** (stable identity, getters redefined, `Symbol.toStringTag` guarded),
  so the captured self-reference reflects all later exports — matching Node 24
  (`Self.Self === Self`, `Self` carries the module's full export set). Unblocks
  opencode's `EffectDrizzleSqlite.makeWithDefaults()`. Regression:
  `tests/conformance/modules/cycles-esm.test.ts` `describe('ESM self-referential
  namespace re-export')`.

- **Resolver checked a same-named directory before a file-with-extension sibling.**
  `resolveAsFileOrDir` resolved `X` as a directory (and returned early) before
  trying `X.js`/`X.ts`/…, inverting Node's `LOAD_AS_FILE`-before-`LOAD_AS_DIRECTORY`
  order. So `./migration` (opencode's `core/src/database/database.ts`) hit the
  sibling `migration/` SQL-files directory — which has no index — and reported
  `MODULE_NOT_FOUND` instead of resolving the `migration.ts` barrel. Reordered to
  exact-file → `X`+extension → directory, matching Node 24 (`require('./foo')` with
  both `foo.js` and `foo/index.js` resolves `foo.js`). Regression-pinned by
  `describe('file-before-directory precedence (Node parity)')`.

- **`util.format('%s', obj)` printed `[object Object]` instead of inspecting.**
  Node's `%s` structurally inspects non-null objects/arrays and suffixes bigints
  with `n`; rifty was `String()`-ing everything. `%s` now matches Node for
  shallow values (deeply-nested objects still differ pending an inspector depth
  option). Parity: `cases/util/format-and-inspect.case.ts`.

- **`vfsGrep` dropped every match for a `RegExp` carrying the `g`/`y` flag.**
  `String.prototype.match` returns an index-less array under those flags, so the
  scan silently returned zero results for a valid `/pattern/g`. `toRegExp` now
  strips `g`/`y` (preserving `m/s/u/d/i`); regression tests cover both flags.

### Added

- **`async_hooks.AsyncLocalStorage` — synchronous-scope fidelity.** The
  `async_hooks` builtin gained `AsyncLocalStorage` (`run` / `getStore` /
  `enterWith` / `exit` / `disable`), implemented faithfully for synchronous
  execution and the synchronous prefix of an async function — exactly what
  opencode's `LocalContext.{provide,use}` (`util/local-context.ts`) relies on
  (`new AsyncLocalStorage()` previously threw "is not a constructor"). The store
  is **not** propagated across async scheduling boundaries (after an `await`/timer
  resumes, `getStore()` reflects the current stack's store, not the one captured
  at suspension) — faithful cross-`await` propagation needs native async-context
  tracking the browser/WASI realm does not expose. This is a documented partial
  fidelity, not a fake stub: synchronous use is byte-for-byte Node-correct.
  Parity: `cases/async_hooks/local-storage.case.ts` (synchronous); conformance:
  `async-hooks.test.ts` `describe('async_hooks.AsyncLocalStorage (synchronous
  scope)')`.

- **tsconfig-style path aliases via an opt-in `paths` resolver option (ADR-0066).**
  `ModuleLoaderOptions` gains `paths?: PathAliases` — a `pattern → target(s)` map of
  absolute VFS path patterns (e.g. `{ "@/*": "/workspace/src/*" }`). The resolver
  attempts aliases before the bare `node_modules` walk for non-relative/non-absolute
  specifiers, with tsc-faithful matching (exact > wildcard; longest static prefix
  then suffix; ordered candidate targets, first existing file wins) and
  paths-then-fallback (an alias miss falls through to `MODULE_NOT_FOUND` on the
  original specifier). Off by default = Node-faithful (a bare `@/foo` with no map is
  `MODULE_NOT_FOUND`). The resolver does NOT read tsconfig itself — the caller
  resolves `compilerOptions.paths` to absolute patterns. Unblocks the opencode
  GRAPH-LOAD wall `@/account/account` (opencode's `@/*`/`@tui/*`/`@test/*` aliases).
  Conformance: `tests/conformance/modules/resolver.test.ts` `describe('tsconfig path
  aliases (ADR-0066)')`.

- **`node:dgram` — module-resolution surface (loud browser-ceiling facade).**
  The opencode server graph pulls `multicast-dns` transitively
  (`server.ts → mdns.ts → bonjour-service → multicast-dns`), and
  `multicast-dns/index.js` does a top-level `var dgram = require('dgram')`, so the
  bare/`node:` `dgram` specifier must resolve for the static graph to evaluate.
  The browser/WASI realm has no UDP socket API (WebSocket/fetch/WebTransport are
  all stream/connection-oriented; none expose `recvfrom`/`sendto` on a UDP port),
  so this is a genuine capability ceiling: `createSocket`/`_createSocketHandle`
  and the `Socket` constructor each throw `NotImplementedError` on use, exactly
  like `tls`/`zlib`. The throw fires only if UDP is actually used (mDNS publish),
  never on import. Parity: `cases/dgram/surface.case.ts` pins the requireable
  module shape (the by-design invocation divergence is a ceiling contract, not a
  parity diff).

- **`node:worker_threads` — `markAsUntransferable` / `isMarkedAsUntransferable`
  / `markAsUncloneable` object markers.** undici's `lib/web/webidl/index.js`
  destructures `markAsUncloneable` from `node:worker_threads` and assigns it to
  `webidl.util.markAsUncloneable`, which every web-platform class (Headers,
  Request, Response, FormData, CacheStorage, WebSocket, EventTarget, …) calls in
  its constructor; the shim previously omitted it, so `new CacheStorage()` threw
  `webidl.util.markAsUncloneable is not a function`. Implemented faithfully:
  each marker is a no-op on non-objects and returns `undefined` (matching Node
  v24), the marks add no enumerable own properties, and `isMarkedAsUntransferable`
  round-trips. The tags live in module-scoped `WeakSet`s — Node stores them on
  V8 internal slots for the native structured-clone serializer, which rifty has
  no in-realm hook into; any rifty code path that re-implements clone/transfer
  in-realm consults the marks. Parity: `cases/worker_threads/markers.case.ts`.

- **`node:util/types` — full runtime type-reflection predicate set.** Promoted
  the partial 9-predicate `util.types` to a standalone faithful module
  (`builtins/util-types.ts`), registered as the standalone `node:util/types`
  builtin specifier and re-exported as `util.types`. ~40 predicates matching
  Node v24: the `ArrayBuffer` family (`isArrayBuffer`/`isSharedArrayBuffer`/
  `isAnyArrayBuffer`/`isArrayBufferView`/`isDataView`), every TypedArray
  (`isUint8Array`…`isBigUint64Array`, `isTypedArray`), keyed/weak collections and
  their iterators (`isMap`/`isSet`/`isWeakMap`/`isWeakSet`/`isMapIterator`/
  `isSetIterator`/`isWeakRef`), core objects (`isDate`/`isRegExp`/`isPromise`/
  `isNativeError`/`isArgumentsObject`/`isGeneratorObject`), functions
  (`isAsyncFunction`/`isGeneratorFunction`), and boxed primitives
  (`isNumberObject`/`isStringObject`/`isBooleanObject`/`isSymbolObject`/
  `isBigIntObject`/`isBoxedPrimitive`). Detection uses spoof-resistant brands:
  `ArrayBuffer.isView`/`instanceof` where a public brand exists, and the V8
  `Object.prototype.toString` `[[Class]]` tag for constructor-less internals
  (iterators, `arguments`, generators, boxed primitives) — matching Node's
  output for every genuine instance a dependency produces. `isProxy` throws
  rather than lie (no in-realm V8 oracle). Unblocks undici's
  `lib/web/fetch/util.js` (`require('node:util/types')` for `isUint8Array`) on
  the opencode graph. Parity: `cases/util/types.case.ts`.

- **`node:console` — faithful pure-JS builtin.** Full `Console` class over two
  writable streams (`lib/internal/console/constructor.js`): `log`/`info`/`debug`/
  `dir` → stdout, `warn`/`error`/`trace` → stderr (printf via `util.format`),
  `assert`, `group`/`groupCollapsed`/`groupEnd` indentation, `count`/`countReset`,
  `time`/`timeEnd`/`timeLog`, and `table(data[, columns])` rendering Node v24's
  box-drawing table byte-for-byte (`(index)` column, `Values` column for
  primitive rows, union of object keys, left-aligned cells, non-tabular → `log`).
  Constructor accepts positional `(stdout[, stderr])` or `{ stdout, stderr,
  inspectOptions, groupIndentation }`. Module export is the default instance
  augmented with `Console`. Unblocks undici's
  `lib/mock/pending-interceptors-formatter.js` (`new Console({ stdout })` +
  `table`) on the opencode graph. Parity:
  `cases/console/console-class.case.ts`.

- **`node:util` gains `debuglog`/`debug`.** `NODE_DEBUG`-gated lazy debug logger
  faithful to Node (`lib/internal/util/debuglog.js`): comma/space section globs
  (`*`), case-insensitive; returns a callable carrying a memoised `enabled`
  getter; the optional init callback fires on the FIRST call (not at creation);
  disabled = no-op, enabled writes `SECTION PID: <format(...)>\n` to stderr.
  `util.debug` aliases `util.debuglog`. Unblocks undici's
  `lib/core/diagnostics.js` (`debuglog('undici')`) on the opencode graph. Parity:
  `tools/node-parity-runner/cases/util/debuglog.case.ts`.

- **`node:diagnostics_channel` — faithful pure-JS builtin.** Full named
  publish/subscribe bus (`channel`, `Channel#publish/subscribe/unsubscribe`,
  `hasSubscribers`, `bindStore/unbindStore/runStores`, module-level
  `subscribe/unsubscribe/hasSubscribers`) plus `tracingChannel` /
  `TracingChannel` with the five lifecycle sub-channels (start/end/asyncStart/
  asyncEnd/error) and `traceSync`/`tracePromise`/`traceCallback`. There is no
  native binding behind this module in Node either — it is a JS-level registry —
  so the contract is mirrored exactly (parity cases under
  `tools/node-parity-runner/cases/diagnostics_channel/`). Unblocks undici's
  `lib/core/diagnostics.js` on the opencode `@effect/platform-node` graph.

- **`vfsGrep` pure-JS VFS search marker — private helper, not exported
  (feature-09 T2, Q-2026-05-30-061).** `src/utils/vfs-grep.ts` walks the VFS via
  the existing `node:fs` builtin (`readdirSync` with file types / `readFileSync`
  over `syncMirror()`) and matches lines with the JS RegExp engine — in-realm,
  ZERO process spawn. It marks the FEASIBLE side of the no-tool-execution
  (process-spawn) ceiling for the opencode facade: it reads bytes + matches like
  opencode's grep tool WITHOUT the spawn that ripgrep-the-binary needs.
  `line`/`column` are 1-based (ripgrep/Node grep convention). Private helper: no
  cross-package export via `src/index.ts`, no new builtin, no resolver intercept;
  imports only its own `builtins/fs.ts` + `@rifty/vfs` (layer-legal). Pure-JS by
  design (not ripgrep-WASM) to stay dependency-free and trivially reversible;
  ripgrep-WASM / isomorphic-git deferred behind explicit ADR ratification. Unit:
  `utils/vfs-grep.test.ts`.

- **`vfsGrep` failure-mode contract tests (feature-09 T3, Q-2026-05-30-061).**
  Pins the off-happy-path contracts callers depend on, each catching a specific
  articulated failure mode: `maxResults` truncation (bounded walk, not an
  unbounded scan), `ignoreCase` (mixed-case matching), the suffix/extension
  `include` filter (`'*.ts'` skips `/work/x.md` — minimal suffix match, NOT full
  glob; no glob dependency), recursive descent into subdirectories, and ENOENT
  propagation when the root is missing (surfaces the underlying `node:fs`
  ENOENT — NOT swallowed into an empty result; no silent stub). The committed T2
  implementation already satisfies every contract, so these are added as
  regression pins (no production change); each was verified load-bearing (goes
  red when its branch is disabled). Unit: `utils/vfs-grep.test.ts`.

- **Spawn-ceiling conformance contract (feature-09 T4, Q-2026-05-30-063).** Pins
  the IMPOSSIBLE side of the opencode no-tool-execution ceiling as a behavioral
  contract, not prose: `child_process.spawn('git', ['status'])` and
  `spawn('bash', ['-c', …])` always fall through `spawnViaSameRealm` →
  `execScript`, surfacing `spawn <cmd> ENOENT\n` on stderr with exit code 127 —
  they MUST NOT fake-succeed. This is the substrate every impossible opencode
  tool transitively hits (`Git.run` → `ChildProcess.make('git')`, the bash tool,
  the ripgrep binary). A third case re-pins that `child.stdin.write` throws
  `NotImplementedError` on the in-realm fallback (no worker stdin port — no
  silent no-op). CONFORMANCE level, NOT Node-parity: real Node WOULD spawn
  `git`, so a parity diff is the wrong tool; asserts on `git`/`bash` only (both
  always fall through, independent of the SAB/worker-url gate). No production
  change — the ceiling already exists; this locks it. opencode is NOT vendored.
  Conformance: `builtins/child_process-ceiling.test.ts`.

- **Authoritative FEASIBLE-vs-IMPOSSIBLE tool boundary doc (feature-09 T5,
  Q-2026-05-30-062).** New `docs/compat/opencode-tool-ceiling.md` — the canonical
  table of the opencode facade's no-tool-execution ceiling in the compat
  source-of-truth, cross-linked from `docs/opencode-rifty-feasibility-2026-05-30.md`.
  ✅ feasible read substitutes (`fs.readFileSync`/`readdirSync` over the VFS, the
  pure-JS `vfsGrep`, stat) each map to an fs API exercised by T1/T2/T3; ❌
  impossible tools (bash/shell spawn, native git spawn `Git.run` →
  `ChildProcess.make('git')`, the ripgrep BINARY, PTY) each map to the
  spawn/native dependency pinned by T4's ENOENT-127 conformance contract.
  ripgrep-WASM / isomorphic-git are recorded as DEFERRED behind explicit ADR
  ratification (new dependency → IRREVERSIBLE). Documentation-only; no production
  change, no test added (prose is the "always reversible" category per CLAUDE.md).

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

- **`createModuleLoader` now caches stripped TS output per resolved id, dropped
  on `invalidate(id)` (Q-2026-05-30-202, feature-02 T5).** A loader-internal
  `Map<id,string>` wraps the injected `transformSource` so the WASI esbuild
  strip runs at most once per `.ts`/`.tsx`/`.jsx` id across the import graph and
  across repeated loads within one loader instance. The cache is populated
  lazily on first hook call, read before re-invoking it, and kept coherent with
  the executed-module cache: `invalidate(id)` drops that id's stripped output,
  `invalidate()` clears all of it. `esm.ts` stays cache-unaware (the wrap is
  invisible to the execute path). Performance/REVERSIBLE only — no public-API or
  behaviour change for callers, plain-JS loaders unaffected. Unit:
  `loader-transform.test.ts`.

- **GOLD multi-file `.ts` parity case closes P0 (ADR-0052, feature-02 T7).** A
  cross-file `.ts` graph (`b.ts` exports a type-only `interface`, an `enum`, and
  a type-annotated `const`; `a.ts` imports the erased type + the value and prints
  `base + box.n + Color.G` → `43`) runs through the rifty loader's real esbuild
  WASI `transformSource` hook and is diffed against Node — proving type-stripping,
  `enum` lowering, and cross-file ESM load order match a full-TS-transform Node
  reference at the unit-of-language level, independent of opencode VFS contents.
  This is the P0 acceptance signal ADR-0052 requires.
  `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`. The
  `ts-esm` parity Node reference is the vendored `tsx` (a FULL TS transform),
  not Node strip-only `--experimental-strip-types` (which throws
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on `enum`) — matching rifty's esbuild full
  transform (TODO(ADR): Q-2026-05-31-201).

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
