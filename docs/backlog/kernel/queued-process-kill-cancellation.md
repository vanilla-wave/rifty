---
area: kernel
status: draft
title: Killed queued processes never start or publish late outcomes
created: 2026-07-17
why: ProcessManager queues same-realm handlers in a microtask, so a process killed synchronously after spawn can still run guest code and publish output or a second terminal outcome
epic: real-node-server-dev-loop
sources: [ADR-0012, ADR-0257]
code: [packages/kernel/src/process-manager.ts, packages/kernel/tests/process-manager.test.ts]
---

## Context

`ProcessManager.spawn()` allocates and publishes a handle before its same-realm
handler starts. A synchronous `kill()` sets a terminal result, but the queued
microtask still invokes the handler; its later output, rejection, or completion
can escape after the process was already killed. Restart supervisors amplify
that race because teardown and replacement are routine, not exceptional. The
contract needs RED cases for kill-before-start, kill during an awaiting handler,
late handler rejection, and the Worker sibling sweep. One process record must
own terminal settlement and prevent guest execution or publication after that
settlement; another point check around the current microtask is insufficient.
