---
area: net
status: active
title: http parity cases bind fixed OS ports on the Node side (EADDRINUSE flake)
created: 2026-06-12
why: cases/http/server-buffered (4201) and server-streaming-drain (4202) listen on hardcoded ports in the spawned real-Node child — a stale process or parallel run turns the gold-standard parity suite red intermittently (observed during PR #21 review)
user_story: As a rifty contributor running the HTTP parity suite, I want green `test:parity` runs in parallel/after a crash, but today the real-Node `http` cases bind fixed ports 4201/4202 so a stale process flakes `EADDRINUSE`. The `listen(0)` ephemeral-port runtime feature now exists (`net/listen-zero-ephemeral-ports`, landed) — these two cases just need rewriting around it.
sources: [PR #21 review]
code: [tools/node-parity-runner/cases/http/server-buffered.case.ts, tools/node-parity-runner/cases/http/server-streaming-drain.case.ts, tools/node-parity-runner/src/run-in-node.ts]
---

## Context

The rifty side uses the virtual port registry (no OS bind); only the Node side flakes.
HTTP_NODE_PREAMBLE unref()s servers but never closes them.

## Options or Next

- Rewrite both cases around `server.listen(0)` + `server.address().port` (the
  `net/listen-zero-ephemeral-ports` feature has landed; the Node side already
  unref()s listeners, and a new case can read `address().port` to drive
  `__riftyHttpRequest` — see `cases/http/listen-zero-ephemeral.case.ts` for the
  exact pattern). No hardcoded port, no `EADDRINUSE` flake.

## Reversibility

REVERSIBLE — test-harness plumbing only.
