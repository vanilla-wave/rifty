---
area: runtime-js
status: draft
title: A Worker started by a `node -e` parent inherits its eval execArgv
created: 2026-07-30
why: Node's path Worker under `node -e` inherits the eval parent's source-bearing execArgv (recursively, public-array mutation ignored); rifty throws `NotImplementedError('worker_threads.Worker.execArgv')` naming the inherited `-e`/`--eval` token.
user_story: As a user running `node -e "new Worker('./w.js')"`, I want the Worker to start as in Node, but today it throws a named unsupported-startup-option error.
sources: [ADR-0267, ADR-0339, ADR-0449, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/runtime-js/src/builtins/worker_threads-launch.ts, packages/runtime-js/src/internal/node-startup-options.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts]
---

## Context

Narrowed 2026-09-25 (land of `runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md`,
ADR-0449): explicit `WorkerOptions.execArgv` and default inheritance of a
program parent's `-r`/`-C`/`--experimental-import-meta-resolve` tokens ship
(node-entry v6 carries the exact snapshot). Only the eval parent remains.

Node v24.16.0 path Workers created under `node -e` inherit the original
source-bearing `process.execArgv`, including recursively. Mutating the public
parent array before construction does not change that trusted snapshot
(`reference/node-v24.16.0-cli-eval-probe.md`).

rifty: `resolveWorkerLaunch` (`worker_threads-launch.ts`) inherits the
parent's launch tokens; the startup-option compiler accepts only the three
ADR-0449 families, so an inherited `-e <source>` is
`NotImplementedError('worker_threads.Worker.execArgv')` before thread-id or
physical Worker allocation (ADR-0449 §3). An explicit `execArgv` from an eval
parent works.

Open: carrying the eval pair means an eval-aware compiler/decoder and
recursive native-vs-physical identity acceptance (ADR-0267/0339 versioning).
