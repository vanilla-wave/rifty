---
area: toolchain-build
status: draft
title: Node-host child consumers outside isolate-host judge a timeout before reading what the child already delivered
created: 2026-11-22
why: Under CPU load a completed child run is labelled a timeout (parity results, agent-bench setup and lanes, sass probes, a runtime-js test helper) — a provenance-lie in a gate's or benchmark's verdict.
sources: [docs/process/traps.md, docs/process/rules/fault-classes.md]
code: [tools/node-parity-runner/src/run-in-node.ts, tools/agent-bench/src/proc.ts, tools/agent-bench/src/plan.ts, tools/agent-bench/src/lanes/native-codex.ts, tools/shadow-registry/tools/sass-async-importer-deadlock-probe.mjs, tools/shadow-registry/tools/sass-constructor-liveness-probe.mjs, packages/runtime-js/src/internal/runtime-smoke-child.test-helper.ts, tools/perf/src/child-fs-orchestrator.mjs, packages/isolate-host/src/child/main.ts]
---

## Context

Class `timer-judges-unread-io` (`docs/process/traps.md`; fault-classes row "Owned native child/browser lifecycle"): a Node loop turn runs due timers before polling I/O, so a consumer that was not scheduled finds its timer due and the child's output / `close` / `exit` unread at once; a timer callback that judges the outcome from in-memory flags judges stale state. In `packages/isolate-host/src/pool.ts` killed for the closed-channel grace only (it decides after one poll; RED `protocol.test.ts` "a child that closes the channel and exits…"). Deciding a deadline after one poll is not the fix: reading late cannot tell a result sent in time from one sent after (`backlog/distribution/isolate-host-starved-deadline-outcome`) — each call-site below needs the send time or an honest declared outcome, not just a poll. Sweep 2026-11-22 (code reading, nothing reproduced) found the same shape at:

- `tools/node-parity-runner/src/run-in-node.ts:289`, `:445` — the timeout sets `timeoutError`; `close` checks it first: a finished case reports "timed out after N ms" (reaches parity results). `:305`, `:463` (1 s after SIGKILL) only change the message.
- `tools/agent-bench/src/proc.ts:61` (`runToCompletion` → `runOrThrow`), `tools/agent-bench/src/plan.ts:48` (`gitOutput`) — reject "timed out" with `close` pending: setup steps and plan resolution fail.
- `tools/agent-bench/src/lanes/native-codex.ts:74` — `exhaust('runTimeoutMs')`: a finished run reports `agentStatus: 'budget-exceeded'`.
- `tools/shadow-registry/tools/sass-async-importer-deadlock-probe.mjs:53`, `sass-constructor-liveness-probe.mjs:283`, `:308` — `timedOut` / `postOutcomeTimedOut` / `startupTimedOut` with the outcome or exit unread: a wrong liveness verdict.
- `packages/runtime-js/src/internal/runtime-smoke-child.test-helper.ts:128` — `timedOut` checked before the real exit: a false test failure.
- `tools/perf/src/child-fs-orchestrator.mjs:19` (`deadline` race, 30–600 s bounds) — a spurious cleanup failure.
- `packages/isolate-host/src/child/main.ts:191`, `:281` (worker side, `STUCK_GRACE_MS`) — an isolate whose unwinding is an unread isolated-vm completion is judged stuck: a needless retire (process placement only, no result changes); no deterministic RED found without replacing the worker.

Owner: the next pickup that touches one of these tools, or a red attributed to one under load. Each call-site needs its own starved-consumer RED (stall the consumer synchronously at its timer, cue the child) before its fix.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
