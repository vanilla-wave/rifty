---
area: runtime-js
status: ready
title: "A module that calls or constructs a computed read of a global member (`new global[k](…)`) loads and runs as in Node"
created: 2026-11-24
why: the CJS/ESM Function guard rejects at load any module that calls or constructs `globalThis[k]`/`global[k]` with a key it cannot fold, though nothing is written; es-abstract, typed-array-length/-byte-offset/-byte-length do this, so `typedarray.prototype.slice`, `traverse`, `unzipper` and exceljs's main entry do not load where Node loads them
user_story: As a developer requiring `exceljs` (or any package on es-abstract's `IsDetachedBuffer`/typed-array-length path), I want it to load as in Node, but today rifty throws `module-loader.cjs-global-function-assignment` at load for `new global[availableTypedArrays[0]](arrayBuffer)`
sources: [ADR-0171, ADR-0444, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md, docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/global-write-key.ts]
---

## Context

ADR-0171 routes `import()` in runtime-built functions through a lexical
`Function` proxy; ADR-0444 §3 kept "runtime-key reads used as a constructor"
(`new globalThis[k](…)`, `Reflect.get(globalThis, k)` then called) as a
load-time ceiling: the key may be `'Function'` and the read would hand the
module the host constructor, bypassing that routing. Nothing is written.

Measured (Node v24.16.0, same CJS file):
`var k = ['Uint8Array']; try { new global[k[0]](new ArrayBuffer(0)) } catch {}`
— Node loads, rifty throws `module-loader.cjs-global-function-assignment` at
load (also `new globalThis[k](1)`, `global[k](1)`; `typeof global[k]` loads).
Probe at `c2be2193a`, `createModuleLoader(MemoryFsSync).require`:

```
newComputed THROW module-loader.cjs-global-function-assignment
callComputed THROW module-loader.cjs-global-function-assignment
```

Real sites (moved from `runtime-js/cjs-global-function-assignment`):
`es-abstract@1.24.2/2025/IsDetachedBuffer.js:22`
(`new global[availableTypedArrays[0]](arrayBuffer)`),
`typed-array-length@1.0.8/index.js:41`, `typed-array-byte-offset@1.0.5/index.js:40`,
`typed-array-byte-length@1.0.3/index.js:44` (`new global[typedArray](2)`).
Path: exceljs 4.4.0 main → `unzipper/lib/parse.js:4` → binary → chainsaw →
traverse → `typedarray.prototype.slice` → `es-abstract/2025/GetValueFromBuffer.js:13`
→ `IsDetachedBuffer.js`. `which-typed-array`/`is-typed-array` load only because
they read through `var g = typeof globalThis === 'undefined' ? global : globalThis`
(an untracked alias). First stop of `require('exceljs')` after `node:zlib` on
every host sharing the loader (isolate measured, `distribution/isolate-host-ceiling-modules-load`).

## Challenge

challenge: 2026-11-24 — clear — premise, boundary and invariant set by the assignment (manager thread `cf2ae711`); carrier confirmed at its checkpoint before the edit

## User scenario

`node main.cjs` with exceljs 4.4.0's installed closure: `require('exceljs')`
passes es-abstract/typed-array-* (Node prints `loaded`); rifty today stops at
`NotImplementedError: … module-loader.cjs-global-function-assignment`.

## Acceptance

1. Parity `modules/global-computed-read-callee-{cjs,esm}` green against live
   Node 24 on the ordinary loader (`pnpm test:parity global-computed-read-callee`) → scenario
2. Installed `typed-array-length`, `typed-array-byte-offset`,
   `typed-array-byte-length`, `es-abstract/2025/IsDetachedBuffer`,
   `typedarray.prototype.slice` (exceljs closure) load and compute as in Node
   (same files, Node vs isolate sandbox) → scenario
3. Isolate `library-exceljs.test.ts`: `require('exceljs')` no longer stops at
   `module-loader.cjs-global-function-assignment`; the new stop is pinned → scenario
4. Declared ceiling: such a read whose key is `'Function'` at runtime (string
   or object key) throws `NotImplementedError('module-loader.{cjs,esm}-global-function-assignment')`
   at that read, after earlier statements ran; the module never gets the host
   constructor; host `globalThis.Function` unchanged (conformance
   `global-computed-read-callee`; Node constructs there) → ADR-0171
5. Forms outside the boundary keep their load-time ceiling (conformance):
   writes, static/folded `'Function'` reads, `Reflect.get(G, k)` called,
   an alias of the read called, `G?.[k](…)` → ADR-0444
6. compat `modules.md` row states what is admitted and what stays a ceiling → scenario

## Parity cases

1. CJS: es-abstract `IsDetachedBuffer` shape `new global[names[0]](buf)` →
   `false` live / `true` detached; `new global[n](2).length` per name; alias
   `const g = globalThis; new g[k](3)` → scenario
2. CJS: call forms `global[k](1)`, `globalThis[k].call|apply|bind`; `this` of a
   strict global function called as `global[k]()` / `globalThis[k]?.()` is the
   global; missing key `?.()` → `undefined` → scenario
3. CJS: object / `Symbol.toPrimitive` key coerced once, before arguments
   (`key,arg,string,arg`); nested key expressions; non-constructor → `TypeError` → ADR-0444
4. ESM twins of 1–3 (`globalThis`/`global`, `await` key) → scenario

Key `'Function'` is not a parity row: Node constructs (probe below, `fn`,
`fnImport`), rifty throws the declared ceiling (Acceptance 4).

Node v24.16.0 (`/tmp/gfr/n`, `node main.js` / `node main.mjs`):

```
[["detached",false,true],["lengths",[2,2]],["alias",3],["call","1","2","3","4"],["this",true,true],["optional",null],["objectKey",2,"5","key,arg,string,arg"],["nested",1,1],["notConstructor","TypeError"],["fn",2,2,3,true,4],["fnImport","computed-read-import"]]
[["detached",false,true],["lengths",[2,2]],["alias",3],["call","1","2","3","4"],["this",true,true],["optional",null],["objectKey",2,"5","key,arg,string,arg"],["await",1],["notConstructor","TypeError"],["fn",2,2,3,4],["fnImport","computed-read-import"]]
```

(The CJS probe's `global[F] === Function` is a non-callee read, outside this
unit and ADR-0171's claim.)

## Out of scope

- Global writes/defines/deletes, `Function = …`, `Object.assign(globalThis, …)`,
  `with`, `eval`: unchanged (ADR-0444, `runtime-js/cjs-global-function-assignment`);
  `Object.assign` dead-branch false positive:
  `runtime-js/object-assign-global-nonliteral-load-time-false-positive`.
- Load-time ceiling kept, `module-loader.{cjs,esm}-global-function-assignment`
  (compat modules.md): static or folded `'Function'` read (`global.Function`,
  `global['Fun' + 'ction']`); `Reflect.get(G, k)` called; an alias of the read
  called (`const C = G[k]; new C()`, `{ [k]: C } = G`); optional member
  `G?.[k](…)`.
- Key `'Function'` at runtime: ❌ `module-loader.{cjs,esm}-global-function-assignment`
  at the read (Node constructs; routing it is deferred, §Decisions).
- Reads not called/constructed (`typeof G[k]`, `x = G[k]` compared):
  unchanged, already load; identity `G[k] === Function` is outside ADR-0171's claim.
- Global objects the guard does not track (`(0, globalThis)[k]`,
  `cond ? global : globalThis`): `runtime-js/function-constructor-exhaustive-metaprogramming-ceiling`.
- V8 messages / stack columns on a rewritten line name the helper
  (`backlog/runtime-js/function-rewrite-visible`, ADR-0444 class).

## Decisions

- Carrier (manager, checkpoint 2026-11-24): ADR-0444's key check at the read, `G[$k(k)]`; no value-substituting helper — no consumer reads `Function` through a computed global key.
- Deferred: a runtime `'Function'` key yielding the routed `Function` (ADR-0171) — trigger: a real package constructing `Function` through a computed global key.
- Feature id: the format's existing `module-loader.{cjs,esm}-global-function-assignment` (same ceiling, moved to the read); message names write or call/construct.
- Contract change (manager): `global-computed-key-guard.test.ts` drops ESM `new globalThis[key](…)` from its kept load-time ceilings; `Reflect.get` stays.
- Not widened (manager): an alias of the read or a destructured read called stays a load-time ceiling even though this carrier could check it; candidate filed as a finding.

- Applies to tracked global objects only (`globalThis`, `global`, tracked aliases), as every other guard site.
- `self`/`window`: undefined in rifty CJS/ESM as in Node (probe `typeof self` → `undefined`); nothing to route.
