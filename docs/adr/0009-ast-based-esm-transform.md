# ADR 0009: AST-based ESM transform

Status: Accepted (supersedes the regex-based approach described in ADR 0004 §"ESM loader")
Date: 2026-05

## Context

The ESM loader (D-003 / ADR 0004) takes Node-style ESM source, rewrites it into
the body of an `async () => { ... }` and runs it via `new Function`. The first
implementation used `es-module-lexer` for import/export ranges plus a
hand-rolled "JS zone scanner" (`source-scanner.ts`) and regex substitution to
rewrite identifier references for imported bindings.

That approach was provisional (recorded as Q-2026-05-23-001 in
`OPEN_QUESTIONS.md`). The known limitation listed there — "same-name local
shadowing of an imported binding misbehaves" — bit us when loading real Vite's
pre-bundled deps, e.g. `dep-BK3b2jBa.js`. Vite imports `win32` from a path
module, then defines local helper functions that take a `win32` parameter:

```js
import { win32 } from '…';
function format(win32, …) { return win32.format(…); }
```

The textual rewriter replaced every free-looking `win32` with `__m0.win32`,
including the parameter and its uses inside `format` — producing
`function format(__m0.win32, …)` and an immediate syntax error.

In general any rewriter that doesn't model lexical scope cannot distinguish a
free reference from a parameter / local variable / catch param. Live binding
correctness requires scope information.

## Decision

Replace the regex+zone-scanner transformer with an AST-based transformer:

- Parse the source with `acorn` (`ecmaVersion: 'latest'`, `sourceType:
  'module'`, hash-bang and top-level-await allowed).
- Walk the tree manually, maintaining a stack of lexical scopes
  (function/arrow/method bodies, block statements, `for` heads, `catch`
  parameters, class declarations / expressions).
- Collect declared names from function/arrow parameters (including
  destructured: `ObjectPattern`, `ArrayPattern`, `AssignmentPattern`,
  `RestElement`), `VariableDeclaration`, `FunctionDeclaration.id`,
  `ClassDeclaration.id`, `CatchClause.param`.
- For each `Identifier` *reference* (not a declaration, not a non-computed
  property key, not a label, not part of an import/export specifier id) whose
  name matches one of the module's imported bindings *and* is not shadowed by
  any enclosing scope, emit an edit replacing it with the namespace member
  access.
- Rewrite `import.meta` (a `MetaProperty`) to the local `import_meta` injected
  by the wrapper.
- Rewrite dynamic `import(x)` (`ImportExpression`) to `__import(x)`.

Top-level `import` / `export` declarations are still rewritten as before, but
now into edit ranges keyed off AST node positions rather than regex matches.
For declarations attached to exports (`export const x = …`,
`export function f() {}`) we strip only the `export` prefix and append the
slot-write afterward, so the declaration body is left in place for the
identifier walker to handle.

Acorn-walk is a peer (the package is in dependencies for future use), but the
current walker is hand-rolled to give us precise scope control.

## Consequences

- **Correctness:** Parameters, locals, catch params, etc. that happen to share
  a name with an imported binding are correctly left alone. The Vite
  pre-bundled deps with `function format(win32, …)` now load.
- **Bundle size:** Adds `acorn` (~120 KB) and `acorn-walk` (~30 KB) to the
  worker bundle. We previously shipped `es-module-lexer` (~50 KB wasm); the
  net increase is ~100 KB. Acceptable for the correctness win.
- **Per-module cost:** A full parse per module instead of a sub-parse. In
  practice acorn parses an average dep at ~1–2 MB/s; small (< 50 KB) modules
  remain sub-millisecond, larger ones (e.g. Vite's bundled deps) cost
  ~10–20 ms. We'll cache by content hash if this becomes a bottleneck.
- **`es-module-lexer`:** Still listed as a dependency for transitional reasons
  but no longer imported by `module-loader/`. A follow-up will remove it once
  we're sure no other surface needs it.
- **`source-scanner.ts`:** Deleted. The zone-scanner heuristics for
  regex/string/template literals are now handled by acorn's real tokenizer.
- **No public API change.** `executeEsm` signature is unchanged; the
  transformer is internal.

## References

- `packages/runtime-js/src/module-loader/esm-ast.ts` — top-level import/export
  rewriting and the new `transformEsm`.
- `packages/runtime-js/src/module-loader/esm-ast-walker.ts` — scope-aware
  identifier rewriter.
- ADR 0004 §"ESM loader" — describes the original (now superseded) transform
  strategy.
