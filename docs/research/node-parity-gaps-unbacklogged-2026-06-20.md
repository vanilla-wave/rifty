# Node-paritet: реализуемые gap'ы вне бэклога

Свип Node API surface на пересечении трёх условий:
1. **Реализуемо** для паритета с реальной экосистемой Node (pure-JS алгоритм или браузерный примитив, дающий Node-идентичное наблюдаемое поведение — без happy-path заглушек).
2. **Не упирается в hard-ceiling браузера** (исключены: raw TCP/UDP/TLS/HTTP2-сокеты, native .node addons, реальные OS-потоки/сигналы, full async-context propagation, inspector/V8-snapshots).
3. **Не записано в бэклоге** (проверено против всех `docs/backlog/*`, включая catch-all'ы `node-builtins-loud-stub-capability-gaps`, `crypto-sync-subset-expansion`, `zlib-web-compression-subset`, `buffer-pending-statics`, `compat-matrix-coverage-debt`).

**Метод:** оркестрация — 12 finder-агентов веером по подсистемам (каждый грепал `packages/*/src` + `docs/backlog` для подтверждения), затем независимый adversarial-верификатор на каждую подсистему (рефьютил ложные кандидаты grep'ом по дереву), затем дедуп + синтез. 25 агентов, ~1.3M токенов. Дата: 2026-06-20.

**Итог: 110 подтверждённых gap'ов** по 12 подсистемам. Каждый — absent в коде, absent в бэклоге, faithfully-buildable.

> Effort: **S** = часы/обёртка · **M** = ограниченная новая логика + parity-тесты · **L** = существенная новая поверхность/алгоритм.
> Несколько пунктов одновременно **чинят активные fidelity-баги** (молчаливые расхождения с Node), а не только добавляют API — отмечено в тексте.

---

## Приоритизированный шортлист (top 15)

| # | Фича | Модуль | Impact | Effort | Почему важно пользователям |
|---|---|---|---|---|---|
| 1 | globalThis.global alias (global === globalThis) | web-globals / worker-entry | high | S | One-line install next to existing Buffer/process/timers. Unblocks the pervasive CJS pattern global.X / typeof global!=='undefined' baked into process-polyfills, webpack-shimmed bundles, and jest-style libs — these ReferenceError today. Broadest reach for the least code. |
| 2 | fs.readdir recursive ({recursive:true}) + fs.Dirent.parentPath | fs-path | high | S | Pure-JS DFS over existing per-dir VFS readdirSync; parentPath resolves full paths for withFileTypes. Bundlers, test runners, and build tools (the core scenario) walk trees this way. Implement the pair together. |
| 3 | util.parseArgs([config]) | runtime-js/util | high | M | Pure-JS, no platform dep. Modern CLIs use it to drop minimist/yargs/commander — directly serves the pure-JS-CLI mission scenario. High demand, bounded surface. |
| 4 | node:stream/web module | streams | high | S | Thin re-export of Chromium WHATWG globals (Node's impl IS WHATWG). Many libs import {ReadableStream,...} from 'node:stream/web'; cheapest unblock of the whole stream-web family. |
| 5 | crypto.randomBytes async (callback overload) | crypto | high | S | Deferral of the available sync getRandomValues path — faithful and tiny. express-session, csrf, uuid-ish, key/token gen all call the (err,buf) callback form, which is absent today. |
| 6 | assert.match / ifError / rejects (+ doesNotMatch/doesNotReject) | node:assert | high | S | Test-suite and callback-style staples, all reusing existing AssertionError/matchesExpected. ifError is pervasive in legacy callback(err) code; rejects is an async-test must-have. |
| 7 | events.on(emitter,name) async-iterator + events.once signal overload | node:events | high | M | for-await-of over emitters is a common modern idiom (node:test, many CLIs/stream pipelines); the once-with-AbortSignal cancellation pattern is widespread. Pure-JS over existing EventEmitter. |
| 8 | util.inspect option fidelity (depth/colors/single-quotes) + inspect.custom | runtime-js/util | high | L | Fixes an active divergence: 3rd positional is depth not options, so util.inspect(obj,{depth:null}) misreads as NaN, and strings use double quotes (Node uses single). console.log fidelity touches every program. Larger but high-value. |
| 9 | import.meta.resolve(specifier[,parent]) — real resolution | process-module-loader | high | M | Replaces a silently-WRONG stub (bare/node: specifiers return bad file:// URLs) by threading the loader's existing real resolver. ~30 ESM packages compute paths via it since Node 20.6. Fidelity fix, not just a feature. |
| 10 | process.emitWarning + module.isBuiltin | process-module-loader | high | S | emitWarning: libs surface deprecations through it (absent → warnings vanish or crash); self-contained over existing EventEmitter+stderr. module.isBuiltin: bundlers/loaders (tsx, jiti) externalize via it; one-liner over the existing registry. Two cheap, common wins. |
| 11 | querystring '+' -> space + util.format %c (active fidelity bugs) | runtime-js/util+querystring | med | S | querystring.parse('a=b+c') wrongly yields 'b+c' (Node: 'b c') — express/formidable depend on querystring. %c keeps the literal AND fails to consume its arg. Both are silent divergences from real Node; write failing parity tests first. |
| 12 | buffer.readUIntLE/BE+writeUIntLE/BE+IntLE/BE, buffer.toJSON, node:buffer module exports | buffer-url-encoding | med | S | Variable-width readers/writers unblock binary-protocol/file-format parsers (48-bit reads); toJSON is the standard {type:'Buffer',data} serialization round-trip (express bodies, logging). Module-level Blob/File/atob/btoa/isUtf8/isAscii are native re-exports. |
| 13 | Writable cork/uncork/writev batching (fixes lying writev option) | streams | med | M | cork/uncork batching is used by pino/file-write paths; also fixes the live fidelity bug where the declared writev? option does nothing (no-silent-stub rule). Real pure-JS over existing drain machinery. |
| 14 | process.loadEnvFile + cli --env-file | process-module-loader | med | M | Shared deterministic dotenv parser over VFS. --env-file is the increasingly-common Node-native way to load env before main (CLIs/scripts). Couple the two; parity-test the parser against real Node first. |
| 15 | ServerResponse header-introspection (appendHeader/getHeaderNames/getHeaders/hasHeader) + http.METHODS | net/http | med | M | express/getHeaders-using middleware needs the header-map methods (clean pure-JS over existing _headers); express/router libs read http.METHODS per-verb. Directly serves the Express scenario. Loud-throw the interim-response methods. |

---

## Полный отчёт по подсистемам

Audit of verified, unrecorded, faithfully-buildable Node parity gaps. Every item below is confirmed absent in code, absent from backlog/compat-matrix, browser-implementable, and buildable REAL (pure-JS algorithm or browser-native primitive that matches Node observable behavior) — no happy-path stubs. Cross-subsystem duplicates have been merged (notably `util.*`, `process.emitWarning`, `import.meta.resolve`, `module.isBuiltin`, `module.SourceMap/findSourceMap`, and the `buffer.*` module-level exports, each of which surfaced in two finder passes).

Effort: S = hours/wrapper, M = bounded new logic + parity tests, L = substantial new surface or a new algorithm. Fidelity-risk reflects how easily a faithful impl could silently diverge from Node (must be pinned vs parity-runner).

---

## 1. fs / path (`node:fs`, `node:path`)

VFS already exposes the sync primitives every item here needs (`readdirSync`, `utimes`, `cpSync`, `readFileBytesSync`, `existsSync`). Most gaps are pure-JS composition over those, plus a few POSIX-only identity cases that are faithful precisely because rifty ships POSIX-only (`win32 === posix`) and the no-symlink model (ADR-0050, `lstat === stat`).

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **fs.readdir recursive** | `readdirSync(p,{recursive:true})` · v18.17/v20 | Pure-JS depth-first walk joining relative paths over per-dir `vfs.readdirSync` (`packages/vfs/src/fs-sync.ts:27`). Add `recursive` to the opts type at `fs.ts:520`. | high — bundlers, test runners, build tools walk trees | S | low — exact Node algorithm |
| **fs.Dirent.parentPath** (+ deprecated `path` alias) | `Dirent.parentPath` · v20.1/v21.4 | Set a string field at construction in the `Dirent` class (`fs.ts:189`). Needed so recursive `withFileTypes` resolves full paths. | high — coupled to recursive readdir | S | low |
| **fs.glob / globSync / promises.glob** | v22 (stable) | Pure-JS segment matcher (`*`/`**`/`?`/`[..]`) over the recursive VFS walk; no native primitive. | med — many CLIs/build tools glob | L | **med** — Node delegates to a real glob engine (brace/extglob/negation); pin vs parity, throw on unsupported edges |
| **path.matchesGlob / posix.matchesGlob** | v22.5 | Glob-to-regex over a single string; shares matcher with fs.glob. (`path.ts:108`) | low | M | **med** — same glob-semantics parity as above |
| **fs.openAsBlob** | `Promise<Blob>` · v19.8 | Read VFS bytes, `new Blob([bytes],{type})`, resolved Promise. Blob is a browser global. | low | S | low — watch `options.type` default |
| **fs.cp/cpSync edge options** | `{filter,force,errorOnExist,preserveTimestamps}` · v16.7 | `cp` exists (`fs.ts:631`) — gap is the option surface. Build filter-gate/existsSync-checks/utimes in the runtime-js layer over the existing `cpSync`. `dereference` → `NotImplementedError` (N/A under no-symlink, not a ceiling). | med — many copy helpers pass these | M | low |
| **path.toNamespacedPath / posix** | v9 | POSIX identity no-op returning input — that IS faithful Node behavior (win32 namespacing is the only non-identity case; rifty is POSIX-only). | low — cross-platform libs call it unconditionally | S | low |
| **fs.lutimes / lutimesSync / promises.lutimes** | v14.5 | Identical to utimes under no-symlink model (same precedent as `lstat===stat`, `fs.ts:580`). VFS utimes exists (`fs-sync.ts:48`). | low | S | low |
| **fs.futimes / futimesSync** | v0.4 | `fdTable`/`getFd` already resolve fd→path (`fs.ts:110/396`); delegate to existing utimes ms-conversion. `EBADF` on unknown fd. | low — tar/archive tools | S | low |

---

## 2. streams (`node:stream`, `node:stream/web`)

`Readable.fromWeb` already proves the WHATWG bridge works in-realm (`readable.ts:897`); the rest of the bridge and the modern static surface is honestly unclaimed (ADR-0154 leaves it "unclaimed until implemented"; `compat/streams.md` ❌ rows are doc-visibility only, not impls). All items are pure-JS / browser-native `ReadableStream`/`WritableStream` adapters over existing EventEmitter lifecycle — no network/OS.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **node:stream/web module** | v16.5 (stable v18) | Node's `node:stream/web` IS the WHATWG impl — thin re-export mapping `ReadableStream`/`WritableStream`/`TransformStream`/readers/`TextEncoderStream`/`TextDecoderStream` to Chromium globals. Re-export whatever the platform provides; throw on truly-missing names (BYOB may be absent in some builds). No ADR (no network). | med — many libs `import {…} from 'node:stream/web'` | S | low |
| **Readable.toWeb** | v17 | Wrap Node `Readable` data/end/error in a `ReadableStream` underlying source (pull + cancel→destroy). | med | M | low |
| **Writable.toWeb / Writable.fromWeb** | v17 | toWeb: `WritableStream` sink awaiting Node drain (already modeled), close→end, abort→destroy. fromWeb: pump `_write`→writer.write, `_final`→close, destroy→abort. | med | M | low |
| **Duplex.toWeb / fromWeb** | v17 | Compose the Readable/Writable web adapters (`{readable,writable}`). Depends on the above landing first. | low | M | low |
| **Writable cork / uncork / writev batching** | v0.11 | Corked counter defers drain; on `uncork` flush buffered chunks via `_writev`. **Also fixes a live fidelity bug**: `writev?` is declared in `WritableOptions` (`writable.ts:20`) but used NOWHERE — `drainBuffer` always calls `writeImpl` per-chunk. That lying type-only placeholder must either work or be removed (no-silent-stub rule). | med — pino/file-write batching | M | low |
| **Readable async-iterator helpers** | `map/filter/forEach/reduce/toArray/take/drop/flatMap/some/every/find` + `iterator(opts)` · v17/stable v22 | Lazy async transforms over the existing `[Symbol.asyncIterator]` (`readable.ts:682`) with concurrency/signal options. | med — rising ecosystem use | L | low |
| **stream.addAbortSignal** | v15.4 | Browser `AbortSignal`: abort listener → `stream.destroy(AbortError)`; half-built inside `fromWeb`. | low | S | low |
| **stream.isReadable/isWritable/isErrored/isDisturbed** | v17.3/v16.14 | Module-level predicates reading existing `_readableState`/`_writableState`. `isDisturbed` may need an explicit "disturbed" bit rather than deriving (don't approximate). | low | S | low |
| **stream.Readable.wrap** | v0.9 (Streams1 adapter) | Subscribe to legacy stream data/end/error, `push()` honoring pause/resume backpressure. | low — old packages | M | low |
| **stream.compose** | v16.9 (experimental) | A Duplex wiring stages via existing `pipeline.ts`. All in-realm. | low | M | low |
| **stream.Duplex.from** | v16.8 | Reuse `Readable.from` for read side + passthrough write side; throw on unsupported source shapes. | low | M | low |
| **stream.getDefaultHighWaterMark / setDefaultHighWaterMark** | v19.9 | Two module vars (16384 bytes / 16 objects) read by ctors when HWM unset (ctors hardcode `?? 16*1024` today). | low | S | low |

---

## 3. events (`node:events` static helpers + EventEmitter statics)

NOT covered by the `node-builtins-loud-stub` catch-all (which enumerates tls/dns/readline/etc., never `node:events`). The `events` factory exports only `EventEmitter`+`once`. Instance methods (`listeners`, `listenerCount`, `getMaxListeners`, `setMaxListeners`) and `defaultMaxListeners`/`captureRejectionSymbol` already exist — most statics are thin wrappers. `AbortSignal` is browser-native and already used across the codebase.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **events.on(emitter,name[,opts]) → AsyncIterableIterator** | v13.6/v12.16 | Buffered queue + Promise resolvers on `emitter.on/off`; `AbortSignal` ends iteration. Pure-JS, well-specified. | med — `for-await-of` over emitters; used by node:test, many CLIs | M | low |
| **events.once signal/AbortSignal overload** | v15.0 | Extend existing `once()` (`event-emitter.ts:211`) to accept `options.signal`; reject with AbortError + detach. | med — common cancellation idiom | S | low |
| **EventEmitter.errorMonitor symbol** | v13.6 | `static errorMonitor=Symbol`; in `emit('error')` invoke errorMonitor listeners first, then throw-if-unhandled. | low | S | low |
| **EventEmitter captureRejections** (option + static default + `nodejs.rejection`) | v13.4 | In `emit()`, if enabled and listener returns a thenable, `.catch` → `this[captureRejectionSymbol]` or `emit('error')`. `captureRejectionSymbol` already defined. | low | M | low — M because it needs ctor-options support while preserving the current constructor-less express/`util.inherits` idiom |
| **events.getEventListeners** | v15.2 | Delegate to instance `listeners(name)` (`event-emitter.ts:171`); EventTarget branch returns `[]` (matches Node — no introspection). | low | S | low |
| **events.getMaxListeners (static)** | v19.9 | Wrapper over instance `getMaxListeners()`. | low | S | low |
| **events.setMaxListeners(n[,...targets])** | v15.4 | No-target → set `EventEmitter.defaultMaxListeners`; with targets → loop. | low | S | low |
| **events.addAbortListener → Disposable** | v20.5/v18.18 | Browser `AbortSignal`: aborted→`queueMicrotask(listener)`, else `addEventListener('abort',…,{once})`; return `{[Symbol.dispose]}`. | low | S | low |
| **events.listenerCount (static, deprecated)** | v0.9 (dep) | Wrapper over instance `listenerCount` (`event-emitter.ts:163`). Some legacy packages still call it. | low | S | low |
| **events.EventEmitterAsyncResource** | v17.4 | Subclass wrapping `emit` in `AsyncResource.runInAsyncScope` (`misc-stubs.ts:43`). | low | M | **med** — sync-scope faithful only (matches existing AsyncResource/ALS stance); cross-await context propagation is a hard ceiling — document the subset |

---

## 4. crypto (`node:crypto`)

`getRandomValues` (sync, browser-native) already backs `randomBytes`/`randomFillSync` (`crypto.ts:114/120`). The async/one-shot/`randomInt` gaps are all faithful deferrals or thin wrappers over the existing sync cores. NOT covered by either catch-all (`crypto-sync-subset-expansion` is scoped to ciphers/KDF/sign/sha512; the loud-stub item lists only `Hash.copy`).

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **crypto.randomBytes async (callback overload)** | v0.5 | Wrap existing sync fill in `queueMicrotask` → `callback(null,buf)`; reproduces Node's deferred `(err,buf)` contract. Throw on `size>kMaxLength` like Node. | med — express session, csrf, key/token gen call the callback form | S | low |
| **crypto.randomInt([min,]max[,cb])** | v14.10 | Pure-JS rejection sampling over `getRandomValues` → uniform unbiased int; `RangeError` on bad bounds; `(err,n)` callback overload. | med — id/token/test-fixture generation | S | low |
| **crypto.hash (one-shot)** | v20.12/v21.7 | Thin sync wrapper over existing `createHasher` cores (Sha256/Sha1/Md5, `crypto.ts:269`); unsupported algo already loud-throws via `createHasher`. | med | S | low |
| **crypto.randomFill (async callback form)** | v7.10 | Reuse `randomFillSync` then `queueMicrotask`→callback. Pairs with randomBytes-async. | low | S | low |

---

## 5. util (`node:util`) — merged across two finder passes

`util.ts` default export lacks every item below. All pure-JS, no platform dep. Several reuse existing machinery (`assert.ts deepEqualImpl`, `util.ts deprecate`, `os.ts errno table`). `process.stdout.isTTY` is always false (`process.ts:102`) → color-gating defaults off, which is Node-faithful for a non-TTY.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **util.parseArgs([config])** | v18.3/stable v20 | Node's `parse_args` is plain JS (no native dep). Faithfully implement strict-mode errors, `tokens`, `multiple`, short, `allowNegative`, `allowPositionals`. | high — modern CLIs use it to drop yargs/minimist/commander | M | low |
| **util.inspect option fidelity** | depth/colors/getters/numericSeparator/sorted/maxArrayLength/breakLength + `inspect.custom` + single-quote strings + `defaultOptions` | `repl/inspect.ts` signature `inspect(value,depth=0,seen)` IGNORES options; **3rd positional being `depth` not `options` is an active divergence** — `util.inspect(obj,{depth:null})` is misread as depth=object→NaN. `formatString` uses `JSON.stringify` → double quotes (Node uses single). Node's inspect is pure JS — fully real in-realm. | high — console.log fidelity everywhere | L | **med** — faithful colors/getters/sorted/breakLength is substantial |
| **util.isDeepStrictEqual(a,b)** | v9 | Near-free: re-export `assert.ts deepEqualImpl` with `strict=true` returning boolean. Verify typed-array/boxed-primitive/Map/Set edges. | med | S | low |
| **util.styleText(format,text[,opts])** | v20.12/stable v22 | Pure-JS ANSI SGR table; `validateOneOf` throws on unknown format. Defaults no-color in non-TTY (faithful). | med | S | low |
| **util.stripVTControlCharacters** | v16.11 | Pure-JS strip using the exact ansi-regex Node bundles. Pairs with styleText. | low | S | low |
| **util.getSystemErrorName / getSystemErrorMap / getSystemErrorMessage** | v9.7 / v16.0 / v23.1 | Build negative-errno→`[code,msg]` reverse map from the libuv errno list (`os.ts:130` is positive-keyed — must negate + carry libuv message strings). | low | S | **med** — must match Node's exact sign + message strings byte-for-byte |
| **util.formatWithOptions** | v10 | Same printf engine threading `inspectOptions` into inspect for `%o/%O`. **Implement together with inspect-options** — today inspect ignores options, so options would be silently dropped (a lying stub). | low | M | **med** — coupled to inspect-options |
| **util.MIMEType / MIMEParams** | v19.9 | Hand-built WHATWG MIME parser (no native MIMEType global); deterministic string algorithm. | low — mostly internal to content-type libs | M | low |
| **util.aborted(signal,resource)** | v17.3 | `Promise` + `signal.addEventListener('abort',resolve,{once})`. WeakRef-to-resource for GC parity is optional honest edge. | low | S | low |
| **util.parseEnv(content)** | v21.7 (experimental) | dotenv-format line parser (string algorithm). | low | S | **med** — must match Node's specific dotenv quirks (multiline quoted, export prefix, `#`), NOT the npm dotenv package's |
| **util.getCallSites([n][,opts])** | v22.9 (experimental) | V8 is the engine (D-001) → `Error.prepareStackTrace` yields real CallSite fields. `sourceMap:true` + exact eval-origin are documented subset edges (throw if requested). NOT a hard ceiling. | low | M | **med** — column/source-map exactness |
| **util.format %c specifier** | v12 | `format()` switch (`util.ts`) handles only s/d/i/f/j/o/O — `%c` falls through, keeps literal AND fails to consume the arg. Add `case 'c'`: consume arg, append `''`. **Active divergence.** | low | S | low |
| **util.toUSVString** | v11 | Lone-surrogate→U+FFFD via deterministic regex. | low (deprecated-ish) | S | low |
| **util.isArray / util._extend (deprecated)** | v0.6 | `Array.isArray` / own-enumerable copy; fire DeprecationWarning via existing `deprecate()` (`util.ts:184`). | low | S | low |

---

## 6. process / module-loader / import.meta — merged across two finder passes

The `.env` parser is shared across `process.loadEnvFile` + `--env-file`. `import.meta.resolve` and `module.isBuiltin`/`SourceMap`/`findSourceMap` each surfaced twice and are merged here.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **process.emitWarning(warning[,opts])** | v6 | `RiftyProcess` extends EventEmitter + has `stderr.write` (`process.ts:86/103`); build Warning (name/code/detail), `emit('warning')`, format `(node:1) Warning: …`, dedupe identical. Pure-JS, self-contained. | med — libs surface deprecations through it; absence silently drops them or crashes | S | low |
| **import.meta.resolve(specifier[,parent])** | v20.6 (stable) | **Replaces a lying stub**: `esm.ts:180` inlines `(s)=>new URL(s,__importMetaUrl).href` — a bare `'lodash'` or `'node:fs'` returns a WRONG `file://` URL silently. The loader's real resolver (`loader.ts:130`→`resolver.ts:112`: node_modules walk, exports/imports conditions) already exists; thread it in. node: builtins → `node:` URL; throws `ERR_MODULE_NOT_FOUND` like the existing resolver. | med — ~30 ESM packages compute paths via it; fidelity-improvement | M | low |
| **module.isBuiltin(name)** | v18.6/v16.17 | One-liner over the existing `isBuiltinSpecifier` registry helper (strips `node:`). | med — bundlers/loaders (tsx, jiti) externalize via it | S | low — honest subset: registry only knows registered builtins; net-registered names appear after net loads, genuinely-absent builtins return false (document boundary) |
| **process.loadEnvFile([path])** | v21.7/v20.12 | Deterministic dotenv parser over `syncMirror().readFileBytesSync` (already imported). Shares parser with `--env-file`. | med | S | low — parser must match Node's edge cases; write parity tests first |
| **cli --env-file / --env-file-if-exists** | v20.6/v20.12 | Same `.env` parser invoked in the entry bootstrap BEFORE `loader.import`, populating `process.env`. `node-entry.ts` parses NO flags today — needs an argv/flag seam. `-if-exists` swallows ENOENT only. | med | M | low |
| **module.stripTypeScriptTypes** | v23.10/v22.13 | Node's API is SYNCHRONOUS pure type-erasure. Build a sync pure-JS type-eraser (the existing strip is the ASYNC WASI esbuild hook, can't be called sync in a worker). NOT covered by `ts-strip-transform-cache` (that item is about caching the async output). | low | L | **med** — must match Node's strip semantics (error on enum/namespace/non-erasable unless transform mode); partial-but-honest (throw on unsupported) acceptable; L = a new stripper, not a wrapper |
| **process.getBuiltinModule(id)** | v22.3 | Wrapper over `loadBuiltin(id) ?? undefined`. | low | S | **high (wiring, not API-divergence)** — REGRESSION TRAP: `net/src/sqlite/engine.ts:48` + `engine-shimmed-process.test.ts` use the ABSENCE of this method as the "not a real Node realm" signal. Adding it breaks sqlite init. MUST refactor that detection (e.g. `versions.rifty` marker) + update the pinning test, regression test first |
| **module.SourceMap class + module.findSourceMap(path)** | v13.7 / v13.7 | Decode infra exists internally (`module-loader/source-maps.ts`: `SourceMapRegistry`, `decodeSourceMap`); surface a class with `.payload`/`.findEntry`/`.findOrigin`. | low — test/coverage tooling | M | **med** — registry tracks only INLINE maps for loaded modules + is per-loader; Node's is process-global over external `.map` files too. Build as documented subset (null for untracked, as Node returns undefined) |
| **process.setSourceMapsEnabled / sourceMapsEnabled / getSourceMapsSupport()** | v16.6 / v23 | Module-level boolean wired into `withStackRemapping` (no-op when disabled). `getSourceMapsSupport()` returns `{enabled,nodeModules,generatedCode}`. Pairs with module.SourceMap. | low | S | low |
| **data: URL ESM import** | `import('data:text/javascript,…')` / `data:application/json` · v12.10 | `resolver.ts:129` throws `UNSUPPORTED_PROTOCOL`. Parse mediatype, `;base64`→atob else percent-decode + TextDecoder, route through existing `executeEsm` esm/json path. No network. `file://` ESM import has since shipped through the VFS resolver and is documented in `docs/public/compat/modules.md`. | low — mostly test frameworks/codegen/inline-worker bootstraps | M | low |

---

## 7. web globals & node:buffer module exports

The `global` alias is the highest-impact item in the whole audit. The `node:buffer` module-level exports (merged across `web-globals` + `buffer-url-encoding`) are mostly browser-native re-exports already battle-tested elsewhere in the repo. `buffer-pending-statics` backlog covers only Buffer-CLASS statics, NOT these module-level exports.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **globalThis.global alias** | `global === globalThis` · v12 | One-liner `globalThis.global = globalThis` alongside existing Buffer/process/timers in `worker-entry.ts:38`. | high — pervasive CJS pattern `global.X` / `typeof global!=='undefined'` in process-polyfill/webpack-shimmed/jest-style npm code | S | low |
| **node:buffer module exports** | `Blob`/`File`/`atob`/`btoa`/`isUtf8`/`isAscii`/`SlowBuffer`/`INSPECT_MAX_BYTES`/`resolveObjectURL` | `node:buffer` registers only `{Buffer}` (`builtins/index.ts:73`, `buffer.ts:257`). Re-export browser-native `Blob`/`File`/`atob`/`btoa` (used repo-wide already). `isUtf8`/`isAscii` = pure-JS byte-scan / TextDecoder fatal round-trip. `SlowBuffer`=`allocUnsafeSlow` alias. Land per-symbol with a parity test each. | med | M | low for re-exports/predicates; `resolveObjectURL` must loud-throw or back a real `URL.createObjectURL` registry; `INSPECT_MAX_BYTES` must actually drive Buffer-inspect truncation or it's a soft lie (med) |
| **buffer.readUIntLE/BE + readIntLE/BE** | v0.11 | Pure-JS byte loop over the `dvFor` seam; read 1–6 bytes LE/BE, sign-extend signed. `installIntMethods` (`buffer-prototype.ts:162`) installs only fixed-width 8/16/32. | med — binary-protocol/file-format parsers (48-bit reads) | S | low |
| **buffer.writeUIntLE/BE + writeIntLE/BE** | v0.11 | Mirror of the readers: write 1–6 bytes LE/BE, return `offset+byteLength`. | med | S | low |
| **buffer.toJSON** | v0.9 | `{type:'Buffer',data:Array.from(this)}` — exact round-trip shape for `JSON.stringify`/`Buffer.from`. | med — express bodies, logging serialization | S | low |
| **buffer.copyBytesFrom** | v19.8/v18.16 | Static: byte-window from `offset*BYTES_PER_ELEMENT+length` copied into a new Buffer via `set()` (explicit-copy, vs `Buffer.from` aliasing). | low | S | low |
| **scheduler global (wait/yield)** | v22 (experimental) | `wait()`=Promise+setTimeout, `yield()`=setImmediate/queueMicrotask — the exact impl already shipped as `timersPromises.scheduler` (`timers.ts:227`), just install on `globalThis`. Reuse that object to avoid drift. | low — v22-only, niche | S | low |

---

## 8. perf_hooks & worker_threads

Mostly re-exports of spec-identical browser globals (`MessageChannel`/`MessagePort`/`BroadcastChannel`/`PerformanceEntry` classes) that rifty already uses internally — real, not fakes. Environment-data/SHARE_ENV need the kernel spawn channel for cross-realm propagation.

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **worker_threads.MessageChannel / MessagePort** | v10.5 | Re-export browser globals (`kernel/spawn-worker.ts:146` already uses them internally). | med — tinypool/piscina-style pools | S | low |
| **worker_threads.BroadcastChannel** | v15.4 | Re-export native global (already battle-tested across `packages/net/src`). | low | S | low |
| **perf_hooks PerformanceEntry/Mark/Measure classes** | v8.5 | Re-export spec-identical browser globals for `instanceof` checks. (`PerformanceNodeTiming` stays excluded — tied to nodeTiming fidelity block.) | low | S | low |
| **perf_hooks.createHistogram** | v15.9 | Pure-JS HDR-style bucketed counters (record/min/max/mean/percentile/reset). Also the substrate `monitorEventLoopDelay` would need. | low | M | low |
| **perf_hooks.performance.timerify** | v8.5 | Wrap fn, bracket with `performance.now()`, emit a `'function'` PerformanceEntry. | low | S | low |
| **worker_threads.SHARE_ENV** | v11.14 | Export the symbol; when `env===SHARE_ENV`, alias child realm's `process.env` to parent's record. Same-realm trivial; cross-realm needs a shared-env channel (partial-but-honest). | low | M | **med** — cross-realm shared-mutable env |
| **worker_threads.getEnvironmentData / setEnvironmentData** | v15.12 | Module-scoped `structuredClone` Map; cross-realm rides the kernel spawn init payload. | low | M | **med** — cross-realm propagation |

---

## 9. assert / console / os builtins

`assert.ts` has `deepEqualImpl` + `matchesExpected` + `AssertionError` — the comparators every item reuses. `os` constants are info strings consistent with rifty's documented fictional ABI (`arch()='wasm'`, ADR-0026; `type()='Linux'`). NOT in any catch-all (which lists os.setPriority only).

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **assert.match** | v13.6 | `RegExp.test` over a string arg, throw existing `AssertionError`, `operator='match'`. Throw `ERR_INVALID_ARG_TYPE` if arg not string. | med — common in test suites | S | low |
| **assert.ifError** | v0.1 | Throw the value (wrapped in AssertionError preserving original stack) when value != null. Heavily used in callback(err) code. | med | S | low — must keep `original.stack` |
| **assert.rejects** | v10 | Await promise/fn, reuse `matchesExpected`, throw if it resolves. | med — async-test staple | M | low |
| **assert.throws object/Error-instance expected form** | v0.1 (form) | `matchesExpected` (`assert.ts:146`) handles only RegExp+function; doc explicitly says object/Error forms aren't wired. Extend to deep-key-subset-compare a validation object / match Error message/name/own props. | med — `throws(fn,{code:'X'})` widely used | M | **med** — Node's exact rules (RegExp-inside-object, missing-key throws) are fiddly; pin parity first |
| **assert.doesNotMatch** | v13.6 | Inverse of `RegExp.test`. Land with match. | low | S | low |
| **assert.doesNotReject** | v10 | Async mirror of `doesNotThrow`. Land with rejects. | low | M | low |
| **console.dirxml** | v8.3 | For non-DOM data Node's dirxml is literally `this.log(...data)` — exact alias to existing `log`. | low | S | low |
| **os.machine** | v18.9 | Constant `'wasm'`, consistent with `arch()` (ADR-0026). REVERSIBLE → CHANGELOG line. | low — build tooling probes it | S | low |
| **os.devNull** | v16.3 | Constant `'/dev/null'` (type()='Linux' → posix value faithful; Node's `os.devNull` is just the path string, no VFS routing). | low | S | low |
| **os.version** | v13.11 | Fixed kernel-version string consistent with `release()`/`type()`. | low | S | low |
| **assert.partialDeepStrictEqual** | v23.4 (experimental) | Recursive subset deep-strict over `deepEqualImpl`. | low | M | **med** — array/Map/Set subset semantics non-obvious; pin parity |
| **assert.CallTracker** | v14.2 (DEP0173) | Wrap fns counting invocations, verify exact count. **Deprecated — deprioritize.** | low | M | low |
| **assert.snapshot** | v22.3 (experimental) | Snapshot file read/write/compare over VFS. Coupled to test-runner lifecycle (`--test-update-snapshots`). **Low value, deprioritize.** | low | L | med |

---

## 10. http surface (`node:http`)

Static constants + the OutgoingMessage header-introspection subset are clean pure-JS wins over the existing `_headers` map; interim-response methods are honestly fidelity-bounded by the fetch/SW Response bridge (a Response is one final status).

| Feature | Node API · since | Real path | User value | Effort | Fidelity |
|---|---|---|---|---|---|
| **ServerResponse header-introspection methods** | `appendHeader`/`getHeaderNames`/`getHeaders`/`hasHeader` · v7.7–v11.6 | Pure-JS over the existing lowercased `_headers` map (`response.ts:92`) — no socket. | med — express/getHeaders-using middleware | M | low — implement these REAL |
| **http.METHODS** | v0.11 | Copy Node's METHODS array; export through the same barrels as the shipped `STATUS_CODES`. | low — express/router libs read it per-verb | S | low |
| **(excluded from above) writeContinue / writeEarlyHints / addTrailers** | — | Interim responses (100/103) + chunked trailers the fetch/SW Response bridge cannot model → `NotImplementedError`, partial-but-honest. | — | — | fidelity-bounded — loud-throw, never fake-ack |
| **http.maxHeaderSize** | v11.6 | Constant `16384`. Honest as a READ value only — SW/fetch bridge handles framing, so we can't enforce it; don't claim enforcement. | low | S | **med** — advisory, not enforced |

---

## Adjacent / parked — honest boundary notes

So a reader doesn't expect these alongside the above:

- **readline / readline/promises, tty, string_decoder, dgram, dns, tls, vm, v8, perf_hooks ELD (`monitorEventLoopDelay`), PerformanceObserver.observe, crypto sign/cipher/KDF expansion, Hash.copy, os.setPriority, node:test runner** — all recorded in the `node-builtins-loud-stub-capability-gaps` catch-all (loud `NotImplementedError`) or their own backlog items. NOT re-audited here; they are honest loud-throws, not silent stubs. (`createHistogram` above is the real substrate `monitorEventLoopDelay` would need.)
- **zlib** — not surfaced as a gap in this batch; treat as out-of-scope for this report (verify separately before claiming).
- **node:fs symlink/lstat-following, fs.cp `dereference`, fs.statfs/readv/accessSync/chmod** — `dereference` is N/A under the no-symlink model (ADR-0050), and the others are in the loud-stub catch-all.
- **file:// ESM import** — higher-value sibling of `data:` URL import; shipped after this audit and is now documented in `docs/public/compat/modules.md`. `data:` URL import remains the tracked gap.
- **PerformanceNodeTiming / process active TCP/FS handle introspection** — genuinely fidelity-blocked: rifty has no libuv handles to report, so `getActiveResources()`/`PerformanceNodeTiming` can only ever be a true subset (timers/immediates only). Listed in §6/§5 finder data as soft-ceiling; surface only as a documented subset, never as complete.
- **EventEmitterAsyncResource / async_hooks cross-await propagation** — sync-scope only is faithful; full cross-await context is a hard ceiling matching the existing AsyncLocalStorage stance.
