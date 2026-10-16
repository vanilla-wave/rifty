---
area: runtime-js
status: draft
title: Can a no-COI `child_process` child run a script that loads `node_modules` (e.g. `node node_modules/esbuild-wasm/bin/esbuild`)?
created: 2026-10-16
why: without cross-origin isolation `spawn('node', …)` falls back to same-realm execution, which refuses non-builtin requires and breaks on a shebang; every npm CLI that spawns a Node helper fails there, and it is the kill condition for the generated esbuild client retained in no-COI
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, ADR-0375, docs/backlog/runtime-js/same-realm-child-process-object-shape.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Question

No-COI evidence (2026-10-16, evidence §No-COI arm):
`require('esbuild-wasm').transform(...)` →
`[rifty:child_process] Falling back to same-realm execution: child shares the parent event loop.`
then `SyntaxError: Invalid or unexpected token` (shebang through `new Function`,
`child_process-exec.ts:454`); shebang-free wrapper →
`NotImplementedError: Not implemented: child_process.same-realm.require (same-realm child cannot require non-builtin node_modules/esbuild-wasm/bin/esbuild)`
(`:506`). `worker_threads.Worker` in no-COI:
`Not implemented: worker_threads.Worker (no-COI toolchain Workers require a separate event loop; …)`.
The worker route requires SAB (`child_process.ts:353-358`).

Is a separate-realm child (own module loader, own globals, async stdio) with
the project's files reachable without SharedArrayBuffer — sync `require`/
`readFileSync` against a VFS owned by another Worker — and at what cost, or
is a no-COI child that loads `node_modules` a permanent tier limit? A design
spike decides the feasibility. Feasible → an item that retires the no-COI
esbuild client (goal `esbuild-upstream-twin` I4 kill condition). Infeasible →
back to the user: they chose the old client in no-COI as TEMPORARY
(2026-10-16), so keeping it permanently versus refusing esbuild in no-COI is
their call, not an agent ADR.

Related, not duplicate: `runtime-js/same-realm-child-process-object-shape`
(the same-realm child's `process` shape).
