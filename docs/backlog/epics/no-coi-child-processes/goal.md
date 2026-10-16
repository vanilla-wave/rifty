---
kind: epic
status: draft
title: No-COI child processes run scripts that load node_modules
created: 2026-10-16
value: A developer on a no-COI host (ADR-0375) runs npm CLIs that spawn a Node helper — first upstream esbuild-wasm's `spawn('node', bin/esbuild)` — as on Node, so the generated 0.28.0 esbuild client retained there (`esbuild-upstream-twin` I4) can be deleted.
user_story: As a developer on a no-COI SDK host, I want `require('esbuild-wasm').transform(...)` (and any CLI spawning `node <node_modules script>`) to work as on Node, but today the child falls back to same-realm execution and fails with `child_process.same-realm.require`
---

## Outcome

Draft seed — the user chose the old esbuild client in no-COI as TEMPORARY
with «kill = child-процессы в no-COI (отдельная цель)» (2026-10-16,
`epics/esbuild-upstream-twin` §Decisions). FIT has not run: feasibility is
open (below). A no-COI `spawn('node', script)` child gets its own realm,
module loader and globals and can `require` the project's `node_modules`,
with async stdio pipes, so upstream esbuild-wasm's Node entry runs there and
the retained generated client dies.

## User scenario

On a no-COI SDK host (`createSandbox({requireCrossOriginIsolation:false})`):
`node -e "require('esbuild-wasm').transform('let x: number = 1',{loader:'ts'}).then(r=>console.log(r.code))"`
prints `let x = 1;` as Node 24 does (today: `[rifty:child_process] Falling
back to same-realm execution…` then `SyntaxError: Invalid or unexpected token`
(shebang through `new Function`, `child_process-exec.ts:454`); shebang-free →
`NotImplementedError: Not implemented: child_process.same-realm.require
(same-realm child cannot require non-builtin node_modules/esbuild-wasm/bin/esbuild)`
(`:506`); evidence `docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md`
§No-COI arm).

## Question

Is a separate-realm child (own module loader, own globals, async stdio)
with the project's files reachable without SharedArrayBuffer — sync
`require`/`readFileSync` against a VFS owned by another Worker — and at what
cost? The worker route requires SAB (`child_process.ts:353-358`); no-COI
`worker_threads.Worker` is refused (`worker_threads.ts:129`). A design spike
decides feasibility at FIT. Infeasible → back to the user: keeping the
generated esbuild client in no-COI permanently versus refusing esbuild there
is their call, not an agent ADR.

Related: `runtime-js/same-realm-child-process-object-shape`,
`runtime-js/no-coi-toolchain-run-builtin-state-leak`.
