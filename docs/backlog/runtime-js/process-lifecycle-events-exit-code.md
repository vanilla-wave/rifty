---
area: runtime-js
status: draft
title: process lifecycle parity — uncaught/unhandled handlers, the `exit` event, `exit()` honours `exitCode`
created: 2026-09-15
why: a Node program that installs `process.on('uncaughtException'|'unhandledRejection')` still dies (handler never called), `process.once('exit')` never fires, and `process.exit()` without an argument returns 0 instead of `process.exitCode`; vitest's worker error collection (init.js:115), CLI rejection handling (cli-api:2081), exit hook (cli-api:2063) and exit status (`process.exitCode = …; process.exit()`, cac.js:2347, cli-api:2059/2079) are built on all three
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/adr/playground/0157-unified-spec-seeded-mutable-node-process-at-pre-entry-gated-to-node-workers.md, docs/backlog/runtime-js/late-unhandled-rejection-drain.md, docs/backlog/runtime-js/invocation-scoped-unhandled-rejection.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/workbench/src/workers/node-program-lifecycle.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/runtime-js/src/ipc/in-process-node-entry-runner.ts, tools/node-parity-runner/src/worker-env-kernel-worker.ts]
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

Pickup (2026-09-23, BASE `92215e3b4`): the live-oracle browser-unit run
differs from Node in 36/36 programs (evidence §B). Beyond the draft: the
`nextTick` path passes no origin and silently drops a throw with no listener
(exit 0); a throwing listener exits 1, not 7; `exitCode` reads a number; and
a rejection that is the program's last work exits 0 with no output, handler
or not — the drain settles before Chromium dispatches `unhandledrejection`
(`runtime-js/late-unhandled-rejection-drain`), so that race is on the I3 path
and this unit absorbs it. Carrier: ADR-0445.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

- Oracle: Node v24.16.0 `process` lifecycle — `lib/internal/process/execution.js`
  `createOnGlobalUncaughtException` (monitor → listeners → fatal `exitCode = 1`
  + `'exit'` 1 behind `_exiting`), `lib/internal/process/promises.js`
  (`unhandledRejection` listeners, else `UnhandledPromiseRejection` for a reason
  without own `stack`, delivered as `uncaughtException` origin
  `unhandledRejection`), `lib/internal/process/per_thread.js` `exit`
  (`arguments.length` assigns `exitCode`; `'exit'` once with `exitCode || 0`;
  the status is read after the listeners). Evidence §N, §O1–§O3.
- Mechanism: ADR-0445 — one dispatch on the realm's active `NodeProcess`,
  called by the existing realm `error`/`unhandledrejection` traps, the
  `nextTick` drain and the lifecycle entry catch; `exit()` with Node's
  semantics; natural exit calls `exit()`; the drain confirms zero refs across
  one more host task.

## Acceptance

1. Real Chromium supervised children (`tests/browser-unit/owner-node-process-lifecycle.spec.ts`, sources `tests/browser-unit/fixtures/process-lifecycle-cases.ts`, live Node oracle at test time): every case of Parity cases 1–12 prints the same `L|` rows and exits with the same status as Node, and each fatal case shows its marker, on `node <file>`, `node -e`, a `.bin` program, a forked child, a worker thread and an execSync child. → I3, ADR-0445
2. Forked program children in the parity runner (`tools/node-parity-runner/cases/process/exit-lifecycle-child.case.ts`) print the same rows, status and loud-stderr flag as Node for the `exitCode`, `exit()`, `'exit'` and `nextTick` rows (Parity cases 1, 6–8, 10). → I3, ADR-0445
3. Physical `node -e`/`-p` children in the parity runner (`tools/node-parity-runner/cases/process/eval-exit-lifecycle.case.ts`) match Node's stdout, stderr, stream frames and status for Parity cases 1 (`nextTick`), 6, 7 and 8, including the `-p` print before the natural `'exit'`. → I3, ADR-0445
4. `packages/runtime-js/src/builtins/process-exit-lifecycle.test.ts`: an `exit()` after the first terminal re-emits nothing and sends the kernel no second exit request (one `control:self-exit` with the first code); `exit(2)` inside an `'exit'` listener runs the listeners once and requests only code 2. → I3, ADR-0445
5. `packages/runtime-js/src/internal/event-loop-keepalive-late-rejection.fault.test.ts`: a rejection recorded one host task after the drain's first zero-ref sample rejects the drain; it never settles as a clean exit first. → I3, ADR-0445
6. `packages/workbench/src/workers/no-coi-project-command.test.ts` "gives each invocation an unset exitCode and one Node exit event": two rounds of `natural-exit.cjs` / `exit-no-arg.cjs` in one no-COI worker each match Node's §O3 rows and status. → ADR-0445
7. `docs/public/compat/process.md`: ✅ rows for handler dispatch, the `'exit'` event, `exit()`/`exitCode` and the late-rejection drain (replacing the ⚠️ row that cites `runtime-js/late-unhandled-rejection-drain`); ❌/⚠️ rows for each Out-of-scope gap below; `packages/runtime-js/CHANGELOG.md` and `packages/workbench/CHANGELOG.md` lines. → ADR-0445

## Parity cases

Carriers: browser-unit cases named in `process-lifecycle-cases.ts` (live Node
oracle, rows in evidence §O3), plus the parity cases and tests in Acceptance
2–6 where named. Node scripts and output: evidence §O1/§O2 (o-numbers).

1. A throw from a timer, `setImmediate`, an fs callback, a `nextTick` callback or a CommonJS entry reaches `uncaughtException` listeners as `(err, 'uncaughtException')`; the program continues and exits 0 with `'exit'` 0 (cases `timer-handler`, `immediate-handler`, `fs-callback-handler`, `nexttick-handler`, `entry-throw-handler`, `eval-handler`; o01–o04, o23). → I3, ADR-0445
2. An ES module entry throw reaches `uncaughtException` with origin `'unhandledRejection'` and not an installed `unhandledRejection` listener; the program continues (case `entry-throw-handler-esm`; o24, o31). → I3, ADR-0445
3. `uncaughtExceptionMonitor` listeners run before `uncaughtException` listeners with the same `(err, origin)` (case `monitor-order`; o17). → ADR-0445
4. `unhandledRejection` listeners get `(reason, promise)` with the rejected promise's identity and the program continues — also when the rejection is its last pending work (cases `rejection-handler`, `rejection-only-handler`, `eval-rejection-handler`; o05, o37). → I3, ADR-0445
5. With no `unhandledRejection` listener, `uncaughtException` gets `(reason, 'unhandledRejection')`; a reason without an own `stack` arrives as an `Error` named `UnhandledPromiseRejection`, `code` `ERR_UNHANDLED_REJECTION`, message ending `The promise rejected with the reason "<r>".` with V8's rendering for number, string, undefined, null, boolean, symbol, bigint, plain object, array, `Map`, null-prototype object, function and an `Error.prototype` object; an own-`stack` object and a thrown string arrive raw (cases `rejection-fallback`, `nonerror-handler`; o06, o44). → I3, ADR-0445
6. `process.exitCode` reads `undefined` until assigned (also inside a natural `'exit'` listener); `'3'` reads number 3; `null` and `undefined` reset it to `undefined` (cases `exitcode-read`, `natural-exit`; o07, o09). → I3, ADR-0445
7. `exit()` without an argument exits with `exitCode` (`exitCode = 3; exit()` → 3; cac's `if (process.exitCode == null) process.exitCode = 1; process.exit()` → 1); `exit(undefined)` after `exitCode = 3` → 0; `exit(5)` with `exitCode = 9` → `'exit'` 5, status 5 (cases `exit-no-arg`, `exit-startup-error`, `bin-startup-error`, `eval-exit-no-arg`, `exit-undefined-arg`, `exit-arg-override`; o08, o10, o21). → I3, ADR-0445
8. `'exit'` fires once with `exitCode ?? 0`: at natural exit after pending timers (and after the `-p` print); an `'exit'` listener's `exitCode = 5` sets the status; `exit(2)` inside a listener re-emits nothing, skips later listeners and exits 2; a timer scheduled inside `'exit'` never runs (cases `natural-exit`, `natural-exit-code`, `exit-listener-reassign`, `exit-reentrant`, `exit-listener-timer`, eval `print-before-exit`; o07, o11–o13, o22, §O2). → I3, ADR-0445
9. `process.exit()` inside an `unhandledRejection` or `uncaughtException` listener exits with that call's code after one `'exit'` (vitest's rejection handler: `exitCode = 1; exit()` → 1) (cases `exit-in-rejection-handler`, `exit-in-uncaught-handler`; o19, o27). → I3, ADR-0445
10. With no listener, a throw (timer, `nextTick`, entry) or rejection prints the error on stderr, emits `'exit'` 1 with `exitCode` 1, and exits 1 — never 0, also when a later task calls `exit(0)` (cases `fatal-timer`, `fatal-rejection`, `fatal-nexttick`, `fatal-entry`, `eval-fatal-timer`, `fatal-rejection-then-exit`, `fork-fatal-rejection-then-exit`, `worker-thread-fatal-rejection-then-exit`, `exec-sync-fatal-rejection-then-exit`; o14, o15, o20, o34, evidence §F). → I3, ADR-0445
11. A throw from an `uncaughtException` listener prints it on stderr and exits 7 with no `'exit'` event (case `fatal-handler-throws`; o16). → ADR-0445
12. Launch owners: a `.bin` program, a forked child's rows and close code, a worker thread's handler rows and `'exit'` code, and an execSync child's rows through the parent match Node (cases `bin-startup-error`, `fork-child`, `worker-thread-handler`, `exec-sync-child`; §O3). → I3, ADR-0445

## Fault matrix

Boundary: dedicated Worker (`fault-classes.md` §Boundary — a Worker `error`
rethrows into its creator unless the owning handler cancels it) and the
child-realm drain (ADR-0152).

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `observable-order` × a zero-ref drain vs Chromium's later `unhandledrejection` task | the listener runs and the program exits 0; with no listener stderr + exit 1 — never a silent exit 0 | `event-loop-keepalive-late-rejection.fault.test.ts`; browser-unit `rejection-only-handler`, `fatal-rejection`, `eval-rejection-handler` | → I3, ADR-0445 |
| `observable-order` × `exit()` again after the kernel exit request (vitest's `setTimeout(() => process.exit(), 1)` inside `'exit'`) | no second `'exit'`, no second request; the status stays the first terminal's | `process-exit-lifecycle.test.ts` case 1; `exit-listener-timer` rows (browser-unit, both parity cases) | → I3, ADR-0445 |
| `observable-order` × a no-listener rejection vs a later task's `exit(0)` | stderr and the status-1 exit request run at the trap; the later `exit()` re-emits nothing and requests nothing; status 1 on every kernel child. An `exit()` already requested (in the fatal `'exit'`, or before the rejection is seen) keeps its status, no stderr | `process-exit-lifecycle.test.ts` cases 3–5; browser-unit `fatal-rejection-then-exit`, `fork-fatal-rejection-then-exit`, `worker-thread-fatal-rejection-then-exit`, `exec-sync-fatal-rejection-then-exit` | → I3, ADR-0445 |
| `observable-order` × `exit()` re-entered inside an `'exit'` listener | listeners not re-emitted, later listeners skipped, status = the re-entrant code | `process-exit-lifecycle.test.ts` case 2; `exit-reentrant` rows | → I3, ADR-0445 |
| `provenance-lie` × a listener-handled error vs the Worker default `error` report | handled → canceled, program continues, status 0; unhandled → report unchanged, stderr + status 1 | browser-unit `timer-handler`, `fatal-timer`, `worker-thread-handler`, `fork-child` | → I3, ADR-0445 |
| `observable-order` × a throwing `uncaughtException` listener | status 7 + stderr, no `'exit'`, never re-dispatched to itself | browser-unit `fatal-handler-throws` | → ADR-0445 |
| `corrupt-input` × the `RIFTY_PROCESS_EXIT` signal thrown out of an error listener | never dispatched as an error; status = that `exit()` code, one `'exit'` | browser-unit `exit-in-rejection-handler`, `exit-in-uncaught-handler` | → I3, ADR-0445 |
| `sibling-drift` × launch owners (program lifecycle, eval, `.bin`, fork, worker thread, execSync, no-COI invocation) | the same rows on every claimed owner | Acceptance 1–3, 6 | → I3, ADR-0445 |
| `torn-state` × no-COI per-invocation exit state (`exitCode`, exiting mark) on the shared in-process `process` | each invocation starts unset and not exiting; one `'exit'` per invocation | `no-coi-project-command.test.ts` two rounds | → ADR-0445 |

## Out of scope

- `beforeExit`: not emitted (unchanged; not on vitest's path — goal map §Out of scope; Node o07 prints it). Compat ❌.
- `rejectionHandled`: not emitted when a reported rejection gains a handler later (unchanged). Compat ❌.
- `process.setUncaughtExceptionCaptureCallback` / `hasUncaughtExceptionCaptureCallback`: absent members, a call throws `TypeError: … is not a function` (unchanged). Compat ❌.
- Node's undocumented `process._exiting`: not exposed.
- A throw from an `'exit'` listener (Node delivers it to `uncaughtException`, o39): not claimed.
- Worker threads' natural exit (entry returns, loop drains → Worker `'exit'`): map item 8 `runtime-js/worker-threads-handle-keepalive`; this unit claims their handler dispatch and explicit `exit()` only.
- no-COI in-process project commands: handler dispatch runs through the same realm traps but has no carrier here — compat ⚠️ unclaimed; only their exit state (Acceptance 6) is claimed.
- Byte-identical fatal stderr (Node's source line, caret, `Node.js v24.16.0` trailer): the claim is the error message on stderr and the status.
- Delivery order of `unhandledRejection` against a `setTimeout(0)` scheduled in the same turn (Node: the listener first, o18): not claimed; Chromium queues the rejection notification as its own task — with no listener that timer runs before the fatal, so it can print or `exit()` first (evidence §F).
- Signal-terminated exits (Ctrl-C → 130): unchanged, no `'exit'` event, as Node's default signal death.
- A no-listener throw whose `'exit'` listener sets `exitCode` (Node exits with it, evidence §F): the default Worker report still exits 1; rejections honour it.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 6fdaaedf149044f3921eeb845a37541f87879aa3

- 2026-09-23 — carrier: ADR-0445, one dispatch on the active `NodeProcess` + Node `exit()` + one-more-task drain settle; partially supersedes ADR-0152 §3 (listener-handled rejections are canceled, not recorded) and extends ADR-0157 §1. The DEC-2 decision-subagent pass is owed (this worker runs at depth 1 of 1).
- 2026-09-23 — scope: absorbs `runtime-js/late-unhandled-rejection-drain` (evidence §B: `fatal-rejection`, `rejection-only-handler`, `eval-rejection-handler` exit 0 with no output); the draft is deleted when this unit lands.
- 2026-09-23 — scope: claimed launch owners are the node-entry program lifecycle (`node <file>`, `.bin`, spawn/fork), eval, the execSync program branch (its natural `exit()` after its drain), worker-thread dispatch, and no-COI exit state; the rest is Out of scope.
- 2026-09-23 — carriers: the browser-unit spec (real Chromium, live Node) is the decisive carrier for trap-driven rows; the parity child/eval cases carry rows that need no browser event. At IMPLEMENT the harness adapter `worker-env-kernel-worker.ts` must route host `uncaughtException`/`unhandledRejection` through the product traps, not its own copy.
- 2026-09-23 — contract migration at IMPLEMENT: keepalive unit tests that expect a zero-ref drain to settle on its first sample gain one sample (ADR-0445 rule 7); numeric `exitCode` readers (`in-process-node-entry-runner.ts`, `no-coi-project-command.ts`, the parity exec-sync harness) read `exitCode ?? 0` and reset it to `undefined`.
- 2026-09-23 — Final+GREEN runs `pnpm test:e2e:prod` (node-entry bootstrap/worker-entry change, traps `prod-e2e-separate-gate`).
- 2026-09-23 — implement: mechanism in `builtins/process-lifecycle-events.ts` (dispatch, `NodeProcessExit`, `UnhandledPromiseRejection`); the one kernel exit request is kept by the control port (`#requestSelfExit`), so the eval lifecycle-failure terminal still fails loudly on a closed port (`install-process-ipc.test.ts`).
- 2026-09-23 — fault-class sweep (a callback run inside the promise reaction that settled it turns its throw into a rejection): fs callback APIs, zlib convenience callbacks and `util.callbackify` run through `runNodeCallback`. RED→GREEN carrier `tools/node-parity-runner/cases/process/callback-throw-uncaught-child.case.ts` (evidence §G). `fs.createReadStream` `'data'` listeners already match (probe, evidence §G).
- 2026-09-23 — Contract+RED concern (eval entry throw uncovered): carrier `tools/node-parity-runner/cases/process/eval-entry-throw-lifecycle.case.ts` (handled `-e`, handled `-p` prints no result, fatal `'exit'` 1), RED→GREEN (evidence §G).
- 2026-09-23 — Contract+RED concern (`-p` with an explicit `exit()` neither claimed nor Out of scope): claimed — Node prints the result after the user `'exit'` listeners (timer `exit(3)`: `EXIT 3`, `42`, status 3) and nothing on an `exit()` during the source; carrier `tools/node-parity-runner/cases/process/eval-print-explicit-exit.case.ts`, RED (no `'exit'` emission) → GREEN (evidence §G).
- 2026-09-23 — contract migrations (ADR-0445 rules 6–7): `event-loop-keepalive.test.ts` first-sample settles gain one confirming sample; `node-program-lifecycle.test.ts` natural exit passes no code (`normalizeExitCode`, `readExitCode` removed — `exit()` reads `exitCode`).
- 2026-09-23 — sibling sweep (torn exit state on a reused in-process process): `resetNodeProcessExit` at every invocation start — no-COI project command, toolchain run-bin, resident bin, in-process execSync runner, parity exec-sync harness; numeric readers use `exitCode ?? 0`.
- re-cut: 2026-09-23 — Final+GREEN r1 blocker (a no-listener rejection's terminal waited for the next drain sample, so a later `exit(0)` exited 0 after `'exit'` 1 on program, fork, worker-thread and execSync children): the fatal terminal (stderr, exit request with `exitCode ?? 1`) runs at the trap and the drain records its exit signal (ADR-0445 rule 3); Parity 10 gains four `*-then-exit` cases and the fault matrix a row (an `exit()` already requested keeps its status, no stderr); Out of scope names the throw + `'exit'`-listener `exitCode` gap. The 0 ms-timer variant stays under Out of scope's delivery-order row (the timer runs before Chromium dispatches the rejection) — trace: none
- 2026-09-23 — fork (STOP-1a, Final+GREEN r1 reception, evidence §F2): after a no-listener rejection, a Node callback Chromium queued before its `unhandledrejection` task (a same-turn `setImmediate`, a timer ripe at the same time, an fs callback or `fs.promises` result) runs first; its `exit(0)` exits 0 with no stderr where Node prints the error and exits 1 (3/3 each @ `91f6fa4e1`). Keeping "never 0" needs a rejection fence before every Node callback (≥ 2 host-task hops per timer/immediate/fs callback; reorders ADR-0085); the alternative narrows Parity 10 and the fault row and widens the delivery-order Out-of-scope row. Demoted to draft. Pre-demotion Parity 10 verbatim: «10. With no listener, a throw (timer, `nextTick`, entry) or rejection prints the error on stderr, emits `'exit'` 1 with `exitCode` 1, and exits 1 — never 0, also when a later task calls `exit(0)` (cases `fatal-timer`, `fatal-rejection`, `fatal-nexttick`, `fatal-entry`, `eval-fatal-timer`, `fatal-rejection-then-exit`, `fork-fatal-rejection-then-exit`, `worker-thread-fatal-rejection-then-exit`, `exec-sync-fatal-rejection-then-exit`; o14, o15, o20, o34, evidence §F). → I3, ADR-0445» Pre-demotion fault row verbatim: «| `observable-order` × a no-listener rejection vs a later task's `exit(0)` | stderr and the status-1 exit request run at the trap; the later `exit()` re-emits nothing and requests nothing; status 1 on every kernel child. An `exit()` already requested (in the fatal `'exit'`, or before the rejection is seen) keeps its status, no stderr | `process-exit-lifecycle.test.ts` cases 3–5; browser-unit `fatal-rejection-then-exit`, `fork-fatal-rejection-then-exit`, `worker-thread-fatal-rejection-then-exit`, `exec-sync-fatal-rejection-then-exit` | → I3, ADR-0445 |» Pre-demotion Out-of-scope row verbatim: «- Delivery order of `unhandledRejection` against a `setTimeout(0)` scheduled in the same turn (Node: the listener first, o18): not claimed; Chromium queues the rejection notification as its own task — with no listener that timer runs before the fatal, so it can print or `exit()` first (evidence §F).»
