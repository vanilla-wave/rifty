---
area: runtime-js
status: ready
title: process lifecycle parity — uncaught/unhandled handlers, the `exit` event, `exit()` honours `exitCode`
created: 2026-09-15
why: a Node program that installs `process.on('uncaughtException'|'unhandledRejection')` still dies (handler never called), `process.once('exit')` never fires, and `process.exit()` without an argument returns 0 instead of `process.exitCode`; vitest's worker error collection (init.js:115), CLI rejection handling (cli-api:2081), exit hook (cli-api:2063) and exit status (`process.exitCode = …; process.exit()`, cac.js:2348, cli-api:2059/2079) are built on all three
user_story: As a real CLI running in the browser shell, I want the process lifecycle event surface to behave like on my machine, but today my error handlers never run, my exit hook never fires, and my exit status silently becomes 0
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/late-unhandled-rejection-drain.md, docs/backlog/runtime-js/invocation-scoped-unhandled-rejection.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/workbench/src/workers/node-program-lifecycle.ts]
---

## User scenario

Goal I3: `process.on('uncaughtException' | 'unhandledRejection')` handlers
receive the error and the process continues as in Node; `process.once('exit')`
fires with the final code; `process.exit()` without an argument exits with
`process.exitCode`. Baseline on main 51440931a (evidence §I2/§I3): timer throw
→ `Uncaught Error: boom` exit 1, handler not called; detached
`Promise.reject` → exit 1, handler not called; `exit` event never fires; 
`exitCode=3; process.exit()` → 0.

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

## Acceptance

1. Timer throw with an `uncaughtException` handler: handler receives the
   Error, the loop continues (later timers run), exit 0; no stderr crash text
   (`→ I3`).
2. Detached rejected promise with an `unhandledRejection` handler: handler
   receives the reason, the loop continues, exit 0 (`→ I3`).
3. `process.on('exit', cb)` fires exactly once with the final code on natural
   exit (`EXIT 0`) (`→ I3`).
4. `process.exitCode = 3; process.exit()` exits 3 (`→ I3`).
5. No-handler programs keep today's loud default: uncaught error → stderr
   stack + exit 1 (ADR-0152 loud-fail unchanged); a rejection with no handler
   still rejects the drain loudly (`→ I3 baseline`, ADR-0152).
6. `exit` emission happens at most once per process, including the explicit
   `exit()` path (unit test) (`→ I3`).

## Parity cases

Real Node v24.16.0 oracles (evidence §Oracle + host probes 2026-10-02): the
four physical eval invocations in
`process/node-eval-process-lifecycle.case.ts` (`caught boom/after` exit 0;
`caughtR rej/after` exit 0; `started/EXIT 0`; exit code 3). All four fail
today on the rifty side exactly as the evidence recorded. Acceptance 5/6 have
no Node oracle for the LOUD default (Node exits differently) — pinned by unit
fault tests in `event-loop-keepalive.test.ts` + `process-globals.test.ts`.

## Out of scope

- `beforeExit` emission — goal map §Out of scope (note, not an obligation).
- vitest-main silent-exit (I4 `process.exit(0)` while cac action pending) —
  owned by `worker-threads-handle-keepalive` (the drain must wait on a live
  Worker); this unit only fixes the event/code semantics.
- SIGINT/SIGTERM graceful-shutdown behavior — separate process.kill ceiling.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| uncaught, no handler | realm `error` event, no `uncaughtException` listeners | loud stderr + exit 1 (`→ ADR-0152`, unchanged) |
| uncaught, handler | handler receives error, loop continues | no crash text, exit per program (`→ I3`) |
| rejection, no handler | `unhandledrejection`, no listeners | drain rejects loudly (`→ ADR-0152`, unchanged) |
| rejection, handler | handler receives reason, loop continues | exit per program (`→ I3`) |
| throw inside handler | `uncaughtException` listener throws | loud default handling with the new error (Node: exception in handler is fatal) (`→ I3`) |
| double exit | `exit()` after natural-drain exit emission started | `exit` event emitted at most once (`→ I3`) |

## Challenge

challenge: 2026-10-02 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); unit premise re-verified by Contract+RED @ 24a8a854 (Node v24.16.0 four-script oracle)

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ 24a8a8546976c82de76e4f4ef1a6d2dfad6cd9e7
- 2026-10-02 — agent (PICKUP, `DEC-2` pending final shape): carrier = a
  process-lifecycle dispatcher registered into the existing keepalive traps
  (late binding, no keepalive→process import — `process.ts` already imports
  the keepalive module). The `error`/`unhandledrejection` traps first ask the
  dispatcher (active NodeProcess listeners?) and only fall through to the
  loud path when unhandled. Natural-exit `exit` emission wraps the kernel
  drain hook resolution (the kernel awaits the hook before reaping, so
  listener output flushes first). ADR shape (correction note on ADR-0152 vs
  short ADR) is recorded at implementation review (`DEC-2`).