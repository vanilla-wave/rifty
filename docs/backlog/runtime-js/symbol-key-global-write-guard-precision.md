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
write, `Reflect.set`, `Object.assign(globalThis, { [K]: v })`,
`Object.defineProperties`, `Object.defineProperty`, `delete globalThis[K]`,
CJS twins. PASSES today (unchanged): plain alias read-back
`const v = globalThis[K]`, member access and method call `globalThis[K].f()`
on the stashed object (the R1 record listed the method call as THROWS —
wrong; its RED was masked by the write in the same module), and read-only
`Reflect.get(globalThis, K)` (calling the read result throws —
constructor-read taint, stays).

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
   output — the carrier covers defineProperty with a const alias AND with a
   direct `Symbol.for(...)` key (the alias cannot discriminate a
   direct-key-only regression) → I6
3. Ceiling unchanged (regression): string-literal, concatenated-string,
   unknown-identifier, `let`-bound-symbol, and shadowed-`Symbol` computed keys
   still throw `module-loader.{esm,cjs}-global-function-assignment` — pinned
   in BOTH loaders (a CJS let-allowing mutant must die); a
   `Reflect.get(globalThis, K)` result with provable-Symbol `K` stays
   tainted — calling it throws (mutation-only exemption, read ceiling
   untouched) — pinned in BOTH loaders; the
   existing conformance pins (`tests/conformance/modules/resolver.test.ts`
   Function-assignment describe) stay green → I6 honesty
4. `Reflect.set`/`Object.assign`/`Object.defineProperties`/`delete` with
   provable Symbol keys stop throwing in BOTH loaders (parity + unit) → I6
5. The compat note for the ceiling (`docs/public/compat/modules.md`, the
   `module-loader.{esm,cjs}-global-function-assignment` row) is refined to
   state the Symbol-key exception → I6 honesty

## Reference contract

- Oracle: Node v24.16.0 (host) — Node has no such guard; the patterns simply
  run. Parity `expected` pinned from the oracle, never from memory.
- Mechanism: one `isProvablySymbolKey(node, ctx)` helper per loader twin
  (esm.ts, cjs.ts) consulted at MUTATION key positions only, exactly three
  site families: `isGlobalFunctionWriteMember` (direct writes AND `delete`
  — delete routes through `walkGuardAssignmentTarget`), the mutation key
  arguments inside `isGlobalFunctionMutationCall` (defineProperty /
  Reflect.set / Reflect.deleteProperty / `__defineGetter__` /
  `__defineSetter__` — via a mutation-only `propertyMayBeFunction` wrapper),
  and `objectMayContainFunctionKey` (defineProperties / Object.assign
  literal keys). READ sites keep the UNCHANGED conservative helpers: a
  Symbol key proves the KEY, never the VALUE — the slot may hold a host
  Function, so `Reflect.get(globalThis, K)` keeps its result taint
  (`isReflectGetFunctionCall` → constructor-read ceiling; probed
  2026-10-01: read-only Reflect.get passes, calling the result throws
  `module-loader.esm-global-function-assignment`). Plain computed reads,
  member access and method calls on a stashed object pass today without any
  exemption (the R1-contract claim that the method-call pattern needs the
  read site was wrong; its RED was masked by the write in the same module).
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
   the undici defineProperty shape (alias AND direct key), const-alias
   write/read-back, Reflect.set / Object.assign / Object.defineProperties,
   and full key cleanup → I6

Unit REDs (guard precision): `tests/conformance/modules/symbol-key-global-write.test.ts`
— 16 positive carriers (Acceptance 1/2/4 patterns compile and run in both
loaders, incl. an export-wrapped `export const K = Symbol.for(…)` alias —
RED today — plus the export-wrapped `globalThis`-alias ceiling hole, see
Decisions) + 12 boundary pins (Acceptance 3 in BOTH loaders:
string-literal, concatenated, unknown-identifier, `let`-bound-symbol,
shadowed-`Symbol`, `Symbol.keyFor` keys stay loud, and called
`Reflect.get(globalThis, K)` results stay loud — green today,
regression-only).

## Out of scope

- Widening to `let`/`var` alias tracking, `Symbol.keyFor`, well-known-symbol
  members (`Symbol.iterator` & friends — a fixed-list refinement the claimed
  evidence does not need), or user-defined `Symbol.foo` statics —
  conservative loud path stays.
- The remaining Function-constructor ceiling
  (`function-constructor-exhaustive-metaprogramming-ceiling`) and the global
  Function-assignment ceiling itself (`cjs-global-function-assignment`) —
  unchanged for every key that may be 'Function'.
- Read/eval/callee guard sites (`isGlobalFunctionUnknownReadMember`,
  `isGlobalEvalCallMember`, `guardCalleeMayBeHostFunction`): probed not loud
  for the claimed shapes, so unchanged — calling a Symbol-keyed global
  (`globalThis[K]()`) stays on the conservative path.

## Decisions

- 2026-10-01 — `const`-only alias marking: `let`/`var` stay unknown (loud).
  The claimed evidence uses `const`; reassignment tracking would add
  machinery the contract is deliverable without (§Simplicity).
- 2026-10-01 — reception (REV-12) of Contract+RED R1 (blocker, F1–F6):
  F2 — the read/eval-site exemption mandate is CUT: probed on the branch,
  computed reads and method calls on a stashed object pass today (the R1
  RED was masked by the write in the same module); the helper consults only
  the three write/mutation site families. F1 — CJS carriers extended:
  direct-`Symbol.for` defineProperty + Reflect.set/Object.assign/
  defineProperties in both the parity case and the unit file. F3 —
  export-wrapped const alias carrier added; alias marking is
  Identifier-pattern-only (destructuring/defaults never marked), lookup
  stops at the nearest binding (existing scope-stack machinery). F4 — CJS
  boundary pins added (string-literal/unknown/let-bound/shadowed) so a CJS
  let-allowing mutant dies. F5 — both parity cases now delete EVERY key they
  set. F6 — compat-note refinement declared as Acceptance 5.
- 2026-10-01 — reception (REV-12) of Contract+RED R2 (blocker F2 + concern):
  the R2 mechanism premise "the value at a Symbol key is never the host
  Function" was FALSE — a Symbol key proves the key, never the value.
  Exemption limited to MUTATION key positions; `Reflect.get` keeps the
  conservative read taint, pinned by new boundary tests in both loaders
  (called result stays loud). Context baseline corrected: the method-call
  pattern passes today (R1 record was masked by the write). Implementation
  note (probed): `predeclareGuardLexicalScope` does not unwrap
  `ExportNamedDeclaration`, so export-wrapped consts never enter `bindings`
  and alias marking silently no-ops — IMPLEMENT unwraps export declarations
  in lexical predeclaration. Forced consequence, declared + pinned: the
  export-wrapped `globalThis`-alias ceiling hole closes (`export const g =
  globalThis; g.Function = fn` evades the guard today — probed; after the
  unwrap it throws, matching the non-export twin).
