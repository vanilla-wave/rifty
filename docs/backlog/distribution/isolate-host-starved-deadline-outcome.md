---
area: distribution
status: draft
title: With a starved consumer, the isolate-host deadline outcome follows read order, not send time — wrong in both directions
created: 2026-11-22
why: Under host load `runCode` can return `timeout` for a call that finished in time, or for a worker lost in time (no rerun); judging after reading instead returns results sent after the deadline — the outcome needs the worker-side send time.
sources: [docs/adr/distribution/0563-run-runcode-in-a-pool-of-long-lived-worker-processes-each-hosting-many-isolates.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/pool.ts, packages/isolate-host/src/protocol.ts, packages/isolate-host/tests/protocol.test.ts]
---

## Context

The consumer's deadline is a `setTimeout` in its own loop (`packages/isolate-host/src/pool.ts`, `Call` constructor). A Node loop turn runs due timers before it polls I/O, so a consumer that was not scheduled (a loaded host) finds the deadline due together with whatever its worker sent meanwhile. The consumer has no view of when a frame was sent, only of the order in which it reads it. Reproduced (macOS arm64, Node 24.16.0; hostile-child harness of `protocol.test.ts`, the consumer stalled synchronously from the call):

1. A frame sent before the deadline but read after it → `termination: 'timeout'` (the honest outcome is the result). Pinned as a declared gap: `protocol.test.ts` "a starved consumer: a result sent before the deadline but read after it is timeout (declared, compat ⚠️)".
2. Judging after one poll instead (`870842092`, in PR #420 up to `bb022938b`; reverted in that PR) → a frame sent after the deadline wins (`timeoutMs: 100`, guest prints at 1000 ms, consumer busy 1800 ms → `{stdout: 'late\n', exitCode: 0}`; base `timeout`), and a solo rerun that finished after the deadline resolves instead of `ERR_ISOLATE_HOST_WORKER_LOST` (F1 broken). Cross-review probes `late.mjs`, `rerun-late.mjs` (not kept in the repo); the committed carriers reproduce both: `protocol.test.ts` "a starved consumer: a result sent after the deadline loses to it (timeout)", "a starved consumer: a rerun that finishes after the deadline is a lost call (F1)" — the after-one-poll mutant reds all three rows.
3. A worker that dies before the deadline (self-SIGKILL at once), consumer stalled until the zombie exists and past the deadline → `timeout` 3/3, instead of a lost worker and its rerun.

Lead (not a decision): the outcome needs the worker-side send time — a shared monotonic stamp on terminal frames, or the worker judging the deadline itself — a wire change (`protocol.ts`) and an ADR-0563 line. Owner: isolate-host pool; trigger: after PR #419 (sandbox; changes `pool.ts`/`protocol.ts`) merges. The closed-channel grace already decides after one poll (ADR-0563 Corrections 2026-11-22); an exit read there is the worker's own either way.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
