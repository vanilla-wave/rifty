# Compatibility matrix — Modules (M2)

Hand-maintained (the `pnpm compat:generate` data-driven sink isn't wired yet — the script is a drift-check skeleton). Update this file by hand after touching conformance/integration tests.

| Feature | Status | Notes |
|---|---|---|
| `require('./other.js')` | ✅ | Explicit extension |
| `require('./other')` | ✅ | Extension fallback (`.js`, `.mjs`, `.cjs`, `.json`) |
| `require('./dir')` | ✅ | Resolves via directory `index.js` |
| `require('./dir')` with `package.json.main` | ✅ | |
| `node_modules` walk-up | ✅ | |
| Scoped packages (`@scope/pkg/sub`) | ✅ | |
| `package.json` `exports` (string) | ✅ | |
| `package.json` `exports` (subpaths) | ✅ | |
| `package.json` `exports` (conditional: node/import/require/default) | ✅ | |
| `package.json` `exports` (wildcards `*`) | ✅ | |
| `package.json` `imports` (`#name`) | ✅ | Exact, wildcard, and conditional `imports` map entries |
| JSON modules via `require` | ✅ | |
| JSON modules via `import` | ✅ | Synthetic default + named keys |
| `node:` built-ins | ⚠️ | Registry supports `node:` and bare built-ins; each module is a tested subset. `node:constants` is the faithful flattened union of `fs` + Linux-ABI `os` + `crypto.constants` (ADR-0153): real Node numeric values for known keys, `undefined` for absent keys — Node's shape. Reading a constant never throws; the unimplemented-behavior gap surfaces at the syscall (e.g. `fs.openSync` throws `NotImplementedError` for `O_SYNC`/`O_DSYNC` durability, `copyFileSync` for `COPYFILE_FICLONE_FORCE`). `node:vm` covers `Script`, `createContext`, `isContext`, `runInThisContext`, `runInContext`, `runInNewContext`, and `compileFunction`; default engine is a real QuickJS realm (cross-realm isolation), without timeout/`displayErrors`/`cachedData`/`contextExtensions` support (those throw loudly). See the node:vm section below. |
| `node:module` helpers | ⚠️ | `createRequire`, `builtinModules`, `isBuiltin`, `Module.*` mirrors, and compile-cache status constants are implemented. Compile-cache persistence is an explicit browser ceiling: `enableCompileCache()` returns `FAILED` with a message (never fake `ENABLED`), `getCompileCacheDir()` returns `undefined`, and `flushCompileCache()` is a quiet no-op. Parity case `modules/module-builtins-surface` pins the matching constants/function surface; conformance pins the unavailable-cache ceiling. |
| `file:` URL imports | ✅ | Absolute `file://` specifiers resolve through the VFS loader with Node-shaped percent decoding and encoded-separator rejection. `import.meta.url` / `import.meta.resolve` encode resolved POSIX paths through the same codec. Parity `modules/file-url-module-identity`. |
| `data:` URL imports | ❌ | Throws `UNSUPPORTED_PROTOCOL` |
| ESM static `import` | ✅ | Named, default, namespace, side-effect-only |
| ESM `export` named / default / re-export | ✅ | |
| ESM `export * from` | ✅ | |
| ESM `export * as ns from` | ✅ | |
| ESM dynamic `import()` | ✅ | |
| ESM top-level `await` | ✅ | |
| ESM live bindings (named import + re-export) | ✅ | Via member access into source-module namespace |
| CJS cycles (half-populated exports visible) | ✅ | |
| ESM cycles (mutating exports visible) | ✅ | |
| CJS → ESM outer + namespace identity | ✅ | `default` and `module.exports` are the exact CJS outer; one namespace per loaded record; rifty coherent invalidation replaces record + namespace together. Parity: `modules/cjs-esm-namespace`, `modules/cjs-cycle-import-of-inflight` |
| CJS → ESM named exports + reflection | ❌ | Values snapshot, but names come from runtime enumerable own keys rather than Node's static analysis, and descriptors are not Module Namespace exotic descriptors; tracked in `backlog/runtime-js/cjs-esm-static-named-exports` |
| CJS ↔ ESM interop (CJS requiring ESM) | ⚠️ | Throws — use `import()` (Node parity) |
| `require.cache` module records | ❌ | Cache views are detached/absent; self-import from a failed `require` throws `module-loader.cjs-import-job-failed-require`; `loader.invalidate()` is a stronger rifty HMR contract. Tracked in `backlog/runtime-js/require-cache-module-record-surface` |
| ESM `import` of `.ts` / `.tsx` | ✅ | Async transform hook runs real esbuild WASI before the AST ESM pass; parity against `tsx` for cross-file TS syntax and standard decorators |
| tsconfig `paths` aliases | ✅ | Explicit `paths` map (ADR-0066) or `autoDiscoverTsconfigPaths: true` (ADR-0170: nearest `tsconfig.json`, `extends`, JSONC, `baseUrl`) |
| `require()` of a `.ts`/`.tsx` module (CJS scope) | ❌ | Throws `NotImplementedError('module-loader.ts-via-require')`; the esbuild type-strip is async, so a sync `require()` cannot transform it — load `.ts` as ESM via `import()` under a `type:module` scope (ADR-0052) |
| `require.resolve` | ✅ | |
| `require.extensions` / `module._compile` | ⚠️ | Local and `createRequire` views share one table. Explicit CJS files use the longest truthy registered basename suffix, then the current `.js`; hooks override JSON/text handling and replacement source resolves relative to its compile filename (ADR-0294; parity `modules/require-extensions-compile`, `modules/require-extensions-suffix`). Dynamically registered suffixes are not extensionless resolver candidates; ESM-classified files bypass CJS hooks; native `.node` addons remain out of scope. |
| `import.meta.url` | ✅ | File URL for the resolved ESM module id; supports `new URL('./x', import.meta.url)` |
| `import.meta.resolve(spec)` | ✅ | Real loader resolution (v20.6, sync). Any `node:` specifier returned verbatim (not validated at resolve time); files → `file://<abs>`; a bare/relative miss throws the resolver's `MODULE_NOT_FOUND`. Was a stub returning a wrong `file://` URL for bare specifiers |
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
  Function-like mutations or use-as-constructor reads (including dynamic computed keys
  and folded string expressions like `"Fun" + "ction"`), `delete globalThis.Function`,
  `Object.defineProperty(globalThis, "Function", ...)`,
  `Object.defineProperties(...)`, `Object.assign(globalThis, ...)`, `Reflect.set(...)`,
  `Reflect.get(globalThis, ...)` when used as a possible constructor, `Reflect.deleteProperty(...)`,
  `Reflect.defineProperty(...)`, `__defineGetter__` /
  `__defineSetter__`,
  etc.) throw directed `NotImplementedError`s instead of mutating the browser host
  constructor, deleting it, or silently mixing routed and replaced constructors:
  `module-loader.cjs-global-function-assignment` / `module-loader.esm-global-function-assignment`.
  Tracked in `docs/backlog/runtime-js/cjs-global-function-assignment.md`.
- CJS/ESM modules with literal unshadowed/global/computed `eval` text that
  statically touches `Function` or `import`, or modules that combine `with`
  dynamic scope with routed lexical `Function`, throw
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

### `node:vm` — engines + ES2023-vs-V8 divergences

`node:vm` is a compatibility surface, not a security sandbox. Two engines, selectable via
`vmEngine` option / `__RIFTY_VM_ENGINE` (env or global; precedence: explicit > env > global >
default):

- **`quickjs` (default)** — runs context code in a REAL QuickJS-WASM realm with a two-way
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
later runs. A non-object context arg throws Node's exact `ERR_INVALID_ARG_TYPE`. Unsupported
execution controls (`timeout`/`displayErrors`/`cachedData`/`contextExtensions`/…) throw loudly.

The default engine shares the live `contextObject` via a reconcile-based membrane (reseed
host→guest before each run, sweep guest→host after) — observationally equivalent to Node's live
context for synchronous code. Two caveats: a guest callback mutating the sandbox AFTER the run is
seen only at the next run; the host→guest side retains one seed per DISTINCT inbound object/fn for
the context's life (not GC-evicted), so keep `vm` off a hot loop that streams fresh objects in.

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
- The in-Worker VFS is in-memory only (M4 adds OPFS).
- A `.ts`/`.tsx` module that classifies as CJS (its nearest package scope is not `type:module`) cannot be `require()`d: the TS type-strip is the async esbuild-via-`runWasi` `transformSource` hook and a synchronous `require()` cannot await it (ADR-0052 D1 alt-C). It throws `NotImplementedError('module-loader.ts-via-require')` rather than feeding raw TypeScript to `new Function`. A `.ts` under a `type:module` scope loads as ESM via `import()`, where the async strip runs.
- **TS-on-import coverage:** `import type`, inline `type` imports, `const enum`, `interface`, `enum`, `satisfies`, and standard decorators all lower before the AST pass. Parity cases: `modules/ts-effect-syntax-cross-file`, `modules/ts-graph-cross-file`, and `modules/ts-standard-decorator`, all head-to-head against `tsx`. Legacy `experimentalDecorators` semantics are a distinct tsconfig-driven mode and are not claimed by the standard-decorator case.
