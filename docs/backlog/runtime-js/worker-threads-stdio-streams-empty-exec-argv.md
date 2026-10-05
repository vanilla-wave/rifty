---
area: runtime-js
status: ready
title: `worker_threads.Worker` exposes `stdout`/`stderr` Readables and accepts an explicit empty `execArgv`
created: 2026-09-15
why: vitest's threads pool does `new Worker(entry, { env, execArgv: [], stdout: true, stderr: true })` then `thread.stdout.pipe(...)`; rifty threw `worker_threads.Worker.execArgv` for any own `execArgv` (even `[]`) and its Worker had no stdout/stderr streams
user_story: As a test runner in the browser shell, I want my pool worker's console output piped into `worker.stdout` like on my machine, but today the Worker has no streams and the explicit-empty execArgv kills construction
epic: vitest-run-in-browser
blocked_by: [runtime-js/worker-threads-handle-keepalive]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/worker-threads-inherited-exec-argv.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## User scenario

Goal I5: vitest's threads pool constructs
`new Worker(entry, { env, execArgv: [], stdout: true, stderr: true })` (evidence
§I5); today the own-property `execArgv` throws
`NotImplementedError: worker_threads.Worker.execArgv` at construction and
`Worker` exposes no `stdout`/`stderr` (main 51440931a).

## Context

Oracle (Node v24.16.0, host re-run 2026-10-05): `new Worker(file,
{ execArgv: [], stdout: true, stderr: true })` → `typeof w.stdout === 'object'`,
`typeof w.stdout.pipe === 'function'`, the worker's `console.log`/`console.error`
are captured from the streams (`"from-worker\n"`, `"werr\n"`) and not printed by
the parent; streams are `null` without the options. `worker-threads-inherited-
exec-argv` owns non-empty inheritance identity; this unit accepts ONLY the
explicit-empty spelling. Depends on the keepalive handle (landed) for the
parent to survive until the worker reports.

## Acceptance

1. `new Worker(entry, { execArgv: [], stdout: true, stderr: true })`
   constructs; `worker.stdout`/`worker.stderr` are Readables (`typeof
   'object'`, `.pipe` a function) available SYNCHRONOUSLY at construction
   (`→ I5`).
2. The worker's `console.log`/`console.error` bytes arrive on the streams and
   are NOT printed by the parent; the streams end after the worker exits
   (`→ I5`).
3. A non-empty `execArgv` keeps today's loud
   `NotImplementedError('worker_threads.Worker.execArgv')` (baseline ceiling,
   `worker-threads-inherited-exec-argv`) (`→ I5` named baseline).
4. Without the options `worker.stdout`/`worker.stderr` are `null` (Node shape)
   (`→ I5`).

## Parity cases

Node v24.16.0 oracle (executed 2026-10-05, captured output above). RED target:
`worker_threads/stdio-streams-empty-exec-argv.case.ts` — failed today on the
rifty side with `TypeError: Cannot read properties of null (reading 'pipe')`
(run before the fix, 2026-10-05).

## Out of scope

- Non-empty `execArgv` identity — `runtime-js/worker-threads-inherited-exec-argv`.
- `eval: true` Worker entries — `runtime-js/worker-eval-data-url-entry`.
- Same-realm fallback piping (its console is the realm's own; the kernel path
  is the claimed carrier).

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| non-empty execArgv | `new Worker(f, { execArgv: ['--x'] })` | loud `NotImplementedError('worker_threads.Worker.execArgv')`, no thread allocated (`→ I5` named baseline) |
| trailing output | worker prints, then exits | wrapper streams end AFTER the sealed output drains (hold a keepalive ref until end) — no dropped trailing chunk, no drain-cap hang (`→ I2/I5`) |

## Challenge

challenge: 2026-10-05 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); oracle re-executed on host 2026-10-05

## Decisions

- 2026-10-05 — agent (PICKUP): carrier = construction-time wrapper Readables
  (stable identity for listeners attached right after `new Worker`), fed from
  the kernel handle's stdio streams; the wrappers end at the HANDLE streams'
  end (sealed output drains after exit), holding a keepalive ref until then —
  an open pipe holds the loop in Node. `execArgv` accepted iff an explicit
  empty array.
- 2026-10-05 — agent (PICKUP): harness (`worker-env-kernel-worker.ts`) wires
  the worker-thread child's console to its stdio ports (mirrors
  node-entry-bootstrap, which that lighter path skips).
