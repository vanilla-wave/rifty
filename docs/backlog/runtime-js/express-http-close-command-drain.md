---
area: runtime-js
status: draft
title: Express self-request responds but closed-server CLI command remains alive
created: 2026-09-07
why: A real HTTP response and server.close do not settle the ordinary Workbench node command although real Node exits.
sources: [ADR-0152, ADR-0158]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/workbench/src/workers/node-program-lifecycle.ts]
---

## Context

Captured while verifying PR #314, independently reproduced on its unchanged baseline `df3cd222f`. Real npm Express 4.21.2 installs, HTTP callback prints `200 EXPRESS_REGISTRY_OK`, but `executeProjectLine('node proof.cjs')` remains pending until the 45-second test watchdog. Node v24.16.0, same program and dependency, prints the same response and exits 0.

Repro: ordinary Workbench node-cli project, `npm install`, then `node proof.cjs`; use the guest program in `tests/browser-unit/registry-package-ownership.spec.ts` with terminal `run.exited` instead of its explicit stop-after-response helper. Removing the explicit stop reproduces the observed pending command. No diagnosis of which handle remains is claimed.

This migration preserves existing Express server execution with explicit user stop; automatic close/drain parity is separate. Owner: runtime lifecycle; trigger: pickup of HTTP/server-close command settlement. Fault candidate: unbounded-read at process drain; actual live handle needs a discriminating probe.

Dedup: `keepalive-residual-gaps` concerns nested-spawn reachability; `late-unhandled-rejection-drain` concerns premature exit; `preview-ws-bridge-termination` concerns socket/preview broker settlement. None owns this completed-response/closed-server command repro. Declined concepts and process traps have no matching rejection. No new coordination mechanism proposed.
