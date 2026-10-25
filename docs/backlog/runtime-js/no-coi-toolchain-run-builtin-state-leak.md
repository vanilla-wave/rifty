---
area: runtime-js
status: draft
title: In the held no-COI toolchain Worker, a builtin-module mutation made by one `node` run is visible to the next run
created: 2026-10-16
why: separate `node` processes share no module state in Node; in the no-COI toolchain a `require('child_process').spawn` wrapper and a `ChildProcess.prototype` patch installed by run N still fire in run N+1, so one program's monkeypatches leak into every later program
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, ADR-0375]
code: [packages/runtime-js/src/builtins/child_process.ts]
---

## Context

Mid-task discovery (2026-10-16, esbuild upstream-twin spike, no-COI arm;
`playwright.no-coi.config.ts`, SDK `createSandbox({requireCrossOriginIsolation:false})`,
consecutive `project.run` calls in one held toolchain Worker, HEAD `9645c62bf`).

Run N: `node -e "require('./pre1.cjs');…"` — `pre1.cjs` wraps
`require('child_process').spawn` (logs `[f1] spawned …`) and assigns no-op
`ref/unref` onto `Object.getPrototypeOf(child)`.
Run N+1: `node -e "require('./pre2n.cjs');…"` (never loads `pre1.cjs`) prints:

```
[f1] spawned "node" ["/esbw/esbchild2n.cjs","--service=0.28.0","--ping"] pid 4
[pre2] spawned "node" ["/esbw/esbchild2n.cjs","--service=0.28.0","--ping"] pid 4
[f1] child exit 1 null
[pre2] child exit 1 null
```

The `[f1]` lines come from run N's wrapper: `pre2n.cjs` captures
`orig = cp.spawn` (still run N's wrapper) and skips its own prototype stub
because `ref` already exists. In Node each `node` invocation is a fresh
process: run N+1 prints only `[pre2]` lines. COI terminal runs were not
checked for the same leak.

Owner: no-COI toolchain run isolation (ADR-0375 one Worker / one runtime).
Route: observed defect → `rifty-fix` (baseline: the two-run repro above;
RED: a no-COI two-run test where run 2 observes no run-1 mutation of a
builtin export or a builtin class prototype). Unknown: which builtin objects
are shared across runs (module cache vs builtin singletons vs prototypes) —
the fix's root-cause step settles it.
