---
area: runtime-js
status: draft
title: `vm.runInThisContext` / `Script` honour `lineOffset` and `columnOffset`
created: 2026-09-15
why: vitest's module evaluator (and vite-node 3) evaluate every transformed test module with `vm.runInThisContext(wrapped, { filename, lineOffset: 0, columnOffset: -N })`; rifty throws `NotImplementedError('vm.runInThisContext.columnOffset')` for any non-zero offset, so no test file can execute
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts, packages/runtime-js/src/module-loader/source-maps.ts]
---

## Context

Oracle (Node v24.16.0, evidence §Oracle): `lineOffset` shifts every frame line;
`columnOffset` shifts only the first physical source line and may yield a
negative reported column. Execution semantics are unchanged. `runInThisContext`
is host-realm (not an engine op); rifty already remaps stacks
(`source-maps.ts` `withStackRemapping`). Carrier (remap table vs source
prefix) is agent-owned fog on the map; the parity case compares
`new Error().stack` line/column from a script run with offsets against real
Node 24.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

Node v24.16.0 and RED command/output: `docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md`. Offsets change observed stack coordinates, not evaluated source values. The returned functions in the oracle make the offset observable after evaluation has completed.

## Acceptance

1. `runInThisContext` and `new Script(...).runInThisContext()` accept `lineOffset` and `columnOffset`. Delayed Error stacks shift all lines by `lineOffset`, only the first physical line by `columnOffset`, including negative reported columns. → I4, I5
2. Source values remain unchanged, including a multiline template literal. → I4

## Parity cases

1. `tools/node-parity-runner/cases/vm/script-offsets.case.ts` executes the same source against Node and rifty; reports both delayed frames and the literal. → I4, I5

## Out of scope

Offsets in `runInContext` / `runInNewContext` stay named-loud until their engine-specific stack mapping is implemented. Other script options retain their current loud ceilings.
