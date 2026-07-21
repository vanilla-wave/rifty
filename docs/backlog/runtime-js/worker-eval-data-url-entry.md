---
area: runtime-js
status: draft
title: Worker eval and data-URL entry execution
created: 2026-07-19
why: Node executes eval source and data-URL Worker entries, while rifty now rejects these unsupported success paths loudly
user_story: As a Node-program author spawning inline Worker code, I want eval and data-URL entries to execute instead of stopping at a directed NotImplementedError.
blocked_by: []
sources: [Node 24.16 worker_threads]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

PR #159 closes the shared constructor-validation boundary: path strings, URL
objects, argument types, cwd anchoring, error priority, and thread-id allocation
match Node. Two Node-success paths remain explicit gaps:

- `new Worker(source, { eval: true })` throws
  `NotImplementedError('worker_threads.Worker.eval')` synchronously.
- `new Worker(new URL('data:...'))` is accepted and allocates a thread like Node,
  then emits `NotImplementedError('worker_threads.Worker.data-url')` and exits 1.

Node 24.16 does not synchronously reject `.ts`, `.md`, or other extensions; entry
format/loading errors belong to execution, not constructor validation.
