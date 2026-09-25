---
area: runtime-js
status: ready
title: ESM/CJS Function guards admit runtime-keyed global writes and throw only when the key is 'Function'
created: 2026-09-15
why: the finite guard rejects at load any module whose global write/define/delete uses a computed key it cannot fold; vitest 4.1.11's utils, expect, test and setup-common modules (Symbol consts, an imported Symbol, parameter and for-in keys) and undici's lib/global.js die as `module-loader.{esm,cjs}-global-function-assignment` although Node writes them all
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, ADR-0171, ADR-0444, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm-job-preparation.ts]
---

## Context

`esm.ts` `isGlobalFunctionWriteMember` (`propertyName === undefined &&
isComputedMember`) and `isGlobalFunctionMutationCall` → `propertyMayBeFunction`
(non-literal key ⇒ maybe `'Function'`) flag the whole module; `cjs.ts` twins
the same. On the goal's claimed path six vitest 4.1.11 ESM modules are
rejected, all at writes/defines/deletes (evidence §S1/§S2): Symbol-const keys
(`@vitest/utils` timers.js:29, `@vitest/expect` index.js:738/739/747), an
imported Symbol binding (test chunk :4152), `vi.stubGlobal`/`unstubAllGlobals`
parameter keys (:3621/:3639/:3640) and `for (const key in config.defines)`
(setup-common :32) — the last two imported by both pool workers. undici
8.10.2 `lib/global.js` / `lib/web/fetch/global.js` are the CJS twin. A static
Symbol proof cannot admit parameter/for-in/imported keys; ADR-0444 moves the
check for non-constant keys to the moment Node coerces the key, keeping the
ceiling exactly when the key is `'Function'` (Node would replace the global
constructor there, §O3).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

- Oracle: host Node v24.16.0 (V8) — ESM/CJS writes, `Object.defineProperty` and `Reflect.set|defineProperty|deleteProperty` on `globalThis`/`global` with Symbol, string and object keys; property-key coercion order and count per operation (evidence §O1–§O4).
- Mechanism: none reused from upstream; the guest key value reaches V8's own ToPropertyKey unchanged, or through a `Symbol.toPrimitive` proxy that V8 coerces at the same points (ADR-0444, spike §O5).

## Acceptance

1. The vitest 4.1.11 shapes load and run under the real rifty loader as in Node — timers.js Symbol-const assignment, expect's three Symbol.for-const `Object.defineProperty` calls, the test chunk's imported-Symbol `Object.defineProperty` and `vi.stubGlobal`/`unstubAllGlobals` parameter keys (define, `Reflect.deleteProperty`, restore of an existing global's descriptor), setup-common's for-in `globalThis[key] = …` — no `module-loader.esm-global-function-assignment`; values and descriptors equal Node's (Parity 1). → I6
2. The CJS twin loads and runs as in Node: undici 8.10.2 `lib/global.js` / `lib/web/fetch/global.js` Symbol.for-const `Object.defineProperty` and `globalThis[sym]` reads, and for-in / parameter keys through `global` (Parity 2). → ADR-0444
3. A non-'Function' object key on a guarded write is coerced exactly as by Node — same count and order relative to RHS and descriptor for assignment, compound assignment, `++`, `Object.defineProperty`, `Reflect.set`, `delete`, and a `Symbol.toPrimitive` key yielding a Symbol (Parity 3). → ADR-0444
4. A runtime key that IS `'Function'` (string, or object coercing to it) on assignment, compound assignment, `++`, array-destructuring and for-of targets, `Object.defineProperty`, `Reflect.set`, `Reflect.defineProperty`, `Reflect.deleteProperty`, `__defineGetter__`, `delete` throws `NotImplementedError` `module-loader.esm-global-function-assignment` (ESM) / `module-loader.cjs-global-function-assignment` (CJS) at that operation, the defining module itself loads, and host `globalThis.Function` stays the host constructor (`tests/conformance/modules/global-computed-key-guard.test.ts`). → ADR-0444
5. At module top level such a key throws at the write: earlier statements and earlier for-in keys have taken effect in Node's order, and the import/require fails with the named ceiling (same conformance file). → ADR-0444
6. Load-time ceilings stay: keys folding to `'Function'` (existing `tests/conformance/modules/resolver.test.ts` ESM/CJS tables) and runtime-key reads used as a constructor (`Reflect.get(globalThis, key)` then called, `new globalThis[key](…)`) reject the module before any statement runs (same conformance file). → ADR-0444

## Parity cases

1. `tools/node-parity-runner/cases/modules/global-computed-key-writes-esm.case.ts` entries `safeTimers`…`unstubbed`, `clean`: Node v24.16.0 prints `["safeTimers",true,"safe"],["matchers",true,true,"object"],["globalExpect","globalExpect"],["defines",1,"b"],["stubbed",42,"stubbed",true],["unstubbed",false,"original"]` (evidence §O1); rifty today throws `module-loader.esm-global-function-assignment` at `/work/utils-timers.mjs`. → I6
2. `tools/node-parity-runner/cases/modules/global-computed-key-writes-cjs.case.ts` entries `dispatcher`…`dynamic`, `clean`: Node prints `["dispatcher",true,true],["origin","http://localhost:3000"],["originCleared",null,true],["dynamic","cjs",9,true,false]` (§O2); rifty today throws `module-loader.cjs-global-function-assignment` at `/work/undici-global.js`. → ADR-0444
3. Object-key coercion, both cases: ESM `["objectKey","rhs,key,key,rhs,key,key,key,key,desc,rhs,key",6]`, `["toPrimitiveKey","key,string",7,false]`; CJS `["objectKey","rhs,key,key,rhs,key,key,desc",3]` (§O1/§O2/§O4). → ADR-0444

## Out of scope

- Global `Function` mutation itself (a key that is `'Function'`, static or runtime): stays `NotImplementedError('module-loader.{esm,cjs}-global-function-assignment')`, `docs/public/compat/modules.md` §Known limitations global-Function entry (its text updated to say runtime keys throw at the write); owner `runtime-js/cjs-global-function-assignment`.
- `globalThis[k] ??= v` / `||=` with `k` of `'Function'`: throws the same ceiling at its read coercion although Node may skip the write (ADR-0444 consequence).
- Runtime-key reads used as a constructor, `Object.assign(globalThis, src)` / `Object.defineProperties(globalThis, src)` with non-literal `src`, spread-argument mutation calls: unchanged load-time ceiling, same feature ids; owner `runtime-js/function-constructor-exhaustive-metaprogramming-ceiling`.
- A statically tracked global alias rebound at runtime to another object: a `'Function'` key on it still throws the ceiling (over-approximation, ADR-0444).
- `fn.toString()` and stack columns of a line whose key was wrapped show the loader helper: the existing source-rewrite class (ADR-0009, ADR-0171); `modules.md` §Known limitations note.
- Loading the whole installed vitest tree in the browser: map item 12 acceptance e2e (`runtime-js/vitest-run-acceptance`).

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ fb441a51459a6555cc03791ad4c1e3198d55f58b
- 2026-09-23 — promise widened from Symbol-const keys to every runtime key on the claimed path (map item 5 re-chart, ledger 2026-09-23); carrier = runtime key check, not the goal note's static Symbol proof; ADR-0444 records candidates and kill evidence.
- 2026-09-23 — object keys: exact Node coercion via a lazy `Symbol.toPrimitive` proxy, not a loud throw and not eager coercion (evidence §O4/§O5; eager diverges).
- 2026-09-23 — CJS twin (undici) rides the same helper; its rows trace to ADR-0444, not I6 (undici is not in the vitest tree, §S1).
- 2026-09-23 — no `## Fault matrix`: a loader source rewrite; no cache/persistence/network/concurrency/IPC boundary.
- 2026-09-23 — no browser carrier: the helper is plain JS in guest module code and the parity runner executes the same loader path in-process; the browser run of the real tree is map item 12.
- 2026-09-23 — IMPLEMENT discovery (REV-12, required, fixed here): both guards walked every `delete` operand as a write target, so `delete globalThis?.[k]`/`?.Function`, `delete Object.defineProperty(globalThis, 'Function', …)` and `delete (globalThis.Function = X)` loaded and replaced the host constructor (evidence §D1); `delete` now walks only a (chained) reference as target, other operands as expressions.
- 2026-09-23 — Contract+RED concerns taken in place (NOTE): remaining wrapped sites with 'Function' keys and folded keys after an earlier statement (`tests/conformance/modules/global-computed-key-guard-sites.test.ts`), CJS coercion of `++`/`Reflect.set`/`delete`/toPrimitive and the full restored descriptor (parity `modules/global-computed-key-sites-{esm,cjs}`, §O6).
- 2026-09-23 — key folding (`literalString` & co.) moved verbatim from `esm.ts`/`cjs.ts` into `module-loader/global-write-key.ts` beside the runtime check: one copy, both files under their size pins.
