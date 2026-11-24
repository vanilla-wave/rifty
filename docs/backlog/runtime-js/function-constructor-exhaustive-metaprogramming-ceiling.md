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

Observed 2026-09-23
(`docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-final-green.json`,
Bugs concern; identical before and after ADR-0444): with runtime key `k = 'Function'`
these replace host `Function` with no ceiling —
- ESM+CJS global object via a non-identifier expression: `(0, globalThis)[k] = 1`,
  `(true ? globalThis : {})[k] = 1`, `globalThis.globalThis[k] = 1`,
  `delete (0, globalThis)[k]`;
- `.call`/aliased mutators: `Object.defineProperty.call(Object, globalThis, k, …)`,
  `(0, Reflect.set)(globalThis, k, 1)`;
- CJS: `eval('global[k] = 1')`, `(function(){return this})()[k] = 1`,
  `(0, global)[k] = 1`.

Observed 2026-11-24 at `d27970e43` (paths the unit `runtime-js/computed-global-read-callee`
does not touch): a CJS module `exports.f = (k) => <form>` loaded with
`createModuleLoader(MemoryFsSync).require` (`pnpm exec tsx`), then `f('Function')` —
- `(globalThis?.[k])`, `global[k].valueOf()`, `const C = global[k]; return C`:
  each loads and returns the host `Function` itself (`=== Function` of the test
  realm); `(globalThis?.[k])('return 1')` (callee a `ChainExpression`) loads and
  constructs too;
- tagged template ``global[k]`return import('node:os')` ``: loads; the returned
  function is built by host `Function` and its `import()` resolves through the
  host, not the loader (lexical `Function` routes it).
A later `import()` through the first three is inferred from the host value, not run.

Review 1 of PR #439 (2026-11-24), same probe; each loads at `c2be2193a` (before
that unit) and after it — `f(…)` hands out or calls the host `Function`:
`(0, G[k])(s)`, `(c ? G[k] : 0)(s)`, `G[k][j](G, 'Function')` (`k = 'Reflect'`,
`j = 'get'`: returns host `Function`), `[G[k]][0](s)`, `G[k]` passed as an
argument and called, `G[k].Function(s)` (`k = 'globalThis'`),
`G[k].get(G, 'Function')(s)` (`k = 'Reflect'`), `G[k].constructor(s)` (`k = 'Object'`).

Key-check helper shadowed (ADR-0444 write side, since that ADR): the per-module
helper is a lexical name, so `with` or a sloppy direct `eval` declaring it
disables the check. Probe at `6a3bbf410`, CJS, `f('Function')`, then
`globalThis.Function === Function`:

```
withWrite  exports.f=function(k){ with(new Proxy({},{has:(t,p)=>typeof p==='string'&&p.startsWith('__rifty'),get:(t,p)=>p===Symbol.unscopables?undefined:x=>x})){ global[k] = function W(){}; } }
           loads; hostIntact false
evalWrite  exports.f=function(k){ eval('var __rifty'+'GlobalKey=x=>x'); global[k] = function W(){}; }
           loads; hostIntact false
```

The read side (`new G[k](…)`) keeps a load-time ceiling for a module with
`with` or a direct `eval` (unit `runtime-js/computed-global-read-callee`); the
write side does not. Owner runtime-js (module-loader); trigger: next guard unit.

Key `'eval'`: `G[k](s)` with `k === 'eval'` is an indirect eval in Node and rifty
(`var x = 'module-local'; global[k]('typeof x')` → `'undefined'`), as
`global.eval(s)` and `(0, eval)(s)` before that unit: its runtime text,
`import()` included, runs through the host, not the loader.

## Known false positives

- Non-literal `Object.assign(globalThis, src)` in a dead branch rejects
  `fetch-blob@3.2.0` (`node-fetch@3.3.2`) at load: own finding
  `runtime-js/object-assign-global-nonliteral-load-time-false-positive`.
- An alias of a computed global read later called — `const C = G[k]; new C()`,
  `const { [k]: C } = G; new C()` — rejects at load (Node loads; conformance
  `global-computed-read-callee.test.ts` pins it). Candidate: ADR-0444's key
  check at the read, as unit `runtime-js/computed-global-read-callee` does for
  a direct callee (not widened there, manager decision 2026-11-24). Trigger: a
  real package calling such an alias.

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
