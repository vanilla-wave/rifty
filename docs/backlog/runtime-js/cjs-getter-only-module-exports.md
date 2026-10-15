---
area: runtime-js
status: draft
title: CJS getter-only module.exports fails after successful package evaluation
created: 2026-10-13
why: The loader writes its module record exports slot after evaluation even when the real package has made module.exports getter-only
user_story: As a developer importing wrap-ansi 7 or ansi-styles 4, I want the npm package to run, but today CJS loading throws before returning its exports
sources: [docs/backlog/runtime-js/reference/cjs-getter-only-module-exports-probe.ts, docs/adr/npm-client/0526-separate-npm-alias-placement-from-registry-identity.md, docs/public/compat/package-tooling.md]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Observed during PR 341 alias verification; npm aliases install correctly,
then `wrap-ansi-cjs` imports original `ansi-styles@4.3.0`.
Its archive ends with `Object.defineProperty(module, 'exports',
{enumerable: true, get: assembleStyles})`. Node loads it; rifty's
`executeCjs` writes `record.exports = moduleObject.exports` after evaluation.
Both names refer to one module object; getter-only exports throws
`TypeError: Cannot set property exports of #<Object> which has only a getter`.

Reproducer without an alias or installer:
`node --import tsx docs/backlog/runtime-js/reference/cjs-getter-only-module-exports-probe.ts`.
Original integrity-verified npm archive is the input; MemoryFsSync and the
real public module loader execute it. Runtime loader sources unchanged from
PR 341 baseline. Node v24.16.0/npm 11.17.0 native install/load succeeds in the
localhost oracle; failure reproducible in this session.

Fault: owned in-process projection, corrupt-input/observable-order; transport
loss/duplication/reorder excluded by synchronous local property access.
No matching backlog getter-only exports item found in runtime-js titles,
code and ADR inventory. Owner runtime-js; trigger wrap-ansi execution or CJS
module-object parity. Package setup required by this rework does not execute
wrap-ansi, so this runtime defect stays outside its delivered install repair.
