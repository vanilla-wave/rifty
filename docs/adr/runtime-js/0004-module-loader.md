# ADR 0004: Module loader — hybrid `es-module-lexer` + own resolver (D-003)

Status: Accepted
Date: 2026-05

> Note: only the regex ESM-loader is superseded (by ADR-0009). The resolver, module registry, CJS loader, and CJS↔ESM interop remain active.

Decision D-003: CJS and ESM share one resolver and one module registry. ESM is parsed with `es-module-lexer`, rewritten to async-function form, and run via `new Function`.

> TL;DR: CJS and ESM share one Node resolver and registry; ESM is lexed via `es-module-lexer`, rewritten to async-function form, and run through `new Function`

## Architecture

1. **Resolver** — Node algorithm: walk-up `node_modules`, `package.json` `main`/`exports`/`imports`, conditional exports (`node`/`default`/`import`/`require`), extension fallbacks, directory index. Shared by CJS and ESM via an `esm: boolean` flag selecting conditions.
2. **Module registry** — id-keyed records tracking state (`loading`/`loaded`/`errored`), exports namespace, slot map. Cycles read in-progress exports on re-entry.
3. **CJS loader** — `new Function('module','exports','require','__filename','__dirname', source)`. Exports object registered before the body runs so cycles see half-populated state. JSON parsed in-place.
4. **ESM loader** —
   - `es-module-lexer` finds import/export structure.
   - A token-aware scanner classifies each char (code / string / comment / regex).
   - Static imports → `__importStatic(specifier)`; named bindings → member accesses on the dependency namespace (true live bindings).
   - Exports become getters on a slot table (live re-exports).
   - Body wrapped in `async () => { … }` for top-level `await`.
   - Dynamic `import()` (any context) → `__import(...)`.
5. **CJS ↔ ESM interop** — `wrapCjsAsEsmNamespace(cjsExports)` builds an ESM-shaped namespace: `default` = CJS exports object, own keys exposed as named bindings. `require()` of an ES module is a hard error advising `import()`.

## Why not native browser ESM via Blob URLs

Rejected: free to implement but loses control over resolution and CJS interop. The native module map ignores `package.json` `exports`, and CJS-inside-ESM stays our problem — the "free" path becomes a stack of escape hatches.

## Consequences

- TypeScript / JSX support is a transform step before parsing, not a loader rewrite.
- HMR (M10) plugs into the registry and re-runs only the affected module.
- Source maps stay accurate: rewriter is cheap and emits `//# sourceURL=` per module.
- Each ESM rewrite costs ~2 zone scans on the body — negligible under ~50 KB; larger files will likely be cached by content hash.
