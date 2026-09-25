---
area: runtime-js
status: draft
title: "After a vitest pool-start failure the process exits on the pool's terminate timer, not vitest's `close timed out` teardown"
created: 2026-09-25
why: Node exits when vitest's ref'd pool terminate timer fires; rifty is still alive when vitest's unref'd `exit()` teardown timer fires and prints `close timed out after 10000ms` / `… prevents Vite server from exiting`, lines Node does not print
sources: [docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md, docs/backlog/runtime-js/reference/vitest-run-acceptance-final-green.json, docs/public/compat/vitest.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

REV-12 discovery of `runtime-js/vitest-run-acceptance` (vitest-run-in-browser
item 12; Final+GREEN Scope concern; evidence §Observation — teardown after a
pool-start ceiling). Unclaimed-mode error path only: claimed runs close
normally; exit code 1 and the named ceiling already match Node.

- Node v24.16.0, same project, pool Worker start throws (`test.execArgv:
  ['--bogus-flag']`, `--pool=vmThreads` or `--pool=threads`): `Caused by:
  Error: Initiated Worker with invalid execArgv flags`, `[vitest-pool]:
  Timeout terminating … worker`, exit 1 after 10 s — no `close timed out`.
- rifty, `--pool=vmThreads` / `--pool=vmForks` (execArgv ceiling, ADR-0449):
  same exit 1 after 10 s, plus `close timed out after 10000ms` and `… prevents
  Vite server from exiting` (vitest `cli-api.CnMVyzaz.js:14033-14046`, armed ms
  after the pool timer at `:3550`).
- Root cause undiagnosed: a handle the never-closed Vite server holds in
  rifty, or drain latency after the last ref'd timer.

## Next

Owner runtime-js. Probe first: in rifty, list live keepalive holds when the
pool terminate timer fires (which handle keeps the realm up). Then a fault
row: after a pool-start failure the process exits before vitest's unref'd
teardown timer, output matching Node's lines. Carrier: the vitest e2e
project on `--pool=vmThreads`; whether rifty repeats it on `--pool=threads`
with `test.execArgv: ['--bogus-flag']` — unprobed.
