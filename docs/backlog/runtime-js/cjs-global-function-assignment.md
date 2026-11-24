---
area: runtime-js
status: draft
title: CJS/ESM global/dynamic Function binding cannot be faithfully emulated without an isolated global realm
created: 2026-06-23
why: `Function = ...` / `globalThis.Function = ...` / statically tracked global aliases (including CJS sloppy implicit aliases) / static or dynamic `globalThis[...]` Function-like mutation or use-as-constructor access / `Reflect.get(globalThis, ...)` use-as-constructor / `delete globalThis.Function` / `Object.defineProperty(...)` / `Object.assign(globalThis, ...)` / `Reflect.set(...)` / accessor helpers / literal direct or aliased Function-bearing eval can mutate Node's global Function binding or escape loader-scoped import routing, but rifty modules execute in the browser host realm and route lexical Function through loader-owned proxies; allowing the mutation would corrupt the host constructor, while rewriting later reads to the routed proxy silently changes semantics.
user_story: As a package author whose CJS or ESM module intentionally replaces or dynamically shadows the global `Function` constructor and then relies on that replacement, I want rifty to match Node's global/dynamic binding semantics. Today rifty throws a directed `NotImplementedError` before execution rather than corrupting the host global or lying with mixed semantics.
sources: [ADR-0171, package-tooling hardening 2026-06-23]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts]
---

## Context

ADR-0171 routes runtime-built `Function(... 'import(...)')` by rewriting/freezing
loader-scoped `Function` access. A valid CJS or ESM module can also assign the
global binding:

```js
Function = function LocalFunction() {};
exports.name = Function.name;
```

Node mutates the process global and later unqualified reads observe
`LocalFunction`. In rifty, executing that assignment in the browser host realm
would mutate `globalThis.Function` for the whole runtime. Rewriting only the read
would be a silent divergence. Current behavior is therefore a directed ceiling:
parse-time detection of unqualified global `Function` writes throws
`NotImplementedError('module-loader.cjs-global-function-assignment')` in CJS and
`NotImplementedError('module-loader.esm-global-function-assignment')` in ESM.

The same applies to dynamic scope features:

```js
with ({ Function: () => 'local' }) exports.value = Function();
eval("var Function = () => 'local'");
exports.value = Function();
```

Static AST rewriting cannot know which `Function` binding `with` will expose at
runtime, and literal `eval(...)` text can visibly mutate or synthesize
`Function`/`import` use. A module that combines a `Function` token with `with`,
or calls unshadowed/global/computed `eval` with literal Function/import-bearing
text, throws `NotImplementedError('module-loader.cjs-dynamic-function-scope')`
in CJS and `NotImplementedError('module-loader.esm-dynamic-function-scope')` in
ESM. Opaque dynamically composed eval text is tracked under the exhaustive
metaprogramming backlog rather than rejected merely because the module also
contains an unrelated lexical `Function` use.

### Consumer: construction through a runtime global key (2026-11-24)

Measured while delivering `distribution/isolate-host-ceiling-modules-load` (isolate sandbox,
same CJS file under Node v24.16.0): `var k = ['Uint8Array']; try { new global[k[0]](new
ArrayBuffer(0)) } catch (e) {} console.log('a ok')` — Node prints `a ok`; rifty refuses the module
at load with `module-loader.cjs-global-function-assignment`, though no write happens and the key
is not `Function` (also `new globalThis[k[0]](1)`; `typeof global[k]` loads). The loader already
checks a runtime key for writes (`createGlobalWriteKeyCheck`, `cjs.ts`). Real path: exceljs 4.4.0's
main entry → `unzipper/lib/parse.js:4` → binary → chainsaw → traverse → `typedarray.prototype.slice`
→ `es-abstract@1.24.2/2025/GetValueFromBuffer.js:13` → `2025/IsDetachedBuffer.js:22`
(`new global[availableTypedArrays[0]](arrayBuffer)`); `typed-array-length@1.0.8/index.js:41` and
`typed-array-byte-offset@1.0.5/index.js:40` on the same path. `typed-array-byte-length@1.0.3/index.js:44` holds the same construct, off the measured path (Node's trace of `require('exceljs')` does not load it). The first stop of `require('exceljs')`
after `node:zlib` on every host sharing the loader (isolate measured).

## Options / Next

Parity-first when a real consumer needs this. Plausible fixes need an isolated
per-module/global realm or a full CJS global-binding membrane so assignment,
dynamic scope, and subsequent reads are consistent without changing the browser
host constructor. Do not fake this with one-off local variables unless
cross-module global mutation semantics are explicitly decided.

## Reversibility

REVERSIBLE — current state is an explicit loud ceiling plus compat note. A later
realm/membrane implementation can replace the throws after Node parity cases
capture intra-module and cross-module global `Function` mutation behavior.
