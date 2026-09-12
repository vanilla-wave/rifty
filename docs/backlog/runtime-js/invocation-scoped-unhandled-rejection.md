---
area: runtime-js
status: draft
title: Scope the recorded unhandled rejection to one invocation
created: 2026-09-11
why: a rejection recorded during runtime.eval is reported as the next toolchain.runBin failure while that run's drain settles early
sources: [docs/adr/distribution/0423-keep-no-coi-invocation-settlement-generic.md, https://github.com/vanilla-wave/rifty/pull/332]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/worker-entry.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts]
---

## Context

Found by the PR #332 inline review from source; no browser reproduction yet.
The realm trap (`installUnhandledRejectionTrap`) records the first unhandled
rejection; REPL `handleEval` never consumes it. The next no-COI `run-bin` drain
rejects on its first tick with that stale reason while the tracked CLI promise
keeps running, and `runInstalledBin` reports it as this run's failure because it
takes the slot only in its catch (ADR-0423). Before #332 the slot persisted for
every later run; #332 made it one-shot, not invocation-scoped.
Fault class: provenance-lie / sibling-drift at the invocation owner.

## Question

Consume the record at invocation start (run/start-bin) or at eval settlement so
each serialized invocation reports only its own failure, without a second error
ledger or drain owner. RED: native no-COI `runtime.eval` with an unhandled
rejection followed by a successful `toolchain.runBin` must return its real exit
code and keep the worker free for the next operation.

## Decisions

- 2026-09-11 — capture only; the repair follows `rifty-fix` with its RED and independent review.
