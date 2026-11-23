---
area: runtime-js
status: draft
title: Stop host deliveries at the process's terminal, not when the run's status is out
created: 2026-11-23
why: Work already due when `exit()` is called or a fatal is thrown from any callback still runs in the isolate host (`runCode` and the sandbox) — Node runs nothing after the terminal; gating deliveries from the terminal would end those rows on both hosts.
sources: [docs/public/compat/isolate-host.md, docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class.md, PR-424-cross-review]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

Untried. Since PR #424 every host delivery to the guest (a timer's expiry, an unhandled
rejection) passes one gate on the guest's run phase and runs nothing once the run's status is
out. The runtime records the process's terminal earlier — at `exit()`, or at a fatal thrown in
a callback — and between the two, a timer already due still runs: `setTimeout(() =>
fs.writeFileSync('t', '1'), 0); Promise.resolve().then(() => process.exit(2))` keeps `t` in a
sandbox (Node: exit 2, no `t`); an endless such timer ends the run `timeout` in both hosts.
Closing the gate at the terminal instead would match Node there, and would move `runCode` corpus pins of today's divergence (they pin rifty's outcome, not
Node's: a timer's `exit(0)` overriding a pending fatal, `node-eval-queued-exit-overrides-pending-
fatal`; the output of callbacks due beside `exit()`), so it needs its own contract against live
Node, not a fold into the sandbox. Same mechanism and trigger as
`runtime-js/node-eval-work-queued-at-exit-runs` (its `awaitDrain` dead end is recorded there). Owner: runtime-js (with the isolate
guest). Trigger: the next change to the runtime's terminal or to the guest's deliveries, or a
consumer finding a file written after `exit()`.

## Challenge

challenge: 2026-11-23 — none yet (factual capture, PR #424 cross-review round 1)
