---
area: runtime-js
status: draft
title: `vm.runInThisContext` / `Script` honour `lineOffset` and `columnOffset`
created: 2026-09-15
why: vitest's module evaluator (and vite-node 3) evaluate every transformed test module with `vm.runInThisContext(wrapped, { filename, lineOffset: 0, columnOffset: -N })`; rifty throws `NotImplementedError('vm.runInThisContext.columnOffset')` for any non-zero offset, so no test file can execute
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts, packages/runtime-js/src/module-loader/source-maps.ts]
---

## Context

Node v24.16.0 re-probe corrects the initial oracle interpretation: negative
columns are not clamped; `columnOffset` affects only the first physical line.
`new Error().stack` with offsets `10/-20` reports `11:-19`; with a leading
newline reports `12:1`. Prior `/virtual/mod2.js:12:21` never established a
second-line column shift. Exact commands/output: dedicated evidence source.

`runInThisContext` evaluates in the host realm, independently of the sandbox
engine. `Script` offsets belong to construction, survive repeated runs, and
are ignored in `script.runInThisContext` run options. Returned functions and
late `.stack` reads retain their own script positions after another script
uses the same filename. Existing async-scoped `withStackRemapping` alone does
not preserve that lifetime; a filename-only table would overwrite provenance.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

- Oracle: native Node v24.16.0, both new parity cases execute identical source
  in native Node and rifty; recorded output in dedicated evidence.
- Offsets move reported host-script positions without modifying source semantics.
- Existing sandbox/compileFunction offset ceilings remain outside this item.

## Acceptance

1. `vm.runInThisContext` accepts positive/negative line and column offsets;
   columns shift only on physical line one, negative positions survive,
   thrown and returned Error stacks identify the configured filename exactly
   as native Node. → I4, I5, I6
2. `new vm.Script(source, options).runInThisContext()` retains constructor
   offsets across repeated runs; run options do not replace them. → I4, I5, I6
3. Returned functions and delayed `.stack` reads retain the generating
   script's positions when the same filename is evaluated again. → I4, I5, I6

## Parity cases

1. `vm/run-in-this-context-offsets.case.ts`: first/second lines, zero/positive/
   negative offsets, returned function, late Error stack, caught throw. → I4, I5, I6
2. `vm/script-this-context-offsets.case.ts`: same offset matrix, constructor
   options, repeated run, escaped function after filename reuse. → I4, I5, I6

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| sibling-drift × direct vs Script host evaluation | identical offset semantics | both parity matrices | → I6 |
| poisoned-cache × repeated filename with different offsets | prior Error/function retains original positions | late-stack / late-function rows | → I6 |
| provenance-lie × escaped function / caught Error | filename and signed position remain native | returned-function / thrown-error rows | → I6 |

## Out of scope

`runInContext`, `runInNewContext`, their `Script` twins and `compileFunction`
nonzero offsets retain named `NotImplementedError` ceilings. Existing
timeout, cachedData, displayErrors and importModuleDynamically ceilings remain.

## Decisions

- 2026-09-23 — preparation is Contract+RED: existing offset rejection is an explicit ceiling; tests/docs prepared, implementation waits for independent checkpoint (RDY-8).
- 2026-09-23 — boundary: owned in-process source-position projection; transport loss/duplicate/reorder physically excluded; no coordination owner introduced by preparation.
