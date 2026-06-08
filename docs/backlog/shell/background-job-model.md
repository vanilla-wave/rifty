---
area: shell
status: parked
title: Background & / job control deferred (distinct from ADR-0089 cancellation)
created: 2026-06-08
why: Shell.run rejects bare & with NotImplementedError('shell.background'); true backgrounding needs a job model, not subsumed by ADR-0089's Ctrl-C cancellation contract
sources: [Q-2026-06-06-405, kernel/server-shaped-worker-process-lifecycle, adr/shell/0089-commandcontext-stdin-istty-cancellation.md]
code: [packages/shell/src/shell.ts]
---

## Context

The non-terminating-foreground-server problem (vite/node http) is solved by ADR-0089 cancellation (Ctrl-C resolves `run`), NOT by `&`. The bare-`&` throw already exists in `shell.ts`.

## Options or Next

Defer `&`/job control as a separate decision; it ties to `kernel/server-shaped-worker-process-lifecycle` (kernel native server-process support). Its own ADR when taken up.

## Reversibility

IRREVERSIBLE when implemented — kernel public behaviour (job table / process lifecycle). Recorded here as a deferral.
