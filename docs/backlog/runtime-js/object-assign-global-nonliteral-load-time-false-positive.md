---
area: runtime-js
status: draft
title: "A non-literal `Object.assign(globalThis, src)` in a branch that never runs rejects the module at load, so `node-fetch@3.3.2` cannot load"
created: 2026-09-25
why: the load-time Function-mutation ceiling rejects any non-literal `Object.assign(globalThis, …)` source even when the call sits in a branch dead in every browser realm; `fetch-blob@3.2.0` `streams.cjs` has one, so `node-fetch@3.3.2` throws `module-loader.cjs-global-function-assignment` where Node loads it
user_story: As a developer running a program that imports `node-fetch@3`, I want it to load as in Node, but today rifty throws `module-loader.cjs-global-function-assignment` at load for a polyfill branch that never runs
sources: [docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md, docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, ADR-0444, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md`
(IMPLEMENT, 2026-09-23); first filed as a note in
`runtime-js/function-constructor-exhaustive-metaprogramming-ceiling`, which
owns the non-literal `Object.assign` ceiling
(symbol-key-global-write-guard-precision contract §Out of scope, at `57f6117de`).

`fetch-blob@3.2.0/streams.cjs`:

```js
if (!globalThis.ReadableStream) {
  …
  Object.assign(globalThis, require('node:stream/web'))
  …
}
```

`cjs.ts` (`esm.ts` same shape): `Object.assign` with a global first
argument rejects when any source `objectMayContainFunctionKey` — a
non-literal source always may. The branch is dead in every browser realm
(and in Node v24, which has `ReadableStream`).

Probe 2026-09-25 @ `2a6c131d6`, `createModuleLoader(MemoryFsSync).require`
of the installed `streams.cjs` (`pnpm exec tsx`) vs `node -e require(…)`:

```
rifty:          THROW NotImplementedError module-loader.cjs-global-function-assignment
node v24.16.0:  loads
```

Chain: `node-fetch@3.3.2` `src/index.js` → `fetch-blob/from.js` →
`index.js` (`import './streams.cjs'`) → `streams.cjs`.

## Next

Owner runtime-js (module-loader). Trigger: a claimed program importing
`node-fetch@3`/`fetch-blob@3`, or the next load-time guard unit. Parity
first: `node-fetch@3.3.2` import (and `streams.cjs` require) loads in
Node and rifty; `Object.assign(globalThis, src)` with a non-literal `src`
carrying a `Function` key still throws the named ceiling (at the call, not
at load). Candidate: per-key runtime check of `Object.assign` sources
(ADR-0444's shape).
