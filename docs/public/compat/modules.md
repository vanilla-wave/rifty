# Compatibility matrix — Modules (M2)

Hand-maintained (the `pnpm compat:generate` data-driven sink isn't wired yet — the script is a drift-check skeleton). Update this file by hand after touching conformance/integration tests.

| Feature | Status | Notes |
|---|---|---|
| `require('./other.js')` | ✅ | Explicit extension |
| `require('./other')` | ✅ | Node fallback: `.js`, `.json`, `.node`; never implicit `.mjs`, `.cjs`, or TS-family suffixes |
| `require('./dir')` | ✅ | Resolves via directory `index.js` |
| `require('./dir')` with `package.json.main` | ✅ | The nonstandard `package.json.module` field is ignored |
| `node_modules` walk-up | ✅ | |
| Scoped packages (`@scope/pkg/sub`) | ✅ | |
| `package.json` `exports` (string) | ✅ | |
| `package.json` `exports` (subpaths) | ✅ | |
| `package.json` `exports` (conditional) | ✅ | `node`, `import`, `require`, `module-sync`, `default`, plus a `fork`/`Worker` child's `-C`/`--conditions` (row below); author declaration order wins |
| `package.json` `exports` (wildcards `*`) | ✅ | |
| `package.json` `imports` (`#name`) | ✅ | Exact, wildcard, and conditional `imports` map entries |
| JSON modules via `require` | ✅ | |
| JSON modules via `import` | ✅ | Synthetic default + named keys |
| `node:` built-ins | ⚠️ | Registry supports `node:` and bare built-ins; each module is a tested subset. Static named-import validation uses that delivered runtime object's enumerable keys, not a speculative full Node export table; an unimplemented Node method remains a link-time miss until its real implementation lands. Exception (ADR-0443): `fs.statfsSync`, `child_process.spawnSync` and `process.memoryUsage` (+ `memoryUsage.rss`) — linked or bound at load by vitest 4.1.11 / tinyexec — are ❌ members: present with Node's descriptor (named imports link, `.bind` works), every call throws `NotImplementedError('<module>.<member>')`, never a value; feature detection (`typeof`) sees a function. ADR-0464 adds members a ❌ mode reaches first: `vm.constants` (real) and `http.Agent` (construction throws `node:http.Agent`; ❌ a call without `new` — `http.Agent()`, `util.inherits` + `Agent.call(this)`, also `https.Agent` — throws V8's bare class-call `TypeError` where Node constructs: `backlog/net/http-agent-call-shape`). `node:constants` is the faithful flattened union of `fs` + Linux-ABI `os` + `crypto.constants` (ADR-0153): real Node numeric values for known keys, `undefined` for absent keys — Node's shape. Reading a constant never throws; the unimplemented-behavior gap surfaces at the syscall (e.g. `fs.openSync` throws `NotImplementedError` for `O_SYNC`/`O_DSYNC` durability, `copyFileSync` for `COPYFILE_FICLONE_FORCE`). `node:vm` covers `Script`, `createContext`, `isContext`, `runInThisContext`, `runInContext`, `runInNewContext`, `compileFunction` and `constants` (Node's frozen symbols; a `DONT_CONTEXTIFY` context is a ❌ `NotImplementedError('vm.createContext.DONT_CONTEXTIFY')`, ADR-0464); generic default engine is a real QuickJS realm (cross-realm isolation); no-COI toolchain defaults to degraded rewrite (ADR-0383), with `createContext` name metadata and `codeGeneration.strings` / `codeGeneration.wasm` controls. Host-realm `runInThisContext` / `Script#runInThisContext` honour `lineOffset` / `columnOffset` (ADR-0450); sandbox offsets and Timeout/`displayErrors`/`cachedData`/`contextExtensions` remain loud gaps. See the node:vm section below. A builtin's ESM namespace lists keys in object order (`default` first), not the spec's sorted order — tracked in `backlog/runtime-js/builtin-esm-namespace-key-order`. |
| `util.format('%s')` / `util.inspect` of a Proxy | ⚠️ | As isolate-host.md "`util.format` / `util.inspect` of a Proxy" (shared runtime code): traps run where Node reads the target; a `Map` Proxy or revoked Proxy throws; a trap throwing on the `toString`/`Symbol.toPrimitive` read throws in `%s` where Node prints. `backlog/runtime-js/format-inspect-proxy-traps` |
| `node:vm` value crossing as a Promise (QuickJS engine) | ❌ | A context Promise reaching the host (`runInNewContext('Promise.resolve(1)')`, an async function's result, a Promise property) throws `QuickJSUseAfterFree: Lifetime not alive` (Node: the Promise); Promises inside the context work. `backlog/runtime-js/vm-quickjs-promise-use-after-free` |
| `util.format('%s')` of a `node:vm` value | ⚠️ | A context's array/object is inspected as Node; a context `Date`/`Error` is `String()`ed (Node inspects: ISO date / stack) — the membrane's prototypes carry no own `constructor`. `backlog/runtime-js/vm-membrane-percent-s-branch` |
| `node:module` helpers | ⚠️ | `createRequire`, `builtinModules`, `isBuiltin`, `Module.*` mirrors of those helpers, and compile-cache status constants are implemented. Compile-cache persistence is an explicit browser ceiling: `enableCompileCache()` returns `FAILED` with a message (never fake `ENABLED`), `getCompileCacheDir()` returns `undefined`, and `flushCompileCache()` is a quiet no-op. Parity case `modules/module-builtins-surface` pins the matching constants/function surface; conformance pins the unavailable-cache ceiling. Not Node's: `require('node:module')` is a helper object, not Node's `Module` function (`prototype`, `_resolveFilename`, `_load`, `_extensions` absent; a `Module.prototype.require` patch throws `TypeError`), and `syncBuiltinESMExports` is a no-op (code read). Draft `backlog/runtime-js/node-module-builtin-module-class` |
| `node:url` legacy API (`parse`, `resolve`, `resolveObject`, `format`, `Url`) and `node:querystring` | ⚠️ | Node v24.16.0's own `lib/url.js`, `lib/querystring.js`, `lib/internal/querystring.js`, generated from pinned sources with a drift check (ADR-0574, `pnpm check:url-legacy-drift`); every call of Node's own url/querystring tests gives Node's record on the runtime-js lane, the COI Workbench and the isolate guest (`url-legacy-corpus.test.ts`, `tests/browser-unit/url-legacy.spec.ts`, `packages/isolate-host/tests/url-legacy.test.ts`; parity `url/legacy-*`, `querystring/unescape-override`); DEP0170 as Node. Not Node's: `toASCII` of a non-ASCII or `xn--` hostname label uses the host's load-time `URL` plus ada's punycode round trip (the user's choice 2026-11-24) — measured on Chromium 148 (2026-11-24; another version may differ) it differs from Node on 358 of 6 622 hostnames (Unicode 17 IdnaTestV2, probe hosts, every ASCII character after a non-ASCII label, number labels, `xn--xn--` spellings, review-round-4 corners): 306 Bidi (the browser checks RFC 5893 across the name, ada per label and partly: `aא.com` Node `xn--a-0hc.com`, rifty `ERR_INVALID_URL`), 30 host code points the WHATWG parser forbids and ada passes (C0 controls, DEL, and `*` on Chromium: `ñ\u0001.com` Node `xn--\u0001-qga.com`, rifty `ERR_INVALID_URL`), 1 mapped `%` (`a％41.com` Node `ERR_INVALID_URL`, rifty `aa.com`), 4 Unicode labels whose ASCII part starts with `xn--` (`Σxn--` Node `xn--xn---kod`, rifty `ERR_INVALID_URL`: every `xn--` label of the browser's result is checked, an encoded Unicode label cannot be told from an input one), 3 input `xn---<p>` labels with an empty ASCII part (`xn---ida` Node `xn---ida`, rifty `ERR_INVALID_URL`: the round trip re-encodes it as `xn--ida`; also on the runtime-js lane), 14 labels that begin with a combining mark ada's Unicode-17 list lacks (U+1AC1–1ADD, U+1AE4–1AEB, U+0CF3, U+0ECE, U+1715, U+1DFA, U+0C3C; Unicode or `xn--` form: `᫁` Node `xn--brf`, rifty `ERR_INVALID_URL`; Chromium only; 7 marks × 2 forms pinned, a reviewer's `xn--[a-z0-9-]{1,3}` sweep found 46); the classes are what this corpus shows, not a proof that no other input differs; a reviewer's no-COI run on Firefox 150 and WebKit 26.4 (2026-11-24, before the round-1 corner rows) differed on 310 rows, all inside the 311 then pinned; each pinned; the isolate guest throws `NotImplementedError('url.toASCII')` there (isolate-host.md). `url.domainToASCII`, `domainToUnicode`, `urlToHttpOptions` and `url.format(URL, options)` where an option changes the output throw `NotImplementedError('url.<member>')` / `('url.format.options')` (`backlog/runtime-js/node-url-legacy-format-and-helpers`); `URLPattern`, `fileURLToPathBuffer` are absent (`backlog/runtime-js/node-url-urlpattern-file-url-to-path-buffer`); rifty never emits DEP0169 (Node: once per process for a `url.parse` caller outside `node_modules`) — so no `'warning'` event for it and no `process.throwDeprecation` exit (Node prints the result, then exits 1 on the uncaught DEP0169; rifty exits 0; row `dep0169-ceiling.cjs`): caller detection was removed, the user's choice 2026-11-24, after three review rounds broke it through the guest's `Error` state (ADR-0574 §Corrections; rows `dep0169-rows.cjs`, `error-state-rows.cjs`); on no-COI DEP0170 fires once per sandbox realm, not per `node` run (process.md "Shared realm across no-COI `node` invocations"); a Node error's stack header lacks its `[CODE]` (`backlog/runtime-js/node-error-code-label`) |
| `node:path/posix` | ⚠️ | `node:path/posix` and bare `path/posix` are builtins returning `require('node:path').posix` itself: ESM default, namespace and dynamic `import()`, CJS `require`, `isBuiltin`, `builtinModules` (parity `path/posix-subpath-import`, `path/posix-subpath-require`). Gaps vs Node 24: the object lacks `matchesGlob`, `_makeLong` and the `posix`/`win32` cross-references (property read `undefined`, named import a link-time `SyntaxError`); `require('path') !== require('path').posix` (Node: same object). |
| `node:path` argument validation | ❌ | Non-string arguments are not validated: `path.join({})` returns `'.'`, `resolve`/`basename`/`normalize`/`dirname`/`extname`/`relative`/`isAbsolute`/`parse` throw a bare `TypeError` (`p.startsWith is not a function`) where Node throws `ERR_INVALID_ARG_TYPE`. Tracked in `backlog/runtime-js/path-arg-type-validation` |
| `node:path/win32` / `path.win32` | ❌ | No Windows path semantics: `path.win32` is the `path.posix` alias (`sep` `/`, Node `\`; never parity-tested, traps.md `parity-win32-alias`). `node:path/win32` is unregistered: `require`/`import` throw `MODULE_NOT_FOUND` "Built-in 'node:path/win32' is not implemented"; bare `path/win32` is a package miss (`Cannot find module 'path/win32'`); `isBuiltin` false for both spellings, absent from `builtinModules` (Node: builtin). Tracked in `backlog/runtime-js/path-win32-namespace` |
| `node:async_hooks` `createHook` / `executionAsyncId` | ❌ | Silent stubs: `createHook` returns a hook whose `init`/`destroy`/`promiseResolve` callbacks never run (`enable()`/`disable()` do nothing), `executionAsyncId()` always returns `0`, `triggerAsyncId` is absent — so vitest `detectAsyncLeaks` and the `hanging-process` reporter (`why-is-node-running`) report nothing. `AsyncLocalStorage` / `AsyncResource.runInAsyncScope` are synchronous-scope subsets. Cross-await ALS gap: `backlog/runtime-js/async-local-storage-await-context`. Tracked in `backlog/runtime-js/async-hooks-silent-stubs` |
| `file:` URL imports | ✅ | ESM-only, as in Node: ASCII-case-insensitive `file:` specifiers resolve through the VFS loader with Node-shaped percent decoding, encoded-separator rejection, and one canonical module identity; `import.meta.url` / `import.meta.resolve` encode resolved POSIX paths through the same codec (parity `modules/file-url-module-identity`). CJS never URL-dispatches: URL-looking strings use ordinary alias/path/package resolution and ordinary misses report `MODULE_NOT_FOUND` (parity `modules/require-url-specifier-strings`, `modules/require-bare-file-package`). |
| `data:` URL imports | ❌ | ESM `import` throws `UNSUPPORTED_PROTOCOL` for every ASCII casing. CJS treats the string as an ordinary path/package name; a usual miss is `MODULE_NOT_FOUND` |
| Caught loader errors (`try { require('./nope') } catch (e)`, and the error a `process.on('uncaughtException')` / `'unhandledRejection'` listener receives) | ⚠️ | As on main: a `ModuleLoadError` (`e instanceof Error`, `name` `'Error'` for `MODULE_NOT_FOUND` and `ERR_REQUIRE_*`), with Node's `code` and, for a CJS miss, `requireStack`, plus rifty's own enumerable `specifier` and `importer` keys (Node has neither; `Object.keys(e)` / spreading shows them). The isolate's fatal report hides them (process.md "Fatal error stderr bytes") |
| `worker_threads.Worker` entry | ⚠️ | Path strings enforce Node's absolute/`./`/`../` grammar and construction-time cwd; file URL objects and cross-realm/Node URL-shaped values decode; invalid strings/types/schemes throw synchronously before thread-id allocation. Data URL objects are constructor-valid but execution emits `NotImplementedError('worker_threads.Worker.data-url')`; `eval: true` throws `NotImplementedError('worker_threads.Worker.eval')`. Tracked in `backlog/runtime-js/worker-eval-data-url-entry` |
| `fork` / `worker_threads.Worker` `execArgv`: `-r`/`--require`, `-C`/`--conditions`, `--experimental-import-meta-resolve` | ✅ | Separate and `--flag=value` spellings; the child's exact `process.execArgv`. Preloads run in order from the child's cwd before the entry (`require.main` unset; a missing one exits 1 with `Cannot find module` and `internal/preload` on stderr); conditions reach require, `require.resolve`, static/dynamic import, `import.meta.resolve`, package `imports` and the preloads; the flag makes `import.meta.resolve` honour its parent. Worker: a falsy/omitted `execArgv` inherits the parent thread's launch options (a mutated public `process.execArgv` is ignored); a truthy non-array is `ERR_INVALID_ARG_TYPE`, a flag without operand `ERR_WORKER_INVALID_EXEC_ARGV`. `fork`: default is the public `process.execArgv` at the call, minus the eval pair when the effective array is that array itself. vitest 4.1.11's pool `execArgv`. Parity `worker_threads/{exec-argv-startup,exec-argv-validation,vitest-pool-shape}`, `child_process/{fork-exec-argv,vitest-pool-shape}`; browser-unit `worker-stdio-exec-argv` (nested inheritance, eval parent); prod `worker-stdio-exec-argv` (ADR-0449) |
| `fork` / `Worker` other startup options | ❌ | Every other token (`--import`, `--no-warnings`, `--experimental-vm-modules`, `--inspect`, `-e`/`-p`, `-r=x`, non-strings) throws `NotImplementedError('worker_threads.Worker.execArgv' \| 'child_process.fork.execArgv')` naming it, before a thread id, hold, child or spawn; so does a `fork` flag without its own operand (Node's fork would take the module path as the operand). A Worker inheriting an eval parent's `-e <source>` stays the named throw — `backlog/runtime-js/worker-threads-inherited-exec-argv` (ADR-0449) |
| Same-realm `fork` / `Worker` startup options and Worker streams | ⚠️ | Without SAB or a kernel Worker URL a child shares its parent's realm: a non-empty effective `execArgv` throws `NotImplementedError('worker_threads.Worker.execArgv.same-realm' \| 'child_process.fork.execArgv.same-realm')`; `stdout: true`/`stderr: true` and reading a Worker's `stdout`/`stderr` throw `NotImplementedError('worker_threads.Worker.stdio.same-realm')` (its output already shares the parent's streams) (ADR-0449 §6) |
| `worker_threads.Worker` `stdout` / `stderr` / `stdin` | ✅ | Prototype getters: `stdout`/`stderr` are `node:stream` Readables, piped into the parent's `process.stdout`/`stderr` (never ended) unless `stdout: true` / `stderr: true`; every chunk is on the stream before `'exit'` and `'end'` follows it (also `terminate()`); an unread captured stream holds nothing; `stdin` is `null`. The non-Node `'stdout'`/`'stderr'` Worker events are gone. Parity `worker_threads/{stdio-streams,stdio-exit-order,vitest-pool-shape}`; browser-unit, prod `worker-stdio-exec-argv` (ADR-0449) |
| `worker_threads.Worker` `stdin: true` | ❌ | Throws `NotImplementedError('worker_threads.Worker.stdin')` before a thread id or hold: no parent-to-worker stdin stream (ADR-0449) |
| Worker stdout vs `'message'` order; read `stdout: true` stream of an `unref()`'d Worker | ⚠️ | Not claimed: Node's order of a worker's stdout chunks and `'message'` events varies run to run, and Node's port hold for a read captured stream depends on loop timing (ADR-0449) |
| `worker_threads.Worker` `argv` / `name` / `resourceLimits` / `transferList` / `trackUnmanagedFds`; `env: null`; non-object `env` | ❌ | The five options are ignored silently (Node: extra `process.argv`, `threadName`, heap limits, transfers) — `backlog/runtime-js/worker-threads-ignored-options`. `env: null` throws `TypeError` where Node starts the worker with a copy of the parent env; a primitive `env` (`5`, `true`, `'ab'`, …) silently becomes an env (empty, or `'ab'` → `{0:'a',1:'b'}`) where Node throws `ERR_INVALID_ARG_TYPE` — `backlog/runtime-js/worker-threads-env-null` |
| ESM static `import` | ✅ | Named, default, namespace, side-effect-only |
| ESM `export` named / default / re-export | ✅ | |
| ESM `export * from` | ✅ | |
| ESM `export * as ns from` | ✅ | |
| ESM dynamic `import()` | ✅ | |
| ESM top-level `await` | ✅ | |
| ESM live bindings (named import + re-export) | ✅ | Via member access into source-module namespace |
| ESM module code strict mode | ❌ | Module bodies run sloppy: undeclared writes create globals (Node: `ReferenceError`), top-level and plain-call `this` is an object (Node: `undefined`), and a call of an imported function gets the source namespace as `this`. Tracked in `backlog/runtime-js/esm-module-code-sloppy-mode` |
| CJS cycles (half-populated exports visible) | ✅ | |
| CJS `module` metadata and lifecycle | ✅ | One registry record owns `id`, `filename`, `path`, search `paths`, first `parent`, `children`, cache identity, cycle publication, `loaded`, and failed-load unlink (ADR-0325; Node 24 parity). `require.cache` is that registry's CJS view (row below). The entry is Node's main module: `require.main`, `process.mainModule`, `id` `.`, `parent` null; `createRequire` hangs from a detached module (ADR-0571). |
| CJS stack positions | ⚠️ | Every line keeps its native number (the wrapper prefix shares line 1, ADR-0450 2026-11-22) and the top-level frame reads `Object.<anonymous>`, including guest/frozen stack hooks. In `err.stack`, line-1 columns sit right of the source by the wrapper prefix and anonymous functions read V8's `eval` (Node: no name); the fatal report prints Node's form (`process.md` "Fatal error stderr bytes"). The factory's `name` is `Object.<anonymous>` (Node `''`, visible through a sloppy `arguments.callee` or a guest `CallSite.getFunctionName()`). Columns on a line holding `import()` or a computed global write (`globalThis[k] = …`) move by rifty's rewrite; a plain `Function` reference keeps them, a shorthand `{ Function }` key moves them by 10, and a V8 message names the helper (`$r000000.foo is not a function`, Node `Function.foo …`; `backlog/runtime-js/function-rewrite-visible`). A one-line (minified) CJS bundle's frames all sit on line 1, so a source-map consumer (source-map-support, an error reporter) maps them to a wrong original position. The fatal report also projects a guest `Function`/`eval` whose `//# sourceURL` names a loaded module (its line-1 columns move by that module's prefix). The module function's text (`arguments.callee.toString()`) starts `function(exports,require,module,__filename,__dirname){` on the source's first line (Node `function (exports, require, module, __filename, __dirname) {` and a newline), and a leading `-->` comment reads `//>` there (ADR-0450 2026-11-22 N3; the file loads as in Node, entry row `first-line-html-close`). `backlog/runtime-js/cjs-wrapper-stack-positions` |
| ESM stack positions | ⚠️ | Untransformed `.mjs`/`.js` ESM frames are shifted by the loader rewrite (measured +5 lines nested, +7 top-level with the column changed; the offset depends on module shape — a lone top-level `throw` is +5, column kept), name the bare module path instead of Node's `file://` URL, and top-level frames read `eval`. Tracked in `backlog/runtime-js/esm-stack-positions` |
| CJS wrapper `arguments` | ✅ | Node's five `(exports, require, module, __filename, __dirname)`; rifty's loader helpers are closed over, not arguments. Parity `node-file-parity` row `entry-facts` |
| Module code's own `//# sourceURL=` | ⚠️ | The loader appends its own `sourceURL` after module code, so a module's own comment does not name its frames (Node: the own name; measured for CJS). Host-realm `vm` scripts honour it (ADR-0450). Tracked in `backlog/runtime-js/loader-guest-source-url-override` |
| ESM cycles (mutating exports visible) | ⚠️ | Live mutating exports, evaluation order and one-time bodies match Node; a TDZ read throws `ReferenceError` naming the export key (Node: the importer's local name). A throw from a cycle's root is not shared with an already-evaluated cycle member: Node rejects a later import of that member with the same error, rifty returns its namespace. Tracked in `backlog/runtime-js/esm-module-job-graph-parity` |
| CJS → ESM outer + namespace identity | ✅ | `default` and `module.exports` are the exact CJS outer; one namespace per loaded record; rifty coherent invalidation replaces record + namespace together. Parity: `modules/cjs-esm-namespace`, `modules/cjs-cycle-import-of-inflight` |
| CJS → ESM named exports + reflection | ⚠️ | Names and ordinary recursive re-exports come from pinned static analysis, computed runtime keys stay absent, values snapshot into one stable namespace, and missing named edges fail before module effects. An ESM target behind `module.exports = require(...)` stays a loud gap; property descriptors remain ordinary null-prototype object descriptors rather than Module Namespace exotic descriptors. Tracked in `backlog/runtime-js/cjs-esm-static-named-exports` |
| CJS ↔ ESM interop (`require(ESM)`) | ⚠️ | Node 24 synchronous plain-JS graphs: shared live namespace, cached default/`__esModule` facade, `"module.exports"` override, transitive-TLA preflight (`ERR_REQUIRE_ASYNC_MODULE`), live ESM cycles, direct cross-format cycle errors with ordinary CJS partial back-edges preserved, and import-race errors (ADR-0348). Explicit `.mjs`, `"type":"module"` `.js`, and syntax-detected `.js` are eligible; extension/index fallback stays CJS-only as above. Async-transformed TS/TSX/JSX, Node CLI opt-out/trace flags, and public `require.cache` are outside this claim and stay loud/separately tracked. `process.features.require_module === true`. |
| `require.cache` module records | ⚠️ | One object shared by every `require`: keys are the loaded CommonJS filenames, values their `module` records; `delete require.cache[k]` makes the next `require` load a fresh record, an assigned entry is returned as is (Node `Module._load`). Parity `node-file-parity` rows `entry-facts`, `require-cache-reload`. Not Node's: ES modules loaded by `require(esm)` are absent; self-import from a failed `require` throws `module-loader.cjs-import-job-failed-require`; `loader.invalidate()` is a stronger rifty HMR contract. `backlog/runtime-js/require-cache-module-record-surface` |
| ESM `import` of `.ts` / `.tsx` | ✅ | An injected async `transformSource` hook runs before the AST ESM pass. Node parity injects exact host `esbuild@0.28.0` and compares cross-file TS syntax and standard decorators with `tsx`; runtime-js owns no transform provider (ADR-0052/0316) |
| tsconfig `paths` aliases | ✅ | Explicit `paths` map (ADR-0066), or `await preloadTsconfigPaths()` then `autoDiscoverTsconfigPaths: true` (ADR-0170/0382: nearest config, extends, JSONC, baseUrl). Unprepared discovery throws `TSCONFIG_NOT_READY` |
| `require()` of TS/TSX/JSX | ❌ | CJS-scoped `.ts`/`.tsx` throws `NotImplementedError('module-loader.ts-via-require')`; ESM-scoped transformed source also stays loud because ADR-0052's provider contract is async. Load it through `import()` instead |
| `require.resolve` | ⚠️ | A bare builtin name returns the `node:`-prefixed id (`require.resolve('fs')` → `'node:fs'`; Node `'fs'`). Tracked in `backlog/runtime-js/require-resolve-bare-builtin-id` |
| `require.extensions` / `module._compile` | ⚠️ | Local and `createRequire` views share one table with Node's `.js`/`.json`/`.node` default surface. Cache publication precedes accessor reads; explicit CJS files use the longest truthy registered basename suffix, then the current `.js`; hooks override JSON/text handling and replacement source resolves relative to its compile filename (ADR-0294; parity `modules/require-extensions-*`). The default `.node` hook loudly rejects native addons but remains replaceable. Dynamically registered suffixes are not extensionless resolver candidates (tracked in `backlog/runtime-js/require-extensions-extensionless-resolution`). Replacing `.js` owns a separately cached CJS projection before package-type/syntax ESM classification, even beside a loaded/in-flight import; delegating to the captured default re-enters the ESM job. Explicit non-`.js` ESM files bypass CJS hooks. |
| `import.meta.url` | ✅ | File URL for the resolved ESM module id; supports `new URL('./x', import.meta.url)` |
| `import.meta.resolve(spec)` | ✅ | Real loader resolution (v20.6, sync). Any ASCII-cased `node:` specifier is returned verbatim (not validated at resolve time); files → canonical `file://<abs>`; a bare/relative miss throws the resolver's `MODULE_NOT_FOUND` (Node returns the URL for an absent relative file — `backlog/runtime-js/import-meta-resolve-node-results`). Was a stub returning a wrong `file://` URL for bare specifiers |
| `import.meta.resolve(spec, parent)` | ✅ | Ignored without `--experimental-import-meta-resolve`, as in Node 24. With it (a `fork`/`Worker` child's `execArgv`): a string or URL `parent` is the base (Node's URL join for relative specifiers, the parent's directory for packages); a non-string/URL is `ERR_INVALID_ARG_TYPE`, an unparsable parent `ERR_UNSUPPORTED_RESOLVE_REQUEST` (relative) or `ERR_INVALID_URL` (bare); package resolution from a non-`file:` parent throws `NotImplementedError('module.import.meta.resolve.parent')` (ADR-0449; Node throws `ERR_INVALID_URL`/`ERR_UNSUPPORTED_RESOLVE_REQUEST` there). — `backlog/runtime-js/import-meta-resolve-node-results` |
| Import attributes (`with { type: 'json' }`) | ❌ | Deferred until needed |

## Known limitations (M2)

- Identifier rewriter for live bindings is AST-based (acorn + scope-tracking walker — ADR 0009). Same-name local shadowing of imported bindings is handled correctly.
- Function-constructor `import()` routing is loader-scoped (ADR-0171): the lexical
  `Function` constructor inside CJS/ESM module evaluation resolves VFS imports against
  the constructing module while preserving native `name`, `length`, prototype-chain,
  and `instanceof` observables. Code that intentionally reaches `globalThis.Function`
  inside a rifty-loaded module hits the directed global-Function ceiling below. Code
  that uses a host constructor pre-captured outside the rifty module-loader context
  has no trustworthy module base and is not claimed.
  Because routing needs a lexical proxy, identity probes like
  `Function === globalThis.Function` and `Function.prototype.constructor === Function`
  are outside the claim.
- Derived host constructors (`fn.constructor`, `Function.prototype.constructor`,
  and similar `.constructor` paths) used to compile source that statically
  contains `import` throw
  `NotImplementedError('module-loader.function-constructor-derived-host')`.
  Routing them without mutating the host `Function.prototype` needs a future
  realm/prototype membrane. Tracked in
  `docs/backlog/runtime-js/function-constructor-derived-host.md`.
- Runtime-built `Function` sources that combine routed `import()` with nested
  `Function`, `with`, or eval dynamic scope throw
  `NotImplementedError('module-loader.function-constructor-dynamic-scope')`.
  Node's `import()` is syntax, while rifty's routed helper would otherwise be a
  user-shadowable identifier in dynamic scope or fall through to a host/global
  nested constructor. Tracked in
  `docs/backlog/runtime-js/function-constructor-dynamic-scope.md`.
- CJS/ESM modules containing mutations of the global `Function` binding/property
  (`Function = ...`, `globalThis.Function = ...`, `globalThis["Function"] = ...`,
  statically tracked aliases of `globalThis`/`global` (direct assignment,
  CJS sloppy implicit assignment,
  object/array destructuring, default parameters), computed `globalThis[...]`
  Function-like mutations (including dynamic computed keys) or use-as-constructor
  reads of a key folding to `'Function'` (`"Fun" + "ction"`), `delete globalThis.Function`,
  `Object.defineProperty(globalThis, "Function", ...)`,
  `Object.defineProperties(...)`, `Object.assign(globalThis, ...)`, `Reflect.set(...)`,
  `Reflect.get(globalThis, ...)` when used as a possible constructor, `Reflect.deleteProperty(...)`,
  `Reflect.defineProperty(...)`, `__defineGetter__` /
  `__defineSetter__`,
  etc.) throw directed `NotImplementedError`s instead of mutating the browser host
  constructor, deleting it, or silently mixing routed and replaced constructors:
  `module-loader.cjs-global-function-assignment` / `module-loader.esm-global-function-assignment`.
  A single-key write/define/delete whose computed key does not fold (Symbol
  consts, parameters, for-in keys — vitest, undici) loads and runs as in Node;
  the key is checked when V8 coerces it and throws the same ceiling at that
  write only when it is `'Function'` (earlier statements have run; `??=`/`||=`
  throw even where Node would skip the write). `fn.toString()` and stack
  columns of such a line show the loader's key-check helper (ADR-0444).
  A computed read of a tracked global called or constructed with such a key
  (`new global[k](…)`, `global[k](…)`, `global[k]?.(…)`, `global[k].call|apply|bind(…)`
  — es-abstract `IsDetachedBuffer`, typed-array-length/-byte-offset/-byte-length)
  loads and runs as in Node; a key that is `'Function'` at runtime throws the
  same ceiling at that read (Node constructs). Still rejected at load: a called
  alias or destructured binding of such a read (`const C = global[k]; new C()`),
  `Reflect.get(globalThis, k)` called, `global?.[k](…)`; a module holding such a
  read and `with` or any call of the identifier `eval` (either can shadow the key
  check) throws `module-loader.{cjs,esm}-dynamic-function-scope` at load, where
  Node runs the module (a conservative rule: no exception for `eval?.()`,
  `eval(...a)` or a local `eval` bound to another function). V8 messages, stack
  columns and `fn.toString()` of that line show the helper
  (`global[__riftyGlobalKey(...)] is not a constructor`, Node `global[k] is not a constructor`;
  `backlog/runtime-js/function-rewrite-visible`).
  Tracked in `docs/backlog/runtime-js/cjs-global-function-assignment.md`.
  ❌ False positive: a non-literal `Object.assign(globalThis, src)` rejects the
  module at load even in a branch that never runs — `fetch-blob@3.2.0`
  `streams.cjs`'s `if (!globalThis.ReadableStream)` polyfill, so
  `node-fetch@3.3.2` cannot load (Node loads it). Tracked in
  `docs/backlog/runtime-js/object-assign-global-nonliteral-load-time-false-positive.md`.
- A direct, unshadowed `eval` with a statically known string containing ordinary
  `import()` syntax is routed through the constructing module's collision-free
  lexical import helper; a returned importer keeps that VFS-relative base when
  invoked later. Indirect, aliased, global/computed, nested-eval, `with`, and
  other dynamic-scope eval forms whose known text touches `Function` or `import`,
  or modules that combine `with` dynamic scope with routed lexical `Function`, throw
  `module-loader.cjs-dynamic-function-scope` /
  `module-loader.esm-dynamic-function-scope`; those dynamic scopes can replace
  the binding at runtime, which the static routing transform cannot preserve
  without an isolated global realm.
- The package-tooling hard-ceil goal is scoped to the documented static
  Function/eval/import patterns above. Proof-complete detection for every
  JavaScript metaprogramming alias shape, including dynamically composed
  derived-constructor or eval bodies, is explicitly deferred to
  `docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md`;
  until then, new escapes found by parity/conformance must either be routed or
  promoted to a directed `NotImplementedError` before being claimed as supported.
- ❌ A module whose only `Function`/`global`/`globalThis` tokens are spelled with
  `\u` escapes (`\u0046unction`) skips the whole Function guard: its lexical
  `Function` is not routed (`import()` reaches the host) and a called
  `\u0067lobal[k]` hands out the host constructor. Tracked in
  `docs/backlog/runtime-js/function-routing-prefilter-escaped-identifiers.md`.

### `node:vm` — engines + ES2023-vs-V8 divergences

| Tier / SDK selection | Engine | Observable behavior |
|---|---|---|
| Generic runtime default | quickjs | Real realm, existing QuickJS limits below |
| No-COI toolchain default / `vmEngine: 'rewrite'` | rewrite ⚠️ | No WASM preload; direct eval may write host globals, host globals visible, host `instanceof` true |
| No-COI toolchain `vmEngine: 'quickjs'` | quickjs | WASM loaded at boot; real realm, existing limits below |

SDK selection survives restart; capability report labels the rewrite row
`degraded`. ADR-0383 changes this tier's default; it does not claim vm security.

`node:vm` is a compatibility surface, not a security sandbox. Two engines, selectable via
`vmEngine` option / `__RIFTY_VM_ENGINE` (env or global; precedence: explicit > env > global >
default):

- **`quickjs` (generic default; no-COI explicit opt-in)** — runs context code in a REAL QuickJS-WASM realm with a two-way
  membrane. Gains over the old rewrite engine: cross-realm identity (a returned guest array/object
  is `instanceof Array/Object` FALSE but `Array.isArray` TRUE and its prototype methods work, both
  directions — a seeded host array/object also carries its methods in the guest); direct `eval(...)`
  is realm-isolated (no host leak); real global-object semantics (non-writable intrinsics,
  non-configurable `var`/function bindings, pre-declared lexical intrinsics, writable `globalThis`,
  user `var eval`, `"use strict"` undeclared-write `ReferenceError`).
- **`rewrite` (loud opt-in floor)** — the host-realm `with(proxy) + eval(AST-rewrite)` engine; emits
  ONE stderr warning per process when used. Native-V8-leaning where QuickJS diverges (below), but
  carries the rewrite fragility class (ADR-0142) — it is the floor, not the default.

Shared, faithful on both engines: writes from context code (assignments incl.
compound/update/destructuring, `var`/function declarations incl. statement-position destructuring
`var`, for-in/of targets, `delete`) land on the context; top-level functions hoist; declaration
statements keep Node's empty completion value; a declared `var` stays readable after the run and in
later runs. Unsupported
execution controls (`timeout`/`displayErrors`/`cachedData`/`contextExtensions`/…) throw loudly.
`createContext` accepts Node's `name` metadata. The default QuickJS engine enforces
`codeGeneration.strings: false` and `codeGeneration.wasm: false`; the rewrite opt-in throws loudly
for either false policy instead of claiming isolation it cannot enforce. `origin` and
`microtaskMode` remain loud gaps. `vm.constants` is Node's data (parity `vm/constants`);
`createContext` / `runInNewContext` / `Script#runInNewContext` with `DONT_CONTEXTIFY` (a fresh,
non-contextified global — jsdom's window) throw `NotImplementedError('vm.createContext.DONT_CONTEXTIFY')`:
both engines contextify a given object and never hand out a realm's own global (ADR-0464);
`createContext` validates `name` first, as Node. ❌ `runInNewContext` / `Script#runInNewContext`
ignore `contextName` / `contextOrigin` / `contextCodeGeneration` (invalid values run;
`contextCodeGeneration: { strings: false }` is not enforced, Node throws `EvalError`), and with
`DONT_CONTEXTIFY` the ceiling replaces Node's `ERR_INVALID_ARG_TYPE` for those, `filename` and
offsets — `backlog/runtime-js/vm-run-in-new-context-options`.

Gap (❌, both engines by code reading, `backlog/runtime-js/vm-context-arg-validation`): a non-object or
non-contextified context arg throws a `TypeError` without Node's `ERR_INVALID_ARG_TYPE` code, and
`runInNewContext`/`createContext` with a primitive throw `Object.defineProperty called on non-object`.

The default engine shares the live `contextObject` via a reconcile-based membrane (reseed
host→guest before each run, sweep guest→host after) — observationally equivalent to Node's live
context for synchronous code. Two caveats: a guest callback mutating the sandbox AFTER the run is
seen only at the next run; the host→guest side retains one seed per DISTINCT inbound object/fn for
the context's life (not GC-evicted), so keep `vm` off a hot loop that streams fresh objects in.
Two gaps (❌, `backlog/runtime-js/vm-quickjs-seed-readonly-and-brand`): a seeded object with a
non-writable enumerable data property at any depth (e.g. `{ p: process }` via `process.release.name`)
runs the code, then the post-run sweep throws `TypeError: Cannot assign to read only property …`
(result lost, side effects kept); a seeded object's symbol-keyed `Symbol.toStringTag` brand is not
copied (`[object Object]`, Node `[object <tag>]`).

**ES2023 (QuickJS) ≠ V8 residual divergences** (default engine; each verified vs real Node, pinned
by conformance + parity cases; workaround = the `rewrite` opt-in, which is V8-correct for these):

1. **`function undefined(){}` redeclaration error TYPE** — V8 raises an early `SyntaxError`; QuickJS
   raises the spec-literal runtime `TypeError` (`cannot define variable 'undefined'`). `let
   undefined = …` (lexical) matches V8 (`SyntaxError`) on both.
2. **Explicit `var x = undefined` initializer not propagated** — Node copies `x` to the sandbox
   (`Object.keys` ⇒ `["x"]`); the QuickJS post-run sweep cannot distinguish `var x = undefined` from
   a declaration-only `var x;` (same `undefined` value + non-configurable binding), so both skip.
3. **Sandbox key ENUMERATION order** — V8's contextify setter yields hoisted functions first then
   source order; the QuickJS sweep walks the guest global in creation order (vars → functions → bare
   assignments). `Object.keys` order of a contextified sandbox is V8-internal, not a spec guarantee.
4. **`delete` of a context `var`/function** — in the real realm a top-level `var v`/`function` is a
   non-configurable global binding, so `delete v` is a no-op (`v` survives, sandbox keeps `v`); V8's
   contextify reports the binding gone (`Object.keys` ⇒ `[]`, `v` undefined).

Recorded: ADR-0142 (node:vm dual-engine — QuickJS real realm default, hardened-rewrite loud
opt-in; supersedes ADR-0138, which had recorded the rewrite direct-eval leak as permanent).

#### `node:vm` script offsets (ADR-0450)

| Behavior | Status | Notes |
|---|---|---|
| `runInThisContext` / `new Script(…).runInThisContext()` with `lineOffset` / `columnOffset` | ✅ | Node's int32 validation; `.stack`, guest `Error.prepareStackTrace` CallSites (line/column/enclosing getters, `toString`) and default rendering show Node's positions: every line + `lineOffset`, physical line 1 + `columnOffset`, unclamped (≤ 0 getters null, zero omitted). Parity `vm/run-in-this-context-offsets{,-callsites,-async}` + Chromium browser-unit `vm-script-offsets.spec.ts` |
| Script whose code has its own `//# sourceURL=` / `//@ sourceURL=` (any offsets) | ✅ | Named by it as in Node (last valid comment, as V8 parses it), also when evaluated inside a stack hook or a formatter's getter: line/column/`toString` without offsets, enclosing getters with them. Parity `vm/run-in-this-context-own-source-url{,-in-hook}` + Chromium browser-unit |
| Offset validation on `runInContext` / `runInNewContext` / `compileFunction` | ✅ | `ERR_INVALID_ARG_TYPE` / `ERR_OUT_OF_RANGE`, Node's order (`compileFunction`: `columnOffset` first) |
| `options.filename` type validation | ❌ | Not validated: a non-string `filename` runs the script under `String(filename)`, a null-prototype object throws a bare `TypeError` (Node: `ERR_INVALID_ARG_TYPE` `The "options.filename" property must be of type string`, checked before the offsets). Tracked in `backlog/runtime-js/vm-options-filename-validation` |
| Non-zero offsets in `runInContext` / `runInNewContext` | ❌ | `NotImplementedError('vm.runInContext.lineOffset' \| 'vm.runInContext.columnOffset')` |
| `Script` built with offsets run by `runInContext` / `runInNewContext` | ❌ | `NotImplementedError('vm.Script.lineOffset' \| 'vm.Script.columnOffset')` |
| Non-zero offsets in `compileFunction` | ❌ | `NotImplementedError('vm.compileFunction.lineOffset' \| 'vm.compileFunction.columnOffset')` |
| `Error.prepareStackTrace` once an offset script ran | ❌ | An accessor (Node: data property); reading back after assigning a function yields a wrapper delegating to it, after a non-function the default (Node: the assigned value) |
| Owner bypass: `delete Error.prepareStackTrace`, an error formatted inside a hook, stack overflow | ❌ | Offset frames show the encoded identity `rifty-vm://<lineOffset>/<columnOffset>/<escaped filename>` until the next offset script (never a plausible `file:line:col`) |
| `eval` / `new Function` called inside an offset script | ❌ | Eval origin shows the encoded identity without position (Node: `eval at f (file:line:col)`). Tracked in `backlog/runtime-js/vm-host-realm-frame-naming` |
| Host-realm frame shape (any offsets) | ❌ | Eval frames: top level `at eval (…)`, `isEval()` true, `getFileName()` undefined (so with an own `sourceURL`, `getFileName() \|\| getScriptNameOrSourceURL()` is that name; Node: the filename), `getEvalOrigin()` = filename. Tracked in `backlog/runtime-js/vm-host-realm-frame-naming` |
| Default `displayErrors` decoration | ❌ | Absent on errors thrown synchronously out of `runInThisContext` / `Script`. Tracked in `backlog/runtime-js/vm-display-errors-decoration` |
| Zero-offset filename omitted, or not a valid `sourceURL` (whitespace) | ❌ | Frames show `<anonymous>` (Node: the filename / `evalmachine.<anonymous>`); the omitted-filename frame nests `eval at <anonymous>` around rifty's own `vm/index.ts` path. Tracked in `backlog/runtime-js/vm-host-realm-frame-naming` |
| Default `Error.prepareStackTrace` before any offset script | ❌ | Chromium's `undefined` (Node 24: `ErrorPrepareStackTrace`). Tracked in `backlog/runtime-js/realm-default-prepare-stack-trace` |
| Frozen `Error` (non-configurable `stackTraceLimit` / `prepareStackTrace`) | ❌ | `NotImplementedError('vm.runInThisContext.frozenError')` for an offset script or code that spells `sourceURL` (Node runs both); other code runs |

- The in-Worker VFS is in-memory only (M4 adds OPFS).
- A `.ts`/`.tsx` module that classifies as CJS (its nearest package scope is not `type:module`) cannot be `require()`d: `transformSource` is an async caller-injected contract and a synchronous `require()` cannot await it (ADR-0052 D1 alt-C). It throws `NotImplementedError('module-loader.ts-via-require')` rather than feeding raw TypeScript to `new Function`. A `.ts` under a `type:module` scope loads as ESM via `import()`, where the injected transform runs.
- **TS-on-import coverage:** `import type`, inline `type` imports, `const enum`, `interface`, `enum`, `satisfies`, and standard decorators all lower before the AST pass. Parity cases: `modules/ts-effect-syntax-cross-file`, `modules/ts-graph-cross-file`, and `modules/ts-standard-decorator`, all head-to-head against `tsx` with exact host `esbuild@0.28.0` injected on the rifty side. Legacy `experimentalDecorators` semantics are a distinct tsconfig-driven mode and are not claimed by the standard-decorator case.
