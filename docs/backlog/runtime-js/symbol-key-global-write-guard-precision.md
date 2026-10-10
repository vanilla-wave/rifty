---
area: runtime-js
status: ready
title: ESM/CJS Function guards accept `globalThis[<Symbol const>]` writes (@vitest/utils, undici)
created: 2026-09-15
why: the finite guard flags any computed-key write/defineProperty on globalThis as a possible `Function` mutation; `globalThis[SAFE_TIMERS_SYMBOL] = timers` (@vitest/utils) and `Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.2'), …)` (undici, hence jsdom) are rejected as `module-loader.{esm,cjs}-global-function-assignment` although a Symbol-valued key can never be the string 'Function'
user_story: As a real npm package running in the browser shell, I want symbol-keyed global registration to load like on my machine, but today the module loader rejects the whole file as an explicit ceiling before any code runs
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## User scenario

Goal I6: vitest 4.1.11's test worker imports `@vitest/utils/dist/timers.js`
whose `globalThis[SAFE_TIMERS_SYMBOL] = timers` dies today with
`NotImplementedError: module-loader.esm-global-function-assignment` (evidence
§I6, observed on vitest 3.2.7 CLI import; same line carried by vitest 4). The
CJS twin `undici/lib/global.js` `Object.defineProperty(globalThis,
Symbol.for(...), …)` dies as `module-loader.cjs-global-function-assignment`.

## Context

`esm.ts` `isGlobalFunctionWriteMember` treats `propertyName === undefined &&
isComputedMember` as a Function write; `isGlobalFunctionMutationCall` does the
same for `Object.defineProperty(globalThis, <non-literal>, …)`. Observed:
vitest 3.2.7 CLI dies at import; vitest 4 hits it in the test worker
(`@vitest/utils/dist/timers.js`); `import('jsdom')` dies in undici. The
existing ceiling item keeps dynamic `globalThis[...]` mutation loud when the
key MAY be 'Function'; a key bound (const, same scope) to `Symbol(...)` /
`Symbol.for(...)` or a Symbol literal is a provable non-Function key. The
ceiling for string-typed or unknown keys is unchanged.

## Acceptance

1. ESM: a module whose `globalThis[<ident>] = value` has `<ident>` bound to a
   `Symbol`/`Symbol.for` value (const in scope) loads and the write lands
   (`→ I6`, @vitest/utils shape).
2. CJS: `Object.defineProperty(globalThis, <Symbol-keyed ident>, descriptor)`
   loads (`→ I6`, undici shape).
3. The ceiling stays for keys that may be `'Function'`: a computed key bound
    to a non-Symbol value (e.g. from a variable that may hold `'Function'`)
    still throws `module-loader.{esm,cjs}-global-function-assignment` (`→
    ADR-0171`; guard precision must not weaken the guard).
4. Literal string writes keep today's behavior: `globalThis.Function = …`
    throws; other literal keys (e.g. `globalThis.foo = …`) pass unchanged
    (`→ ADR-0171` named baseline).

## Parity cases

Real Node v24.16.0: symbol-keyed global write lands (`true`); defineProperty
with Symbol key lands (`function`). RED targets:
`modules/esm-symbol-key-global-write.case.ts` and
`modules/cjs-symbol-key-global-define.case.ts` — each fails today with the
respective `NotImplementedError`. The must-STAY-loud side (Acceptance 3) has
no Node oracle for a NotImplementedError — pinned by unit tests on the guard
functions (esm.ts/cjs.ts analyzers run on source text; fault tests).

## Out of scope

- Symbol-keyed `delete globalThis[...]`, `in`/reflection reads — not on the
  claimed path; unchanged.
- Weakening the guard for unknown/string keys — the
  `function-constructor-exhaustive-metaprogramming-ceiling` item still owns
  dynamic mutation.
- CJS `Symbol.for` cross-realm identity — the Symbol registry is the host's.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| metaprogramming ceiling | `globalThis[mayBeFunctionKey] = …` / `defineProperty` with a possibly-`'Function'` key | loud `module-loader.{esm,cjs}-global-function-assignment` (unchanged) (`→ ADR-0171`) |

## Challenge

challenge: 2026-10-02 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); unit premise re-verified by Contract+RED @ 24a8a854 (Node v24.16.0 symbol-key oracle)

## Decisions

- re-cut: 2026-10-06 — agent: after five adversarial review waves each found a
  new static bypass of the scope/alias-aware analyzer (alias chains, parameter
  flows, block shadows, computed spellings), the exemption is now DECISIVE and
  minimal: only a module-top-level `const X = Symbol('<literal>')` /
  `const X = Symbol.for('<literal>')` qualifies, and only when the identifier
  `Symbol` occurs NOWHERE else in the module (occurrence count == qualifying
  factories). Both claimed carriers match exactly (@vitest/utils timers.js,
  undici global.js). Everything else — including previously-accepted benign
  shapes (inline expressions, local `Symbol`-named bindings) — stays loud.
  Over-rejection is the safe direction (ADR-0171 ceiling stays whole).
  — trace: none (analyzer shape is agent-owned; Acceptance 1/2 unchanged)
- ready-verdict: 2026-10-02 — Contract+RED @ 24a8a8546976c82de76e4f4ef1a6d2dfad6cd9e7
- 2026-10-02 — agent (PICKUP): carrier = precision in the two existing guard
  analyzers, not a new mechanism: track identifiers initialized (const
  declarator, same scope) with `Symbol(...)`/`Symbol.for(...)` calls or Symbol
  literals as provably non-'Function' keys. Goal carrier note: "a computed key
  bound to a `Symbol` value is provably never `'Function'`".