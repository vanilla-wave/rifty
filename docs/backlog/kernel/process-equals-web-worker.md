---
area: kernel
status: draft
title: "Process = Web Worker" for every child (drop the in-realm new Function fallback)
created: 2026-06-08
why: M6 open acceptance — some child_process paths still run as new Function in the parent realm, not a real Worker per child
user_story: As a dev expecting `child_process.spawn`/`fork` to give each child its own isolated `globalThis`, I want every child in a separate Worker, but today without the SAB+worker-url gate it falls back to `new Function` in the parent realm so children share the parent's globals.
sources: [A-002, ADR-0011, TASKS M6]
---
## Context
The strategic model (CLAUDE.md §2) is "each Node process = a separate Worker with its own JS context". `kernel.spawnWorker` delivers this when `isSabIpcSupported() && getKernelWorkerUrl()`. But `child_process.spawn`/`fork` fall back to an in-realm path (`new Function`/same-realm exec) when the SAB/worker-url gate is unmet — children then run inside the parent realm with no `globalThis` isolation. M6 acceptance "Process = Web Worker (real Worker per child, not new Function in the parent realm)" stays open for that fallback.
## Options / Next
The fallback exists because non-isolated dev/Node lacks the SAB+worker-url prerequisite. Fork part-resolved 2026-08-28 (epic `epics/no-coi-sandbox-tier` Decisions): in the no-COI tier the in-realm path stays as the honest degraded mode — warned once + capability-reported, never masquerading as isolated. Remaining scope HERE: whether the COI world retires the fallback entirely. Tied to runtime-js/parallel-worker-threads (same gate) and to the kernel server-process work.
## Reversibility
REVERSIBLE — internal dispatch choice in runtime-js/kernel; no public-API change. The decision of whether to retire the fallback is a scope call, not a wire change.
