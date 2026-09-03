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

Recurred deterministically while validating the PR #136 companion migration on
`ae707dca`. Under the 12-command pool, the first two
`realVite.owner-exit.test.ts` cases spent 5.21 s and 5.08 s in their fresh
dynamic import and hit Vitest's 5 s test timeout; the other 46 cases passed.
That unchanged file passed standalone 48/48 in 2.09 s, and the full standalone
suite passed 593 files / 7623 tests. `build:libs`, `test:parity`, and
Vitest overlapped for 70–84 s in the failing run. This gives the missing exact
failure mode: nested command/test parallelism starves fresh transform work.

This points to the gate's host-load envelope, not a repeatable product test
failure. Refine with bounded-concurrency measurements and the exact child exit
signal/resource telemetry. The fix must keep every current check and must not
raise test timeouts or hide a real Vitest failure.

Recurred 2026-09-03 on a docs-only diff (#305): `test:run` 332 s vs 196 s on
the previous clean run of the same tree; two timeouts
(`apps/landing/src/public-snippets.test.ts` Vite production build 34.9 s > 30 s,
`tools/node-parity-runner/src/run-in-rifty.test.ts` eval-only probe > 5 s)
while another worktree's Vitest run (8 workers) shared the host; both files
pass standalone (5.8 s / 1.8 s). Cross-worktree load is now the common case
(parallel agent runs), so the envelope must assume a shared host.
