---
area: process-meta
status: draft
title: Keep the local pr:check Vitest lane finite under parallel load
created: 2026-07-15
why: pnpm pr:check repeatedly aborts test:run without a failing assertion when its 12-task pool runs full Vitest beside builds and parity, while the identical Vitest suite passes standalone
user_story: As a rifty contributor, I want the mandatory local PR gate to distinguish a code regression from host resource starvation, but today a green standalone suite can abort silently only inside pr:check
sources: [tools/checks/pr-check.mjs]
code: [tools/checks/pr-check.mjs]
---

## Context

Observed four consecutive times while validating PR #145:

- `pnpm pr:check` used `availableParallelism() = 12`; `test:run` exited 1 after
  44.9–46.5 s while `build:libs` and `test:parity` completed;
- Vitest printed only passing files, stopped at a different file each run, emitted
  no `FAIL`, assertion, worker error, or suite summary, then pnpm printed
  `[ELIFECYCLE] Command failed with exit code 1`;
- `pnpm vitest run --reporter=dot --bail=1` over the same tree passed standalone
  (526 files / 6259 tests before the final added palette test).

Recurred twice on the Workbench Vite vertical SHA `9397feaf`: `test:run`
aborted after 48.7–53.2 s with no failed assertion while every sibling check
finished. The identical standalone suite passed (539 files / 6551 tests), and
full Vitest also passed beside `build:libs`; a Vite false sourcemap warning was
non-fatal. The gate needs child signal/resource telemetry before choosing its
bounded concurrency policy.

This points to the gate's host-load envelope, not a repeatable product test
failure. Refine with bounded-concurrency measurements and the exact child exit
signal/resource telemetry. The fix must keep every current check and must not
raise test timeouts or hide a real Vitest failure.
