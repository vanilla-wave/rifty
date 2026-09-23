# Evidence — symbol-key-global-write-guard-precision (pickup, 2026-09-23)

Base `325ae797c` (branch `t3code/vitest-run-browser`). Oracle: host Node
v24.16.0, npm 11.17.0. Probe scripts lived in `/tmp/vgoal/u5/` (not committed);
decisive source is quoted next to each command, output verbatim.

## S1 — tree scan through rifty's load-time guards

Install (npm 11.17.0): `{"type":"module","devDependencies":{"vitest":"4.1.11","undici":"8.10.2"},"overrides":{"vite":"8.0.16"}}`
→ `npm ls`: `undici@8.10.2`, `vitest@4.1.11` (`vite@8.0.16 overridden`), 46 packages.
Scan: every `.js/.mjs/.cjs` file; ESM (by `.mjs` / nearest `package.json`
`type`) through `assertNoEsmFunctionRoutingCeiling(source, id)`
(`esm.ts:37`), CJS through `createModuleLoader(vfs).require` (guard runs
before execution; only `module-loader.*` NotImplementedErrors reported).

```
$ tsx scan.mts /tmp/vgoal/u5/vt/node_modules
ESM module-loader.esm-global-function-assignment /@vitest/expect/dist/index.js
ESM module-loader.esm-global-function-assignment /@vitest/mocker/dist/register.js
ESM module-loader.esm-global-function-assignment /@vitest/utils/dist/timers.js
CJS module-loader.cjs-global-function-assignment /undici/lib/global.js
CJS module-loader.cjs-global-function-assignment /undici/lib/web/fetch/global.js
ESM module-loader.esm-global-function-assignment /vitest/dist/chunks/globals.Dj1TGiMC.js
ESM module-loader.esm-global-function-assignment /vitest/dist/chunks/setup-common.DYx3LtFI.js
ESM module-loader.esm-global-function-assignment /vitest/dist/chunks/test.DNmyFkvJ.js
scanned esm=191 cjs=206
```

No other `module-loader.*` ceiling fires anywhere in the tree. Reach:
`vitest/dist/workers/forks.js:8,15` and `workers/threads.js:8,15` import
`setup-common` and `test.DNmyFkvJ` (both pools); `vitest/dist/index.js` (the
test file's `import … from 'vitest'`) imports the test chunk; `@vitest/utils/timers`
and `@vitest/expect` load under both. `@vitest/mocker/register.js` (browser
mode) and `globals.Dj1TGiMC.js` (`globals: true`) are off the scenario but
carry the same shapes. undici is not in the vitest tree (jsdom epic consumer).

## S2 — exact trigger sites

Instrumented copy of `esm.ts` logging each `hasGlobalFunctionWrite = true`
with the guard line and the source node:

```
@vitest/expect/dist/index.js
  esm.ts:449 src:738 Object.defineProperty(globalThis, MATCHERS_OBJECT, { get: () => globalState })
  esm.ts:449 src:739 Object.defineProperty(globalThis, JEST_MATCHERS_OBJECT, { configurable: true, get: …
  esm.ts:449 src:747 Object.defineProperty(globalThis, ASYMMETRIC_MATCHERS_OBJECT, { get: () => asymmetricMatchers })
@vitest/mocker/dist/register.js
  esm.ts:677 src:27 globalThis[__VITEST_GLOBAL_THIS_ACCESSOR__]
@vitest/utils/dist/timers.js
  esm.ts:677 src:29 globalThis[SAFE_TIMERS_SYMBOL]
vitest/dist/chunks/globals.Dj1TGiMC.js
  esm.ts:677 src:27 globalThis[api]
vitest/dist/chunks/setup-common.DYx3LtFI.js
  esm.ts:677 src:32 globalThis[key]
vitest/dist/chunks/test.DNmyFkvJ.js
  esm.ts:449 src:3621 Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerabl…
  esm.ts:449 src:3639 Reflect.deleteProperty(globalThis, name)
  esm.ts:449 src:3640 Object.defineProperty(globalThis, name, original)
  esm.ts:449 src:4152 Object.defineProperty(globalThis, GLOBAL_EXPECT, { value: globalExpect, writable: true, configurable: true …
```

Key kinds: `SAFE_TIMERS_SYMBOL = Symbol("vitest:SAFE_TIMERS")` (timers.js:1);
`MATCHERS_OBJECT`/`JEST_MATCHERS_OBJECT`/`GLOBAL_EXPECT`/`ASYMMETRIC_MATCHERS_OBJECT
= Symbol.for(…)` (expect index.js:61-64); `GLOBAL_EXPECT` in the test chunk is
an import binding from `@vitest/expect` (test chunk :6); `name` is a method
parameter (`stubGlobal(name, value)` :3619, `forEach((original, name) =>` :3638);
`key` a for-in string (setup-common :32). Every site is a write/define/delete
(`esm.ts:449` = `isGlobalFunctionMutationCall`, `esm.ts:677` =
`walkGuardAssignmentTarget`); no runtime-key read is flagged. undici:
`globalDispatcher = Symbol.for('undici.globalDispatcher.2')` (lib/global.js:5)
→ `Object.defineProperty(globalThis, globalDispatcher, …)` :24/:43;
`globalOrigin = Symbol.for('undici.globalOrigin.1')` (fetch/global.js:5) → :13/:29.
A static Symbol proof cannot admit the parameter, for-in and imported keys.

## O1 — Node, ESM shapes (parity case `modules/global-computed-key-writes-esm`)

Node side of the case (runner `runInNode`, Node v24.16.0):

```
$ tsx node-side.mts tools/node-parity-runner/cases/modules/global-computed-key-writes-esm.case.ts
[["safeTimers",true,"safe"],["matchers",true,true,"object"],["globalExpect","globalExpect"],["defines",1,"b"],["stubbed",42,"stubbed",true],["unstubbed",false,"original"],["objectKey","rhs,key,key,rhs,key,key,key,key,desc,rhs,key",6],["toPrimitiveKey","key,string",7,false],["clean",false,false]]
```

## O2 — Node, CJS shapes (parity case `modules/global-computed-key-writes-cjs`)

```
$ tsx node-side.mts tools/node-parity-runner/cases/modules/global-computed-key-writes-cjs.case.ts
[["dispatcher",true,true],["origin","http://localhost:3000"],["originCleared",null,true],["dynamic","cjs",9,true,false],["objectKey","rhs,key,key,rhs,key,key,desc",3],["clean",false,false,false]]
```

## O3 — Node, a runtime key that is 'Function' mutates the global

```js
// globalThis.Function restored to the host constructor between steps
function stubGlobal(name, value) { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true }); }
stubGlobal('Function', Replaced);                        // defineProperty-param
for (const key in { Function: 1 }) globalThis[key] = Replaced;   // for-in-assign
Reflect.set(globalThis, { toString: () => 'Function' }, Replaced); // reflect-set-object-key
Reflect.deleteProperty(globalThis, 'Function');          // reflect-delete
```
```
$ node function-key.mjs      (v24.16.0)
[["defineProperty-param",true],["for-in-assign",true],["reflect-set-object-key",true],["reflect-delete",true,"undefined"]]
```

Conformance write sites (`tests/conformance/modules/global-computed-key-guard.test.ts`
`writeSites.esm`) run as a real Node ESM module with the test's non-Function
sequence, then `'Function'` per site:

```
$ node sites-run.mjs
[2,3,true,5,6,true,8,true,9,true,false] assign:true define:true reflectDelete:true forOf:true defineGetter:true
$ node -e "import('./defines.mjs')…"   (the test's /defines.mjs top-level for-in)
[true,"ran",1,true,"DefinedFunction"]
```

## O4 — Node, property-key coercion order and count per operation

`key = { toString() { log.push('key'); return '__p__' } }`, `rhs(v)` logs `rhs`:

```
$ node order2.mjs    (v24.16.0)
assign ["rhs","key"]
compound ["key","rhs","key"]
postfix++ ["key","key"]
prefix++ ["key","key"]
nullish-set ["key","rhs","key"]
nullish-skip ["key"]
delete ["key"]
defineProperty ["key"]
reflect-set ["rhs","key"]
reflect-delete ["key"]
reflect-define ["rhs","key"]
array-destructure ["rhs","key"]
for-of ["key"]
for-in ["key"]
```

`Object.defineProperty` coerces the key before reading the descriptor
(`order.mjs`: `…,"key:__o2__","desc:value",…`); a `Symbol.toPrimitive` key is
called once with hint `"string"`.

## O5 — disposable spike: key-position helper vs Node (not product code)

Helper under test (ADR-0444 §2): primitive ≠ `'Function'` passes through;
`'Function'` / object keys → `{ [Symbol.toPrimitive]() { const p = Reflect.ownKeys({ [key]: 0 })[0]; if (p === 'Function') throw …; return p; } }`.
Each row runs the Node form and the hand-rewritten `globalThis[__k(k)]` form;
`function-key` runs 5 sites for keys `'Function'`, `{toString}` and
`{[Symbol.toPrimitive]}` → `'Function'`:

```
$ node wrapper-sim.mjs
assign             SAME ["rhs","key"] ["rhs","key"] 1 1
compound           SAME ["key","rhs","key"] ["key","rhs","key"] 2 2
postfix++          SAME ["key","key"] ["key","key"] 2 2
nullish-set        SAME ["key","rhs","key"] ["key","rhs","key"] 1 1
delete             SAME ["key"] ["key"] undefined undefined
defineProperty     SAME ["key"] ["key"] 5 5
reflect-set        SAME ["rhs","key"] ["rhs","key"] 2 2
reflect-define     SAME ["rhs","key"] ["rhs","key"] 3 3
reflect-delete     SAME ["key"] ["key"] undefined undefined
array-destructure  SAME ["rhs","key"] ["rhs","key"] 4 4
for-of             SAME ["key"] ["key"] 6 6
function-key assign:ceiling define:ceiling reflectDelete:ceiling delete:ceiling compound:ceiling assign:ceiling define:ceiling reflectDelete:ceiling delete:ceiling compound:ceiling assign:ceiling define:ceiling reflectDelete:ceiling delete:ceiling compound:ceiling hostIntact true
symbol passthrough true 1
```

Rejected eager variant (`__k` coerces at the key position):

```
$ node eager-sim.mjs
assign       DIFF node ["rhs","key"] eager ["key","rhs"]
compound     DIFF node ["key","rhs","key"] eager ["key","rhs"]
reflect-set  DIFF node ["rhs","key"] eager ["key","rhs"]
```

## RED — at base 325ae797c (contract + tests only)

```
$ pnpm test:parity global-computed-key-writes
  ✗ modules/global-computed-key-writes-cjs.case.ts
    error: NotImplementedError: Not implemented: module-loader.cjs-global-function-assignment (CJS module /work/undici-global.js assigns the global Function binding; …)
  ✗ modules/global-computed-key-writes-esm.case.ts
    error: NotImplementedError: Not implemented: module-loader.esm-global-function-assignment (ESM module /work/utils-timers.mjs writes the Function binding/global property; …)
2 case(s) failed
```

Every setup module of both cases is rejected on its own today (instrumented
guard / real CJS loader over each file):

```
utils-timers.mjs: THROW (line 10 globalThis[SAFE_TIMERS_SYMBOL])
expect.mjs: THROW (lines 11, 12, 20 Object.defineProperty(globalThis, <Symbol.for const>, …))
test-chunk.mjs: THROW (lines 7, 17, 18 parameter `name`; line 25 imported GLOBAL_EXPECT)
setup-common.mjs: THROW (line 3 globalThis[key])
object-keys.mjs, cleanup.mjs: THROW
undici-global.js, undici-fetch-global.js, dynamic-keys.js, object-keys.js: THROW module-loader.cjs-global-function-assignment
```

```
$ npx vitest run --project conformance tests/conformance/modules/global-computed-key-guard.test.ts
 × ESM … loads a module whose global writes take runtime keys; only a runtime Function key throws
   → Not implemented: module-loader.esm-global-function-assignment (ESM module /keys.mjs writes the Function binding/global property; …)
 × ESM … a top-level runtime Function key rejects the import at the write, after earlier statements ran
   → expected undefined to be 'ran' // Object.is equality
 × CJS … loads a module whose global writes take runtime keys; only a runtime Function key throws
   → Not implemented: module-loader.cjs-global-function-assignment (CJS module /keys.js assigns the global Function binding; …)
 × CJS … a top-level runtime Function key throws at the write, after earlier statements ran
   → expected undefined to be 'ran' // Object.is equality
 Tests  4 failed | 2 passed (6)
```

The 2 passing tests are the kept load-time ceilings (runtime-key reads used as
a constructor) — regression carriers, green before and after.
