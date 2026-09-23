---
area: runtime-js
status: ready
title: ESM/CJS Function guards accept `globalThis[<Symbol const>]` writes (@vitest/utils, undici)
created: 2026-09-15
why: the finite guard flags any computed-key write/defineProperty on globalThis as a possible `Function` mutation; `globalThis[SAFE_TIMERS_SYMBOL] = timers` (@vitest/utils) and `Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.2'), …)` (undici, hence jsdom) are rejected as `module-loader.{esm,cjs}-global-function-assignment` although a Symbol-valued key can never be the string 'Function'
epic: vitest-run-in-browser
sources: [ADR-0444, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

`esm.ts` `isGlobalFunctionWriteMember` treats `propertyName === undefined &&
isComputedMember` as a Function write; `isGlobalFunctionMutationCall` does the
same for `Object.defineProperty(globalThis, <non-literal>, …)`. Observed:
vitest 3.2.7 CLI dies at import; vitest 4 hits it in the test worker
(`@vitest/utils/dist/timers.js`); `import('jsdom')` dies in undici. The
existing ceiling item keeps dynamic `globalThis[...]` mutation loud when the
key MAY be 'Function'. An actual primitive Symbol cannot equal that string;
`Symbol(...)` / `Symbol.for(...)` spelling alone does not prove its result:
the global and method are mutable. JavaScript has no Symbol literal syntax.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## User scenario

The claimed vitest tree stores timers under `SAFE_TIMERS_SYMBOL`; undici
defines its dispatcher under `Symbol.for(...)`. These writes must execute
without admitting writes to the host `Function` property.

## Acceptance

- CJS/ESM otherwise-unknown computed mutation keys evaluate once in their
  original position. Actual primitive symbols proceed with Node's values,
  including the vitest const and undici inline-call forms. → I6, ADR-0444
- Direct assignment/update/delete, Object/Reflect mutation calls, accessor
  helpers and computed object descriptor/assignment maps share the same
  runtime key rule; opaque map sources/spreads retain their existing
  parse-time ceiling. → ADR-0444
- A dynamic key producing a string, object or other non-symbol throws
  `module-loader.{cjs,esm}-global-function-assignment` after its expression
  evaluates, before the guarded mutation. This includes shadowed or
  monkeypatched Symbol factories returning `'Function'`; preceding source
  effects remain visible. Static Function keys retain parse-time rejection.
  → ADR-0171, ADR-0444
- Real symbols remain admissible through shadowed/mutable bindings; source
  spelling alone grants neither admission nor rejection. → ADR-0444

## Reference contract

Node v24.16.0 real-loader parity supplies successful mutation values and
evaluation order; ADR-0444 supplies runtime rejection timing and host
constructor protection. Commands/output: [evidence](reference/symbol-key-global-write-guard-precision-evidence.md).

## Parity cases

- `modules/symbol-global-writes-{cjs,esm}.case.ts`: actual symbol writes
  across the mutation family, values, evaluation order, shadowed/mutable
  symbols and deletion outcomes. → I6, ADR-0444

## Out of scope

General dynamic key/alias analysis stays with
`function-constructor-exhaustive-metaprogramming-ceiling`. Non-symbol
dynamic keys retain the named mutation ceiling. Existing global Function
reads, derived-constructor and eval guards are unchanged.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 57602c71af088f69e2f973aa54ae3334644e8150

- 2026-09-23 — observed false positives reproduced; Node v24.16.0 baseline and RED artifacts in [evidence](reference/symbol-key-global-write-guard-precision-evidence.md).
- 2026-09-23 — ADR-0444 selects shared runtime primitive-symbol validation, supplements ADR-0171; Contract+RED required for the explicit rejection-timing policy before source implementation.
