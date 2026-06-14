# QuickJS-WASM release-sync API — VERIFIED

Source of truth for the membrane. Empirically verified against installed
`@jitl/quickjs-wasmfile-release-sync@0.32.0` + `quickjs-emscripten-core@0.32.0`
(library bellard/quickjs 2025-09-13, vendored 2026-02-15) on Node v24.16.0 via
throwaway spike `scripts/quickjs-api-spike.mjs` (deleted; findings live here).
Types: `node_modules/.pnpm/quickjs-emscripten-core@0.32.0/.../dist/index.d.ts`.

## Module construction (ONE async preload, then all sync)
```js
import variant from '@jitl/quickjs-wasmfile-release-sync';        // DEFAULT export = QuickJSSyncVariant
import { newQuickJSWASMModuleFromVariant, Scope } from 'quickjs-emscripten-core';

const QuickJS = await newQuickJSWASMModuleFromVariant(variant);   // Promise<QuickJSWASMModule> — only await
const ctx = QuickJS.newContext();                                 // QuickJSContext — SYNC; also QuickJS.newRuntime().newContext()
```
- `newQuickJSWASMModuleFromVariant(variantOrPromise)` is the WORKING ctor (NOT `newQuickJSWASMModule`, which needs a pre-built sync variant arg).
- Variant is passed DIRECTLY (the default export). Do not call it.
- `QuickJS.newContext(opts?)` makes a runtime+context pair; disposing the context disposes the runtime. For per-call resource limits use `newRuntime(opts).newContext()`.
- `.wasm` resolved automatically from node_modules in Node; browser wasm-URL = LATER task.

## Eval
- `ctx.evalCode(code, filename?, options?) : QuickJSContextResult<QuickJSHandle>` — SYNC. options: `number | ContextEvalOptions` (`{ type?: "global"|"module" }`; unset = heuristic import/export detection).
- Result is a `SuccessOrFail`: success `{ value: handle }`, fail `{ error: handle }`. Use `ctx.unwrapResult(result)` → returns value handle OR throws (converting guest error to native).
- `ctx.callMethod(thisH, key, args?)` = getProp+callFunction convenience.

## Direct-eval stays in guest (FALSIFIES ADR-0138 premise)
`ctx.evalCode('eval("leaked=1")')` does NOT touch host `globalThis`. Verified: `typeof globalThis.leaked === 'undefined'` stays true. The guest realm is real & isolated; no host-leak via `eval`.

## Handle constants (getters, NOT methods; do NOT dispose them)
`ctx.undefined`, `ctx.null`, `ctx.true`, `ctx.false`, `ctx.global`. (Long-lived, context-owned.)

## Handle creators (host → guest values)
- `ctx.newNumber(n)`, `ctx.newString(s)`, `ctx.newBigInt(bi)`
- `ctx.newObject(prototype?)`, `ctx.newArray()`, `ctx.newArrayBuffer(ab)`
- `ctx.newUniqueSymbol(desc)`, `ctx.newSymbolFor(key)`, `ctx.getWellKnownSymbol(name)` (e.g. "iterator")
- `ctx.newFunction(name|undefined, (…argHandles) => returnHandle|void) : QuickJSHandle`
  - also `newFunction(fn)` (no name), `newConstructorFunction(...)`, `newFunctionWithOptions({name,length,isConstructor,fn})`
  - arg handles are auto-disposed when the host fn returns; to retain → `argH.dup()`. Return value must NOT be retained by the impl.
- `ctx.newError(msg) | newError({name,message}) | newError()`
- `ctx.newPromise()` → `QuickJSDeferredPromise` (`.handle`, `.resolve(h)`, `.reject(h)`, `.dispose()`)
- Host-object opaque ref: `ctx.newHostRef(obj)`, `ctx.toHostRef(h)`, `ctx.unwrapHostRef(h)` — guest can't read it.
- **NO `ctx.callConstructor`** (verified — not in the d.ts). To `new X(...)` in the guest, eval a factory once and `callFunction` it: `const f = ctx.evalCode('(t)=>new Date(t)')`; `callFunction(f, undefined, tH)`. Used by T10 exotic IN (`#exoticFactory`).

## Exotics (T10) — detect / construct / read (VERIFIED)
- **Detect** (cross-realm-reliable): `Object.prototype.toString.call(o)` via a guest helper → `"[object Date]"`/`"[object RegExp]"`/`"[object Uint8Array]"` etc. (`dump`/`typeof` are NOT reliable for exotics).
- **Date**: read `Date.prototype.getTime.call(h)`; construct `(t)=>new Date(t)`.
- **RegExp**: read `getProp(h,'source')`/`'flags'` (strings); construct `(s,f)=>new RegExp(s,f)`.
- **TypedArray**: kind via `o.constructor.name`; read `getProp(h,'length')` + indexed `getProp(h,i)` (`getNumber`, or `getBigInt` for Big(U)Int64); construct `(len)=>new <Kind>(len)` then `setProp(ta,i,elemH)`. NOTE: TypedArray methods + `Symbol.toStringTag`/`Symbol.iterator` (driving brand + `Array.from`) live on `%TypedArray%.prototype` (the PARENT of `<Kind>.prototype`), NOT on the per-kind prototype — flatten the whole chain.
- **Cross-realm mirror technique** (matches Node): a REAL exotic backing carries the internal slot (brand + methods); set its [[Prototype]] to a null-based FLAT proto carrying the prototype-CHAIN methods (NOT the intrinsic prototype) → `instanceof <ctor>` FALSE while methods/brand resolve. A NULL proto would strip the methods — only the generic-object seed uses null.

## Symbols (T10) — VERIFIED cross-realm rules
- `ctx.getSymbol(h)` → a host symbol with the right `.description`, but for WELL-KNOWN it is NOT the host's (`getSymbol(guest Symbol.iterator) !== host Symbol.iterator`) and for two reads of the same UNIQUE symbol it returns DIFFERENT host symbols (so identity-cache uniques by the registry id). For REGISTRY symbols it DOES return `host Symbol.for(k)` (`===`).
- **Well-known detection**: compare via `ctx.eq(h, ctx.getWellKnownSymbol(name))` over the 13 ES names (all supported, all `eq` the guest's). Map → `Symbol[name]` (shared, `===` host) on OUT; `ctx.getWellKnownSymbol(name)` on IN.
- **Registry detection**: `Symbol.keyFor` returns a string for registry symbols, `undefined` for unique AND well-known. OUT → `Symbol.for(key)`; IN → `ctx.newSymbolFor(key)`.
- **Unique**: OUT mint `Symbol(desc)` (identity-cached by guest id); IN `ctx.newUniqueSymbol(desc)`.
- Symbol-keyed own props: `getOwnPropertyNames(h, {symbols:true})` → key handles; `getProp(h, symKeyHandle)` reads the value.

## Value extraction (guest → host)
- `ctx.typeof(h) : string` — NOTE: non-standard, mishandles BigInt. Returns "object"/"function"/"symbol"/"string"/"number"/"undefined" etc.
- `ctx.getNumber(h)` (NaN on err), `ctx.getString(h)`, `ctx.getBigInt(h)`, `ctx.getSymbol(h)`, `ctx.getArrayBuffer(h) : Lifetime<Uint8Array>`
- `ctx.dump(h) : any` — best-effort JS value. Verified: dump(function) → returns the SOURCE STRING `"function named(){}"` (does NOT throw); dump(Proxy) → returns the TARGET shape `{a:1}` (does NOT throw). So dump is unreliable for fn/proxy fidelity — membrane must branch on `typeof` and mirror, not dump, callables/exotics.
- `ctx.getLength(h) : number | undefined`

## Property ops — keys are `QuickJSPropertyKey = number | string | QuickJSHandle`
- `ctx.getProp(h, key) : QuickJSHandle` — returns a NEW handle you must dispose.
- `ctx.setProp(h, key, valueH) : void` — does NOT consume valueH (dispose it yourself after).
- `ctx.defineProp(h, key, descriptor) : void` — descriptor `VmPropertyDescriptor`: `{ value?: handle, configurable?, enumerable?, get?: (this)=>handle, set?: (this,v)=>void }`. Does NOT consume `value` handle (dispose after). NOTE: descriptor `get`/`set` are HOST callbacks; no `writable` field — writable is implied by absence of get/set + mutation. There is NO `ctx.getOwnPropertyDescriptor`; reconstruct descriptors via getOwnPropertyNames + getProp (and enumerable flag via `onlyEnumerable`).
- `ctx.getOwnPropertyNames(h, options?) : QuickJSContextResult<DisposableArray<QuickJSHandle>>` — `.unwrap()` → disposable array of key handles (array `.dispose()` frees all elements). options `GetOwnPropertyNamesOptions`: `{ strings?, symbols?, numbers? (as numbers, non-std), numbersAsStrings? (std), onlyEnumerable?, quickjsPrivate? }`. DEFAULT (no opts) ≈ `{strings:true, numbersAsStrings:true}` → standard string keys only (symbols EXCLUDED). Verified: default on `{a,b,[Symbol.iterator]:0}` → 2 (`['a','b']`); with `{strings,symbols,numbersAsStrings}` → 3. Throws `QuickJSEmptyGetOwnPropertyNames` if an explicit opts object sets nothing.
- `ctx.getIterator(h) : QuickJSContextResult<QuickJSIterator>` — host-side proxy of guest `[Symbol.iterator]()`.
- `ctx.getPromiseState(h)`, `ctx.resolvePromise(h) : Promise<...>` (needs `runtime.executePendingJobs()`).

## Calling guest functions from host
`ctx.callFunction(funcH, thisH, ...argHandles)` OR `ctx.callFunction(funcH, thisH, argHandlesArray)` — BOTH overloads verified working. Returns `QuickJSContextResult` → `ctx.unwrapResult(res)` for the return handle. `thisH` commonly `ctx.undefined`. Arg handles are NOT consumed (dispose yourself).

## OBJECT IDENTITY / EQUALITY — membrane identity-cache key decision
**USE `ctx.eq(h1, h2)` (strict `===`).** Two independent handles to the SAME guest object compare EQUAL via `ctx.eq` AND `ctx.sameValue`. JS `h1 === h2` on the wrapper objects is FALSE (different Lifetime wrappers) — do NOT use it. Verified:
- `ctx.eq(handleToShared, otherHandleToSameShared)` → `true`
- `ctx.sameValue(sameObj)` → `true`
- `h1 === h2` (wrapper ===) → `false`
- `ctx.eq(differentObj)` → `false`

Implication: handles are NOT stable identity tokens; the membrane CANNOT key a WeakMap/Map on the handle object. Options: (a) linear `ctx.eq` scan against cached guest handles (O(n), simple, correct), or (b) tag guest objects with a hidden non-enumerable id property (e.g. via `defineProp` a symbol key) for O(1) lookup. `ctx.eq` is the verified primitive; pick (a) for correctness-first, (b) if profiling demands.
Also available: `ctx.sameValue` (Object.is), `ctx.sameValueZero`.

## Lifetime / disposal — CRITICAL DISCIPLINE
- Every handle from `evalCode`/`getProp`/`new*`/`callFunction`/`unwrapResult` is a `Lifetime` (`QuickJSHandle`). Caller OWNS and MUST `handle.dispose()`.
- `handle.dup()` → owned copy; `handle.consume(fn)` → run fn then auto-dispose; `handle.alive` boolean.
- Constants (`ctx.undefined`/`null`/`true`/`false`/`global`) are context-owned — do NOT dispose.
- `ctx.dispose()` frees context+runtime. **HARD ASSERT: if ANY guest handle is still alive, `ctx.dispose()` ABORTS the whole WASM runtime** (`Assertion failed: list_empty(&rt->gc_obj_list)` → unrecoverable `WebAssembly.RuntimeError`). Verified by the spike: a single leaked handle crashed teardown. No leniency. The membrane MUST track and dispose every handle it creates before context teardown (T18 disposal-stress will guard this).
- `Scope` helper: `Scope.withScope(scope => { const h = scope.manage(ctx.newX()); … })` — `scope.manage(lifetime)` registers for auto-dispose at block end; returns the lifetime. `Scope.withScopeAsync` for async (do NOT use sync `withScope` with async). Verified working.
- `DisposableArray<T>` (from getOwnPropertyNames) is `T[] & Disposable`; `.dispose()` disposes all alive elements.
- `ctx.unwrapResult` does NOT auto-dispose the success handle — you own the returned handle. On fail it disposes the error handle while throwing.

## Key TS exports (from quickjs-emscripten-core)
`QuickJSWASMModule`, `QuickJSContext`, `QuickJSRuntime`, `QuickJSHandle` (type), `QuickJSPropertyKey` (type), `VmCallResult`/`VmPropertyDescriptor`/`VmFunctionImplementation` (types), `Lifetime`, `Scope`, `DisposableArray` (type), `newQuickJSWASMModuleFromVariant`, `DefaultIntrinsics`, `shouldInterruptAfterDeadline`, `errors`.

## Deviations from Task-1 draft
- Draft used `ctx.callFunction(fn, this, ...args)` returning a result then `unwrapResult` — CONFIRMED; array form also works.
- Draft accessed `ev.error` directly — CONFIRMED (fail result exposes `.error` handle); must `.dispose()` it.
- Draft did not dispose handles → would crash teardown. Real API: aggressive per-handle disposal mandatory (see above).
- Identity: `ctx.eq` is the answer (draft left it open).
