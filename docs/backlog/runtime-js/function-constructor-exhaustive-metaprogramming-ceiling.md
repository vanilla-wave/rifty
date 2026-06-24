---
area: runtime-js
status: active
title: Exhaustive Function/eval metaprogramming ceiling
created: 2026-06-24
why: Prettier/ESLint package tooling needs routed lexical Function/import() plus loud ceilings for known dynamic-scope and derived-host paths, but a fully exhaustive static guard for every JavaScript metaprogramming alias shape is broader than that user goal
user_story: As a developer running arbitrary Node packages in rifty, I want every import-bearing Function/eval metaprogramming escape either routed or loudly rejected, but today the guard is scoped to documented static patterns rather than a proof-complete JavaScript alias analysis
sources: [ADR-0171, docs/public/compat/modules.md, tests/conformance/modules/resolver.test.ts]
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
