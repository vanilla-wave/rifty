---
area: runtime-js
status: draft
title: "`Worker#terminate()` before the worker starts reports `'exit'` 0 and resolves 0, as in Node"
created: 2026-09-25
why: Node reports `'exit'` 0 / `terminate()` 0 for a Worker terminated before it starts; rifty reports 1 and still spawns the kernel Worker from the queued `start()`, which nothing observes afterwards
sources: [docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md, docs/backlog/runtime-js/worker-threads-handle-keepalive.md, docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-final-green.json]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

REV-12 discovery of `runtime-js/worker-threads-handle-keepalive`
(vitest-run-in-browser item 8; unit Out of scope). It predates that unit.

Node v24.16.0, probes in evidence §Discoveries:
`new Worker(…)` then `terminate()` in the same tick → `P|exit 0` /
`P|terminate 0` (p17, 6/6); after `'online'` → `exit 1` / `terminate 1`
(p18, 4/4).

Rifty: the constructor queues `start()` (`worker_threads.ts:144`
`queueMicrotask(() => this.start())`); `terminate(code = 1)` finishes with 1
before that microtask runs, and `start()` still spawns the kernel Worker,
which is never observed or stopped afterwards.

## Next

Owner runtime-js (worker lifecycle, ADR-0446). Trigger: a claimed consumer
terminating a Worker in its construction tick (pool shutdown right after
spawn). Parity first: p17/p18 as `worker_threads` cases, plus "no kernel
Worker spawned after a pre-start terminate" as a fault row.
