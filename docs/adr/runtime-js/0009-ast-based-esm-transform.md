# ADR 0009: AST-based ESM transform

Status: Accepted (supersedes the regex-based approach described in ADR 0004 §"ESM loader")
Date: 2026-05

## Context

The ESM loader (D-003 / ADR 0004) rewrites Node-style ESM source into an
`async () => { ... }` body run via `new Function`. The first implementation
(provisional, Q-2026-05-23-001 in `OPEN_QUESTIONS.md`) used `es-module-lexer`
for import/export ranges plus a hand-rolled zone scanner (`source-scanner.ts`)
and regex substitution to rewrite imported-binding references.

Its known limitation — same-name local shadowing of an imported binding — broke
on real Vite pre-bundled deps (e.g. `dep-BK3b2jBa.js`):

```js
import { win32 } from '…';
function format(win32, …) { return win32.format(…); }
```

The textual rewriter replaced every free-looking `win32` with `__m0.win32`,
including the parameter — producing `function format(__m0.win32, …)` and a
syntax error. Any rewriter without lexical-scope modeling cannot tell a free
reference from a parameter / local / catch param; live-binding correctness
requires scope info.

## Decision

Replace the regex + zone-scanner transformer with an AST-based one:

- Parse with `acorn` (`ecmaVersion: 'latest'`, `sourceType: 'module'`,
  hash-bang + top-level-await allowed).
- Walk manually, maintaining a stack of lexical scopes (function/arrow/method
  bodies, blocks, `for` heads, `catch` params, class decl/expr).
- Collect declared names: function/arrow params (incl. `ObjectPattern`,
  `ArrayPattern`, `AssignmentPattern`, `RestElement`), `VariableDeclaration`,
  `FunctionDeclaration.id`, `ClassDeclaration.id`, `CatchClause.param`.
- For each `Identifier` *reference* (not a declaration, non-computed property
  key, label, or import/export specifier id) whose name matches an imported
  binding *and* is not shadowed by an enclosing scope, replace it with the
  namespace member access.
- Rewrite `import.meta` (`MetaProperty`) to the injected local `import_meta`.
- Rewrite dynamic `import(x)` (`ImportExpression`) to `__import(x)`.

Top-level `import`/`export` declarations are still rewritten, but now via edit
ranges keyed off AST node positions instead of regex matches. For
export-attached declarations (`export const x = …`, `export function f() {}`)
strip only the `export` prefix and append the slot-write, leaving the
declaration body for the identifier walker.

`acorn-walk` is a peer (in dependencies for future use), but the walker is
hand-rolled for precise scope control.

## Consequences

- **Correctness:** Params/locals/catch params sharing a name with an imported
  binding are left alone; Vite's `function format(win32, …)` deps now load.
- **Bundle size:** Adds `acorn` (~120 KB) + `acorn-walk` (~30 KB); drops
  `es-module-lexer` (~50 KB wasm). Net ~100 KB increase — acceptable for the
  correctness win.
- **Per-module cost:** Full parse per module vs. sub-parse. Acorn parses ~1–2
  MB/s: small (<50 KB) modules stay sub-ms, larger (Vite deps) ~10–20 ms. Cache
  by content hash if it becomes a bottleneck.
- **`es-module-lexer`:** Still a dependency (transitional) but no longer
  imported by `module-loader/`; follow-up will remove it once nothing else
  needs it.
- **`source-scanner.ts`:** Deleted — regex/string/template-literal zone
  heuristics now handled by acorn's tokenizer.
- **No public API change.** `executeEsm` signature unchanged; transformer is
  internal.

## References

- `packages/runtime-js/src/module-loader/esm-ast.ts` — top-level import/export
  rewriting and the new `transformEsm`.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — scope-aware
  identifier rewriter.
- ADR 0004 §"ESM loader" — original (now superseded) transform strategy.
