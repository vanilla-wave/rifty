---
area: toolchain-build
status: draft
title: Parity-runner physical-worker cases red under host load at the harness's 10 s drain cap
created: 2026-11-25
why: A `test:parity` red that a rerun clears costs every local `pnpm pr:check` a second run and trains agents to rerun a red gate; reported seven times in five days, once in CI (2026-11-26).
sources: [docs/process/traps.md, docs/backlog/epics/node-file-entry-parity/ledger.md, docs/backlog/runtime-js/reference/pr-425-final-green.json, docs/public/compat/process.md, PR-425-author-run, PR-431-cross-review, PR-441-author-run, PR-474-author-run, https://github.com/vanilla-wave/rifty/actions/runs/45839749821/job/139983536138]
code: [tools/node-parity-runner/src/run-in-rifty.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, tools/node-parity-runner/cases/worker_threads/exec-argv-startup.case.ts, tools/node-parity-runner/cases/process/exit-lifecycle-child.case.ts]
---

## Context

Mechanism: the rifty side of the runner ends a case with
`awaitDrain({ capMs: isPhysicalWorkerCase(testCase) ? 10_000 : 1_000 })`
(`run-in-rifty.ts`); past the cap `event-loop-keepalive.ts` rejects with `child realm
exceeded keepalive drain cap (10000ms) — suspected hang or leaked handle (N active
ref(s))`. Physical-worker kinds: `worker-env`, `child-worker`, `node-cli-eval`.

Observed on one machine (macOS arm64), load from other agent sessions on it (not
controlled), and once on a GitHub `ubuntu-24.04` runner:

| date | case | load average | rerun | source |
|---|---|---|---|---|
| 2026-11-22 | `worker_threads/exec-argv-startup` | not recorded for the red (the same entry's perf line: ~250) | green alone | `epics/node-file-entry-parity/ledger.md`: "drain-cap timeout under load, green alone" |
| 2026-11-23 | `worker_threads/exec-argv-startup` | ~38 | 3/3 green in isolation | PR #425 author's run report (`pnpm pr:check`); in the tree only as the concern in `pr-425-final-green.json` |
| 2026-11-24 | `process/exit-lifecycle-child` | 17–70 | first red, second green | PR #431 cross-review delegate's run report (`pnpm pr:check`); not in the tree |
| 2026-11-24 | `worker_threads/exec-argv-startup` | ~13 | full `test:parity` green ("all cases match") | PR #441 author's run report (`pnpm pr:check`); not in the tree |
| 2026-11-25 | `process/exit-lifecycle-child` | 25–49 | red again alone (`pnpm test:parity process/exit-lifecycle-child`, twice) under that load; GitHub checks green on the same head | PR #460 author's run (`pnpm pr:check` at `70d9be2fa`): `keepalive drain cap (10000ms) … (3 active ref(s))`, holders not captured |
| 2026-11-26 | `process/exit-lifecycle-child` (3 refs), `worker_threads/exec-argv-startup` (2 refs) | 4–7 at the reruns | both red again alone; `exit-lifecycle-child` red alone on the base tree `ebaf4945c` too | PR #474 author's run (`pnpm pr:check` at `b483b7ff5`, diff: an isolate-host test + docs); holders not captured |
| 2026-11-26 | `process/exit-lifecycle-child` (3 refs) | CI runner | **first CI red**: `unit-and-conformance (parity)`, PR #474 head `9dde248ef` (no parity input in its diff; main `ebaf4945c` green) | run 45839749821, job 139983536138; holders not captured |

The 2026-11-25 and 2026-11-26 rows quote `keepalive drain cap (10000ms)`; the first two
say only "drain-cap timeout", so that they hit this 10 s cap and not the product's 30 s one
is an inference. GitHub checks were green at the heads of PRs #425, #431 and #441 when they
merged. Load does not explain all reds: the 2026-11-26 local reds came at load 4–7 (12
CPUs), red alone and on a base tree whose CI was green; a case can stay red in isolation
(2026-11-25, 2026-11-26 rows); no controlled repro attempted (untried: the `yes`-process
stand of `distribution/isolate-host-time-phase-rows-under-load`). Nearest
earlier statement of the mechanism: `docs/public/compat/process.md` — the cap is
wall-clock, so a CPU-busy worker can trip it.

Open, not established: whether the drain is only late (a starved worker that would settle)
or a ref a slow schedule really leaves behind — no observer recorded the message's
`N active ref(s)` holders (counts only: 3 for `exit-lifecycle-child`, 2 for
`exec-argv-startup`). The ~13 load of the 2026-11-24 #441 row and the 4–7 of the
2026-11-26 local row are low for plain starvation.

Rule, by analogy (the bound here is the harness's cap, not a test's assertion):
`docs/process/traps.md` wall-clock-assertion-under-load — assert the event, not the time;
a time bound stays only with a stall injected at the judged point as its RED.

Owner: toolchain-build (parity runner). Trigger: the same message in CI, or the next
local red — capture the ref count and its holders before rerunning. **Trigger fired
2026-11-26** (CI row above); pickup per the user's decision.

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
