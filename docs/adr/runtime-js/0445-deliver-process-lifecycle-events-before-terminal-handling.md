# ADR 0445: Deliver process lifecycle events before terminal handling

Status: Accepted
Date: 2026-09

> TL;DR: deliver process error/exit events before the existing terminal owner; handled errors continue the same drain.

## Context

Vitest installs lifecycle listeners; browser program launches ignored them.
Native Node v24.16.0 and the six real-program browser REDs in
`tests/browser-unit/owner-node-process-lifecycle.spec.ts` establish the baseline.
DEC-2 independent decision: `/root/vm_contract_review`, 2026-09-23.

## Decision

1. Runtime-owned active process receives `unhandledRejection(reason, promise)`;
   without a handler, `uncaughtException(reason, 'unhandledRejection')`.
   Other uncaught errors use origin `uncaughtException`. Handled browser events
   suppress default reporting and never claim fatal/eval terminal ownership.
2. Program/bin/eval entry errors, browser events and nextTick share dispatch.
   A throwing uncaught handler is fatal (Node exit 7), never re-dispatched to
   itself. Explicit exit sentinels stay control signals.
3. `process.exit()` defaults to exitCode; synchronous exit listeners run once,
   before physical termination. Their exitCode changes affect the final status.
   Natural exit uses the same process operation, without another lifecycle owner.
   Fatal reporting emits exit 1 before the existing diagnostic/terminal path;
   a throwing uncaught handler suppresses exit events, matching native exit 7.
4. Partially supersedes ADR-0152 §3: rejection is fatal only when unhandled;
   `preventDefault()` is required for handled events. Its assertion that an
   installed rejection handler implies warning/nonzero exit was incorrect.
   Preserve §1/2/4/5, ADR-0158, eval flush/lease/first-terminal rules in
   ADR-0339/0342, and the single foreground drain in ADR-0385.

Rejected: unconditional fatal (violates I3); a separate handler lifecycle/drain
(unnecessary second owner). Existing emitter + drain suffice. ADR-0157/0334's
trusted active binding prevents guest global replacement and cross-bundle drift.

The existing drain rechecks zero handles after another browser task, before
claiming natural termination. Chromium's unhandledrejection task can follow
the first zero sample (real fatalRejection RED exited 0). Live handles cancel
the idle phase; error/terminal/lease checks still run first. This replaces the
old first-zero-sample unit criterion; native/browser fault parity forces it.

## Consequences

- Node lifecycle consumers can recover from handled errors and observe final exit.
- No-handler diagnostics and existing drain caps remain loud.
- beforeExit remains outside this epic's claim.
