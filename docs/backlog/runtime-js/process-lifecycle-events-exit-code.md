---
area: runtime-js
status: ready
title: process lifecycle parity — uncaught/unhandled handlers, the `exit` event, `exit()` honours `exitCode`
created: 2026-09-15
why: a Node program that installs `process.on('uncaughtException'|'unhandledRejection')` still dies (handler never called), `process.once('exit')` never fires, and `process.exit()` without an argument returns 0 instead of `process.exitCode`; vitest's worker error collection (init.js:115), CLI rejection handling (cli-api:2081), exit hook (cli-api:2063) and exit status (`process.exitCode = …; process.exit()`, cac.js:2348, cli-api:2059/2079) are built on all three
epic: vitest-run-in-browser
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

## Reference contract

Native Node v24.16.0, same actual programs in
`tests/browser-unit/owner-node-process-lifecycle.spec.ts`; no mocked runtime.
ADR-0445 records the independently chosen correction to ADR-0152 §3.

## Acceptance

1. Natural/explicit exits emit once with the final selected code; omitted argument honours exitCode. → I3
2. Unset/reset exitCode is undefined, so Vitest's nullish startup-failure check selects exit 1. → I3, I4
3. Timer/entry exceptions and detached rejections reach installed handlers; subsequent work runs and natural exit stays zero. → I3

## Parity cases

1. Browser-unit native differential: natural, explicit/default/override exit; timer, rejection and entry exceptions. → I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| observable-order × exit | listener before physical terminal, once | natural/explicit/override programs | → I3 |
| sibling-drift × error boundaries | same handler semantics, continuation | timer/rejection/entry programs | → I3 |
| provenance-lie × handled rejection | exact Promise reaches handler; no fatal success claim | rejection program | → I3 |
| observable-order × fatal paths | fatal timer/entry/rejection emit exit 1; throwing uncaught handler exits 7 without exit event | fatal browser programs vs native Node | → I3 |

## Out of scope

beforeExit remains unclaimed; existing loud drain caps unchanged.

## Decisions

re-cut: 2026-09-23 — include the observed unset exitCode baseline required by Vitest's startup failure path — trace: none

- 2026-09-23 — RDY-8 observed defect RED: browser-unit six programs against native Node; missing exit lines, explicit status 0 vs 3, timer/rejection/entry fatal 1 vs handled 0. Command: `RIFTY_PLAYGROUND_PORT=5398 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/owner-node-process-lifecycle.spec.ts`.
- 2026-09-23 — independent decision `/root/vm_contract_review`: partial ADR-0152 §3 supersession, preserved eval print/terminal/drain owners; ADR-0445. Native probes also establish exit-listener code mutation, rejection-to-uncaught fallback and throwing-handler status 7.
- 2026-09-23 — expanded fault RED: timer/entry miss exit 1; zero-handle rejection exits 0; throwing uncaught handler wrongly emits exit 7. Existing late-unhandled-rejection-drain is required by I3, retained in this unit; no second drain owner.
- 2026-09-23 — full Vitest RED exposes another I3 root: initial exitCode=0 prevents cac's nullish check assigning 1. `process/exit-code-unset` native differential RED: initial/reset values number 0 vs undefined, startup 0 vs 1; preserve undefined until assigned or terminating.
