---
area: runtime-js
status: draft
title: "Browser hosts: an uncaught throw from a timer or callback (and a COI entry throw) prints Node's fatal report"
created: 2026-11-23
why: On the COI kernel child and the no-COI child Worker such a throw prints the browser's text with rifty's runtime frames and served URLs (main's behaviour), and on the no-COI SDK command it ends silent with no status; Node prints its fatal report and exits 1
sources: [docs/adr/runtime-js/0571-prove-node-file-entry-and-fatal-report-parity-against-live-node-node-s-report-in-the-isolate-guest-only.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/adr/kernel/0340-sequenced-worker-stdio-reconstructs-cross-port-write-order.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/kernel/src/process-manager.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
---

## Context

PR #421 (ADR-0571) moved this path to the runtime's report
twice and rolled it back after two regressions (ADR-0445 2026-11-23 lines);
the goal map keeps it as item 5d with an `owner: user` question.

Facts established:
- **Who writes the report.** main: the browser's default report — the Worker
  `error` event left uncanceled propagates to the parent `Worker` object; the
  kernel (`ProcessManager` `_workerError`) writes the error text to the child's
  stderr from the parent side (no `control:stdio-order` frame) and settles exit
  1. The PR attempt: the child wrote Node's report itself (it needs the guest
  VFS and the live error object, which the parent never sees), adding one
  stderr stdio-order frame after stdout, then its own exit request.
- **The rule a fix must keep (ADR-0340 "canceled global errors remain
  nonterminal").** Whether the error is canceled is the event's own flag at the
  end of the dispatch (`defaultPrevented`), however it was set: `preventDefault()`
  in any listener, `Event.prototype.preventDefault.call(e)`, `onerror`
  returning `true`, a capture listener, a listener added during the dispatch.
- **Why interception failed.** rifty's trap is installed at boot, so it runs
  first; to keep the browser from reporting to the parent it must cancel
  synchronously, before later listeners decide. Round 3 ran the terminal in
  the trap (guest cancel ignored); round 4 deferred it to a microtask and
  wrapped the event's own `preventDefault` — `onerror` returning true and the
  prototype call bypass the wrapper. Any list of cancellation forms is
  incomplete; only the flag after dispatch is authoritative.
- No-COI SDK command (in-place realm): a timer/callback throw ends with stderr
  `''` and `exitCode` null (carrier rows `throw-from-timer`,
  `fatal-with-queued-*`, `rethrow-after-import`,
  `listener-rethrows-from-later-timer`; `distribution/no-coi-command-unhandled-rejection-exit`).

## Question

Can the child's report be written only after the dispatch, from the flag, while
the parent's default report is suppressed exactly when the child reports (one
report, one exit, ADR-0340 intact)? E.g. never cancel in the trap; the parent
holds its print until the child's report or its absence is known — a
coordination mechanism, so `docs/process/rules/fault-classes.md` §Class-kill
inventory first. User decision pending (goal map 5d: accept and defer, or a
separate goal).

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
