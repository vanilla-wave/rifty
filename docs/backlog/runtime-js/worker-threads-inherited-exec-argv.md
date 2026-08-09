---
area: runtime-js
status: draft
title: Worker threads must inherit trusted Node execArgv
created: 2026-07-30
why: A path Worker created by a Node eval process currently receives empty execArgv, while Node inherits the original CLI identity recursively and ignores later public-array mutation.
user_story: As a CLI spawning worker threads, I want each thread to observe the same effective Node options as its parent unless I explicitly override them.
sources: [ADR-0267, ADR-0339, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

Node v24.16.0 path Workers created under `node -e` inherit the original
source-bearing `process.execArgv`, including recursively. Mutating the public
parent array before construction does not change that trusted snapshot;
`WorkerOptions.execArgv` supplies an explicit override.

Node-entry v3 deliberately retained its exact worker-thread variant without an
`execArgv` field. Extending it permissively would contradict ADR-0267/0339, and
seeding the worker with `[]` would lie. While the inherited identity is
nonempty—or an explicit override is supplied—`Worker` therefore throws
`NotImplementedError('worker_threads.Worker.execArgv')` before thread-id or
physical Worker allocation.

No overlapping item or protocol decision was found on 2026-07-30. Faithful
support requires a newly contracted node-entry protocol version, a superseding
ADR, every worker-thread producer/decoder, and native-versus-physical recursive
identity acceptance. The loud guard ships with the eval slice that first makes
the mismatch reachable; this draft does not choose that future protocol.
