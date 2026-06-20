---
area: runtime-js
status: parked
title: ESM `import()` miss should emit Node's `ERR_MODULE_NOT_FOUND`, not the CJS `MODULE_NOT_FOUND` shape
created: 2026-06-20
why: the module-loader resolver throws ONE `MODULE_NOT_FOUND` shape for both modes. Node uses TWO — a missing `require()` (and a missing ENTRY, run through the CJS loader even for `.mjs`) is `MODULE_NOT_FOUND` + `requireStack`; a nested ESM `import()` miss is `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<abs>' imported from <parent>` (a `url` prop, NO requireStack; a bare specifier is `Cannot find package '<name>' imported from <parent>`). rifty matches the CJS case (parity-proven) but not the ESM one.
user_story: As a developer whose ESM program does a missing `import('./x.mjs')` (or `import 'no-such-pkg'`), I want rifty's error to carry `code:'ERR_MODULE_NOT_FOUND'` + Node's `imported from`/`Cannot find package` message + `url`, so error-matching tooling behaves identically.
sources: [ADR-0155, ADR-0157]
code: [packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

`resolver.ts moduleNotFound(specifier, fromFile, esm)` (added for the entry-miss
work) branches: CJS/entry misses get Node's faithful `MODULE_NOT_FOUND` + a
`requireStack` (parity-proven, `module-not-found.case.ts`); an ESM (non-entry)
miss keeps the honest, clearly-rifty `Cannot find module '<spec>' (imported from
'<importer>')` with NO `requireStack`. The absent `requireStack` is the signal
that `node-entry.ts asNodePrintedError` must NOT reshape it into the CJS printed
form (which would masquerade a wrong shape as Node parity). So the ESM miss is
LOUD + honest today, just not Node-`ERR_MODULE_NOT_FOUND`-shaped.

Real Node v24.16.0:
- ESM relative miss → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/abs/missing.mjs' imported from /abs/app.mjs`, `{ code:'ERR_MODULE_NOT_FOUND',
  url:'file:///abs/missing.mjs' }`, no `requireStack`.
- ESM bare miss → `Cannot find package 'no-such-pkg' imported from /abs/app.mjs`,
  `code:'ERR_MODULE_NOT_FOUND'`.

## Options or Next

Give `moduleNotFound` an ESM branch that builds the `ERR_MODULE_NOT_FOUND` shape:
`code:'ERR_MODULE_NOT_FOUND'` (add to `ModuleLoadErrorCode`), the `imported from`
(relative/absolute) vs `Cannot find package` (bare) message split, a
`url:'file://<abs>'` prop, and no `requireStack`. Then in `asNodePrintedError`
emit the ESM printed form (`Error [ERR_MODULE_NOT_FOUND]: <message>` + the
`{ code, url }` tail) for that branch. Add a parity case: a missing ESM relative
import + a missing bare specifier, diffed head-to-head vs Node v24 (path-agnostic
normalization, like `module-not-found.case.ts`). Decide whether the `.bin`
launcher's missing-target import (`loader.import(target, shim)`) reports ESM- or
CJS-shaped — Node-wise the shim's `import('…')` is ESM, so `ERR_MODULE_NOT_FOUND`.

## Reversibility

REVERSIBLE — diagnostic-shape fidelity + a parity case; no public API or wire
change. The current behavior is honest + loud (compat `process.md` ⚠️ note); this
upgrades it to byte-faithful for the ESM path.
