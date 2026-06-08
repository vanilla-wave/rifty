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
| `package.json` `imports` (`#name`) | ❌ | Pending |
| JSON modules via `require` | ✅ | |
| JSON modules via `import` | ✅ | Synthetic default + named keys |
| `node:` built-ins | ❌ | Throws `UNSUPPORTED_PROTOCOL`; arrive in M3 |
| `data:` / `file:` URLs | ❌ | Throws `UNSUPPORTED_PROTOCOL` |
| ESM static `import` | ✅ | Named, default, namespace, side-effect-only |
| ESM `export` named / default / re-export | ✅ | |
| ESM `export * from` | ✅ | |
| ESM `export * as ns from` | ✅ | |
| ESM dynamic `import()` | ✅ | |
| ESM top-level `await` | ✅ | |
| ESM live bindings (named import + re-export) | ✅ | Via member access into source-module namespace |
| CJS cycles (half-populated exports visible) | ✅ | |
| ESM cycles (mutating exports visible) | ✅ | |
| CJS ↔ ESM interop (ESM importing CJS) | ✅ | `default` + named keys |
| CJS ↔ ESM interop (CJS requiring ESM) | ⚠️ | Throws — use `import()` (Node parity) |
| `require()` of a `.ts`/`.tsx` module (CJS scope) | ❌ | Throws `NotImplementedError('module-loader.ts-via-require')`; the esbuild type-strip is async, so a sync `require()` cannot transform it — load `.ts` as ESM via `import()` under a `type:module` scope (ADR-0052) |
| `require.resolve` | ✅ | |
| `import.meta.url` | ❌ | Pending |
| Import attributes (`with { type: 'json' }`) | ❌ | Deferred until needed |

## Known limitations (M2)

- Identifier rewriter for live bindings is AST-based (acorn + scope-tracking walker — ADR 0009). Same-name local shadowing of imported bindings is handled correctly.
- `package.json` `imports` (subpath imports starting with `#`) is not yet wired.
- The in-Worker VFS is in-memory only (M4 adds OPFS).
- A `.ts`/`.tsx` module that classifies as CJS (its nearest package scope is not `type:module`) cannot be `require()`d: the TS type-strip is the async esbuild-via-`runWasi` `transformSource` hook and a synchronous `require()` cannot await it (ADR-0052 D1 alt-C). It throws `NotImplementedError('module-loader.ts-via-require')` rather than feeding raw TypeScript to `new Function`. A `.ts` under a `type:module` scope loads as ESM via `import()`, where the async strip runs.
- **TS-on-import covers `import type`, `const enum`, `satisfies` but NOT decorators.** The `transformSource` esbuild WASI hook runs with `--loader=ts` and no tsconfig, so `import type`/inline `type`-import, `const enum` (lowered to a runtime object, not inlined), `interface`, `enum`, and `satisfies` all strip/lower correctly and round-trip a cross-file `.ts` graph (parity case `modules/ts-effect-syntax-cross-file`, head-to-head against `tsx`). Stage-3 `@decorator` syntax is the exception: esbuild leaves it UN-lowered (passthrough) without `experimentalDecorators`, and the post-strip acorn parse (`ecmaVersion:'latest'`, no decorators plugin) then rejects it — whereas the Node-side `tsx` reference fully lowers it. This is a rifty-pipeline asymmetry, NOT on opencode's source path (no decorators in the vendored tree), tracked in `docs/backlog/runtime-js/ts-import-decorator-lowering`. Wiring esbuild's decorator lowering (a tsconfig/flag pass-through) or an acorn decorators plugin would close it.
