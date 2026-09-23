---
area: runtime-js
status: draft
title: process lifecycle parity — uncaught/unhandled handlers, the `exit` event, `exit()` honours `exitCode`
created: 2026-09-15
why: a Node program that installs `process.on('uncaughtException'|'unhandledRejection')` still dies (handler never called), `process.once('exit')` never fires, and `process.exit()` without an argument returns 0 instead of `process.exitCode`; vitest's worker error collection (init.js:115), CLI rejection handling (cli-api:2081), exit hook (cli-api:2063) and exit status (`process.exitCode = …; process.exit()`, cac.js:2348, cli-api:2059/2079) are built on all three
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/late-unhandled-rejection-drain.md, docs/backlog/runtime-js/invocation-scoped-unhandled-rejection.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/workbench/src/workers/node-program-lifecycle.ts]
---

## Context

Observed (program launch, main 51440931a): handler-registered timer throw →
`Uncaught Error: boom`, exit 1, later timer never runs; `Promise.reject` with
an `unhandledRejection` handler → `Error: rej`, exit 1; `process.on('exit')`
never printed on natural exit; `exitCode=3; process.exit()` → 0
(`process.ts:750` `exit(code = 0)`). Today `uncaughtException` is emitted
only for `nextTick` callback throws (`process.ts:122`); the drain trap
(ADR-0152) reports rejections to stderr without consulting handlers. Oracle (Node v24.16.0, evidence §Oracle, same scripts; the exit-event script adds a `beforeExit` handler): `caught boom` then
`after`, exit 0; `caughtR rej` then `after`, exit 0; `BEFORE-EXIT` then
`EXIT 0`; `exitCode=3; process.exit()` → exit 3. `beforeExit` is also false on
main but not on vitest's path — a note here, not an obligation (goal map §Out
of scope). Carrier and whether this is an ADR-0152 correction or a short ADR
citing it are decided at pickup (`DEC-2`).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
