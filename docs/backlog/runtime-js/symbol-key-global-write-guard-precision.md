---
area: runtime-js
status: ready
title: ESM/CJS Function guards accept `globalThis[<Symbol const>]` writes (@vitest/utils, undici)
created: 2026-09-15
why: the finite guard flags any computed-key write/defineProperty on globalThis as a possible `Function` mutation; `globalThis[SAFE_TIMERS_SYMBOL] = timers` (@vitest/utils) and `Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.2'), …)` (undici, hence jsdom) are rejected as `module-loader.{esm,cjs}-global-function-assignment` although a Symbol-valued key can never be the string 'Function'
user_story: As a developer running vitest in the browser shell, I want @vitest/utils' timers stash and undici's globalDispatcher defineProperty to load, but today the test worker dies at import with `module-loader.esm-global-function-assignment` on a key that provably is not 'Function'
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

`esm.ts` `isGlobalFunctionWriteMember` treats `propertyName === undefined &&
isComputedMember` as a Function write; `isGlobalFunctionMutationCall` does the
same for `Object.defineProperty(globalThis, <non-literal>, …)`; `cjs.ts`
carries the twins. Observed: vitest 3.2.7 CLI dies at import; vitest 4 hits it
in the test worker (`@vitest/utils/dist/timers.js`); `import('jsdom')` dies in
undici. The existing ceiling item
(`cjs-global-function-assignment`) keeps dynamic `globalThis[...]` mutation
loud when the key MAY be 'Function'; this item refines "may": a key provably
Symbol-valued can never be the string 'Function' (nor 'eval').

RED baseline (probed 2026-10-01 on the epic branch, module-loader in-process):
THROWS today — direct write `globalThis[Symbol.for('x')] = v`, const-alias
write, method call on the stashed object `globalThis[K].f()` (via
`guardCalleeMayBeHostFunction` on the computed read), `Reflect.set`,
`Object.assign(globalThis, { [K]: v })`, `Object.defineProperties`,
`Object.defineProperty`, `delete globalThis[K]`, CJS twins. PASSES today
(unchanged): plain alias read-back `const v = globalThis[K]`.

Provable rule (both loaders, one helper each): a computed key is NOT
Function/'eval'-suspect when it is
- a `Symbol(...)` or `Symbol.for(...)` call with module-scope-unshadowed
  `Symbol` (existing `isGuardShadowed` machinery), or
- an Identifier bound by `const` (same scope chain) to one of the above
  (new `symbolKeyAliases` scope set mirroring the existing alias trackers;
  `let`/`var` bindings are NOT marked — reassignment keeps them unknown).

`Symbol.keyFor` returns a string, not a symbol — NOT accepted. A shadowed
`Symbol` (e.g. a function parameter named `Symbol`) keeps every pattern loud.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. ESM parity: the @vitest/utils shape — `const SAFE = Symbol.for('…');
   globalThis[SAFE] = timers`, read-back, and method call
   `globalThis[SAFE].setTimeout(…)` — compiles and runs with Node-identical
   output; the undici shape `Object.defineProperty(globalThis,
   Symbol.for('undici.globalDispatcher.2'), …)` runs → I6
2. CJS parity: the same two shapes through `cjs.ts` run with Node-identical
   output → I6
3. Ceiling unchanged (regression): string-literal, concatenated-string,
   unknown-identifier, `let`-bound-symbol, and shadowed-`Symbol` computed keys
   still throw `module-loader.{esm,cjs}-global-function-assignment`; the
   existing conformance pins (`tests/conformance/modules/resolver.test.ts`
   Function-assignment describe) stay green → I6 honesty
4. `Reflect.set`/`Object.assign`/`Object.defineProperties`/`delete` with
   provable Symbol keys stop throwing (unit-pinned; they share the two
   helpers) → I6

## Reference contract

- Oracle: Node v24.16.0 (host) — Node has no such guard; the patterns simply
  run. Parity `expected` pinned from the oracle, never from memory.
- Mechanism: one `isProvablySymbolKey(node, ctx)` helper per loader twin
  (esm.ts, cjs.ts) consulted wherever the guard today treats
  `propertyName === undefined && isComputedMember` (or a non-literal key
  argument) as Function/'eval'-suspect: write member, mutation-call key
  positions, object-literal computed keys, computed read member (feeds
  `guardCalleeMayBeHostFunction` — the method-call pattern), eval read/call
  twins. One rule, no per-site judgment.
- Scope discipline: `let`/`var`-bound and shadowed keys stay loud — the
  claimed evidence (@vitest/utils, undici) uses `const` only.

## Parity cases

1. Node v24.16.0 ESM carrier
   `tools/node-parity-runner/cases/modules/symbol-key-global-write-esm.case.ts`:
   const-alias write + read-back, method call through the stashed object,
   defineProperty with a direct `Symbol.for(...)` key, a `Symbol('local')`
   write, and a provable-key `delete` — `expected` oracle-pinned → I6
2. Node v24.16.0 CJS carrier
   `tools/node-parity-runner/cases/modules/symbol-key-global-write-cjs.case.ts`:
   the undici defineProperty shape + const-alias write/read-back + delete →
   I6

Unit REDs (guard precision): `tests/conformance/modules/symbol-key-global-write.test.ts`
— 12 positive carriers (Acceptance 1/2/4 patterns compile and run, RED
today) + 7 boundary pins (Acceptance 3: string-literal, concatenated,
unknown-identifier, `let`-bound-symbol, shadowed-`Symbol`, `Symbol.keyFor`
keys stay loud — green today, regression-only).

## Out of scope

- Widening to `let`/`var` alias tracking, `Symbol.keyFor`, well-known-symbol
  members (`Symbol.iterator` & friends — a fixed-list refinement the claimed
  evidence does not need), or user-defined `Symbol.foo` statics —
  conservative loud path stays.
- The remaining Function-constructor ceiling
  (`function-constructor-exhaustive-metaprogramming-ceiling`) and the global
  Function-assignment ceiling itself (`cjs-global-function-assignment`) —
  unchanged for every key that may be 'Function'.
- Any read-side alias de-marking beyond what the shared helpers already cover.

## Decisions

- 2026-10-01 — uniform rule over per-site picks: every computed-key suspect
  site consults the same provably-Symbol helper (write, mutation calls,
  object-literal keys, computed read, eval twins). Reads are included because
  the method-call-on-stash pattern (`globalThis[K].setTimeout`) routes
  through `guardCalleeMayBeHostFunction` on the computed read — excluding
  reads would leave the claimed vitest pattern loud.
- 2026-10-01 — `const`-only alias marking: `let`/`var` stay unknown (loud).
  The claimed evidence uses `const`; reassignment tracking would add
  machinery the contract is deliverable without (§Simplicity).
