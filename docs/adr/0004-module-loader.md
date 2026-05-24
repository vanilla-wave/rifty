# ADR 0004: Module loader — hybrid `es-module-lexer` + own resolver (D-003)

Status: Accepted
Date: 2026-05

Summary of decision D-003. CJS and ESM share a single resolver and module registry. ESM is parsed with `es-module-lexer`, transformed to async-function form, and executed via `new Function`.

## Architecture

1. **Resolver** — Node algorithm: walk-up `node_modules`, `package.json` `main`/`exports`/`imports`, conditional exports (`node`/`default`/`import`/`require`), extension fallbacks, directory index. The same resolver answers for CJS and ESM, passed an `esm: boolean` to pick the right conditions.
2. **Module registry** — id-keyed records. Each record tracks state (`loading`/`loaded`/`errored`), exports namespace, and a slot map. Cycle handling reads in-progress exports on re-entry.
3. **CJS loader** — `new Function('module','exports','require','__filename','__dirname', source)`. The exports object is registered before the body runs so cycles see the half-populated state. JSON is parsed in-place.
4. **ESM loader** —
   - `es-module-lexer` finds import/export structure.
   - A token-aware source scanner classifies each character (code / string / comment / regex).
   - Static imports get rewritten to `__importStatic(specifier)` and named bindings become member accesses on the dependency namespace (so updates in the source module are visible — true live bindings).
   - Exports become getters on a slot table, so re-exports stay live too.
   - The module body is wrapped in `async () => { … }` to enable top-level `await`.
   - Dynamic `import()` in any context is rewritten to `__import(...)`.
5. **CJS ↔ ESM interop** — `wrapCjsAsEsmNamespace(cjsExports)` builds an ESM-shaped namespace where `default` is the CJS exports object and own keys are exposed as named bindings. `require()` of an ES module is a hard error advising `import()`.

## Why not native browser ESM via Blob URLs

Tempting (free implementation), but we'd lose control over resolution and CJS interop. The native module map doesn't understand `package.json`'s `exports` field, and CJS support inside ESM would still be our problem. The "free" path turns into a stack of escape hatches.

## Consequences

- TypeScript / JSX support arrives as a transform step inserted before parsing, not as a loader rewrite.
- HMR (M10) plugs into the registry and re-runs only the affected module.
- Source maps stay accurate — the rewriter is cheap and we emit `//# sourceURL=` for each module.
- Each ESM rewrite uses ~2 zone scans on the body. For modules under ~50 KB this is negligible; for larger files we'll likely cache by content hash.
