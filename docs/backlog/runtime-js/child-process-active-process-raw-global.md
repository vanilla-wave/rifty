---
area: runtime-js
status: draft
title: "`child_process` spawn/fork defaults (env, cwd, stdio, pid) read the realm's `node:process`, not a raw `globalThis.process`"
created: 2026-09-25
why: "`activeProcess()` falls back to `globalThis.process` when no node-entry bootstrap is active, while `node:process` selects the active bootstrap, a live `NodeProcess` or `riftyProcess`; item 11 moved only `fork`'s `execArgv` default to `publicNodeProcess()`, so the other defaults can still come from a different process object"
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md, docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json, docs/adr/runtime-js/0458-read-the-realm-bound-node-process-registry-entry-uncached-in-io.md]
code: [packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/builtins/process-public.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md`
(vitest-run-in-browser item 11, evidence §Discoveries). `child_process-worker.ts`
`activeProcess()` (spawn/fork default env, cwd, stdio, pid; `activeProcessStdio()`)
reads the active bootstrap, else a raw `globalThis.process`.

Observed only in the in-process parity harness, where the raw global is the
host Node process: before `fork`'s `execArgv` default moved to
`publicNodeProcess()`, `child_process/public-ipc-advanced-options` and three
sibling fork cases threw `NotImplementedError: … startup option '--import'`
(the host worker's `["--import","tsx"]`; IMPLEMENT run 2026-09-25).

No product user-action path shown yet (gate 2): whether a Workbench/Chromium
realm can reach the fallback with `globalThis.process !== node:process` is the
open question.

## Next

Owner runtime-js. Probe: a product realm where `node:process` and
`globalThis.process` differ (reassigned global, same-realm fallback) spawning
with default env/cwd/stdio. If reachable, route all defaults through
`publicNodeProcess()` with a parity/fault row per default.
