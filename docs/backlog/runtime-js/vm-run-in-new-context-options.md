---
area: runtime-js
status: draft
title: "`vm.runInNewContext` / `Script#runInNewContext` validate and apply Node's context options before creating the context"
created: 2026-09-25
why: Node validates `contextName`/`contextOrigin`/`contextCodeGeneration` before it creates the context and applies them; rifty's new-context entry points call `createContext(contextObject)` with none of them, so invalid values run, `contextCodeGeneration: { strings: false }` is silently not enforced, and with `DONT_CONTEXTIFY` the ceiling replaces Node's `ERR_INVALID_ARG_TYPE`
sources: [docs/adr/runtime-js/0464-named-loud-members-for-charted-unclaimed-mode-ceilings.md, docs/adr/runtime-js/0142-node-vm-dual-engine-quickjs-real-realm-default-hardened-rewrite-loud-opt-in.md, docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

DEC-2 decision review of ADR-0464 (2026-09-25): its "after Node's argument
validation" is false for the new-context entry points (goal
`vitest-run-in-browser` ledger, re-chart after `vitest-run-acceptance`: the
`runInNewContext` ceiling-before-validation NOTE).

Node v24.16.0 (`node -e`, probes 2026-09-25):

```text
runInNewContext('1', DONT_CONTEXTIFY, {contextName: 1})  → ERR_INVALID_ARG_TYPE "options.contextName" … Received type number (1)
runInNewContext('1', DONT_CONTEXTIFY, {filename: 1})     → ERR_INVALID_ARG_TYPE "options.filename" …
runInNewContext('1', DONT_CONTEXTIFY, {lineOffset: 'x'}) → ERR_INVALID_ARG_TYPE "options.lineOffset" …
new Script('1').runInNewContext(DONT_CONTEXTIFY, {contextName: 1}) → ERR_INVALID_ARG_TYPE
runInNewContext('1', {}, {contextName: 1} | {contextOrigin: 1} | {contextCodeGeneration: 1}) → ERR_INVALID_ARG_TYPE
runInNewContext('eval("1")', {}, {contextCodeGeneration: {strings: false}}) → EvalError Code generation from strings disallowed for this context
createContext(DONT_CONTEXTIFY, {name: 1})                → ERR_INVALID_ARG_TYPE "options.name" …
```

Rifty (scratch `tsx` probe of `builtins/vm/index.ts` in the Node host @
`5616d5a64`, QuickJS engine preloaded):

```text
DONT_CONTEXTIFY + {contextName: 1} | {filename: 1} | {lineOffset: 'x'} → NotImplementedError vm.createContext.DONT_CONTEXTIFY
Script#runInNewContext(DONT_CONTEXTIFY, {contextName: 1})              → NotImplementedError vm.createContext.DONT_CONTEXTIFY
{} + {contextName: 1} | {contextOrigin: 1} | {contextCodeGeneration: 1} → returns 1
'eval("1")' + {contextCodeGeneration: {strings: false}}                → returns 1 (silent lie)
createContext(DONT_CONTEXTIFY, {name: 1})                              → ERR_INVALID_ARG_TYPE (as Node)
```

Mechanism: `runInNewContext` (`vm/index.ts:433-442`) and
`Script#runInNewContext` (`:494-502`) call `createContext(contextObject)`
without Node's `getContextOptions(options)`. Node validates those before the
context exists, then `filename`/offsets in `createScript` after it — its
`DONT_CONTEXTIFY` context succeeds, so their errors surface; rifty's ceiling
fires first. `filename` type validation itself is
`runtime-js/vm-options-filename-validation`.

## Next

Owner runtime-js (vm, ADR-0142). Parity first: the rows above as a `vm` case
(both engines' `contextCodeGeneration` enforcement through
`runInNewContext`); RED on the ordering rows with `DONT_CONTEXTIFY`
(ADR-0464 §3's ceiling after Node's validation).
