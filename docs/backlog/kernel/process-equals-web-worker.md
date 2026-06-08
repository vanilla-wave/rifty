---
area: kernel
status: active
title: "Process = Web Worker" for every child (drop the in-realm new Function fallback)
created: 2026-06-08
why: M6 open acceptance — some child_process paths still run as new Function in the parent realm, not a real Worker per child
sources: [A-002, ADR-0011, TASKS M6]
---
## Context
The strategic model (CLAUDE.md §2) is "each Node process = a separate Worker with its own JS context". `kernel.spawnWorker` delivers this when `isSabIpcSupported() && getKernelWorkerUrl()`. But `child_process.spawn`/`fork` fall back to an in-realm path (`new Function`/same-realm exec) when the SAB/worker-url gate is unmet — children then run inside the parent realm with no `globalThis` isolation. M6 acceptance "Process = Web Worker (real Worker per child, not new Function in the parent realm)" stays open for that fallback.
## Options / Next
The fallback exists because non-isolated dev/Node lacks the SAB+worker-url prerequisite. Next: decide whether the in-realm path stays as an honest degraded mode (documented in compat) or is removed once COI is guaranteed; if kept, ensure it never silently masquerades as isolated. Tied to real-worker-threads (same gate) and to the kernel server-process work.
## Reversibility
REVERSIBLE — internal dispatch choice in runtime-js/kernel; no public-API change. The decision of whether to retire the fallback is a scope call, not a wire change.
