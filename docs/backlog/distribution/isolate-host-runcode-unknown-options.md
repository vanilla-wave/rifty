---
area: distribution
status: draft
title: runCode ignores unknown option names; the sandbox API refuses them
created: 2026-11-23
why: Manager decision 2026-11-23 for the sandbox API (ADR-0568 §1): an unknown option name is a loud ERR_INVALID_ARG_VALUE there; runCode (ADR-0557) still ignores them, so `{ timeoutMS: 5 }` leaves the default deadline.
sources: [ADR-0568, ADR-0557]
code: [packages/isolate-host/src/run-code.ts]
---

## Context

`runCode('1', { memoryLimitMB: 8 })` runs with the default 256 MiB limit and no
error (2026-11-23, this branch). Changing it changes `runCode`'s accepted
inputs (ADR-0557 §1): its own decision.

## Challenge

challenge: 2026-11-23 — none yet (factual capture)
