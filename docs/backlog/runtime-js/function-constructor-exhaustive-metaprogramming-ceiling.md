---
area: runtime-js
status: draft
title: Exhaustive Function/eval metaprogramming ceiling
created: 2026-06-24
why: Prettier/ESLint package tooling needs routed lexical Function/import() plus loud ceilings for known dynamic-scope and derived-host paths, but a fully exhaustive static guard for every JavaScript metaprogramming alias shape is broader than that user goal
user_story: As a developer running arbitrary Node packages in rifty, I want every import-bearing Function/eval metaprogramming escape either routed or loudly rejected, but today the guard is scoped to documented static patterns rather than a proof-complete JavaScript alias analysis
sources: [ADR-0171, ADR-0444, docs/public/compat/modules.md, tests/conformance/modules/resolver.test.ts, docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-final-green.json]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/function-import-routing.ts]
---

## Context

ADR-0171 closed the package-tooling path needed by Prettier/ESLint-class CLIs:
lexical `Function` constructors created inside rifty-loaded CJS/ESM modules route
constructed `import()` through the VFS loader, and known unsafe combinations
(`with`/`eval` dynamic scope, nested `Function`, derived host constructors,
global `Function` mutation) throw directed `NotImplementedError`s.

That is not the same as a proof-complete alias analysis for every JavaScript
metaprogramming shape. The current guard covers the concrete static forms pinned
by conformance tests and docs. Exotic shapes involving dynamic property graphs,
opaque object flows, proxy-mediated reflection, cross-realm pre-captured host
constructors, or dynamically composed derived-constructor bodies are outside the
current claim. Dynamically composed `eval(...)` text is also outside the static
guard claim. Import-time guards must not reject modules merely because such a
dynamic evaluator is defined; doing so breaks real packages like Vite before the
path executes.

## Known bypass shapes

Observed 2026-09-23 (symbol-key-global-write-guard-precision Final+GREEN, Bugs
concern; identical before and after ADR-0444): with runtime key `k = 'Function'`
these replace host `Function` with no ceiling —
- ESM+CJS global object via a non-identifier expression: `(0, globalThis)[k] = 1`,
  `(true ? globalThis : {})[k] = 1`, `globalThis.globalThis[k] = 1`,
  `delete (0, globalThis)[k]`;
- `.call`/aliased mutators: `Object.defineProperty.call(Object, globalThis, k, …)`,
  `(0, Reflect.set)(globalThis, k, 1)`;
- CJS: `eval('global[k] = 1')`, `(function(){return this})()[k] = 1`,
  `(0, global)[k] = 1`.

## Options or Next

- Define a finite closure target: list the exact alias/property/reflection shapes
  to cover, including proxy/cross-realm exclusions.
- Add parity tests that first demonstrate the escape or false-positive against
  real Node, then either route it or throw a directed ceiling.
- Consider a dedicated AST data-flow pass if the finite target outgrows the
  current local walkers. Do not add heuristic silent fallbacks.

## Reversibility

REVERSIBLE — backlog item + compat caveat. Promoting this into a broad runtime
contract may become IRREVERSIBLE if it changes public compatibility claims.
