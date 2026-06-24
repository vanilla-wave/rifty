---
area: runtime-js
status: active
title: CJS/ESM global/dynamic Function binding cannot be faithfully emulated without an isolated global realm
created: 2026-06-23
why: `Function = ...` / `globalThis.Function = ...` / statically tracked global aliases (including CJS sloppy implicit aliases) / static or dynamic `globalThis[...]` Function-like mutation or use-as-constructor access / `Reflect.get(globalThis, ...)` use-as-constructor / `delete globalThis.Function` / `Object.defineProperty(...)` / `Object.assign(globalThis, ...)` / `Reflect.set(...)` / accessor helpers / direct or aliased Function-bearing eval can mutate Node's global Function binding or escape loader-scoped import routing, but rifty modules execute in the browser host realm and route lexical Function through loader-owned proxies; allowing the mutation would corrupt the host constructor, while rewriting later reads to the routed proxy silently changes semantics.
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

Static AST rewriting cannot know which `Function` binding `eval` or `with` will
expose at runtime. A module that combines a `Function` token with `with` or an
unshadowed/global/computed `eval` reference/call throws
`NotImplementedError('module-loader.cjs-dynamic-function-scope')` in CJS and
`NotImplementedError('module-loader.esm-dynamic-function-scope')` in ESM.

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
