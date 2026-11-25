---
area: toolchain-build
status: draft
title: Parity-runner physical-worker cases red under host load at the harness's 10 s drain cap
created: 2026-11-25
why: A `test:parity` red that a rerun clears costs every local `pnpm pr:check` a second run and trains agents to rerun a red gate; four agent runs hit it in three days.
sources: [docs/process/traps.md, docs/backlog/epics/node-file-entry-parity/ledger.md, docs/backlog/runtime-js/reference/pr-425-final-green.json, PR-431-cross-review, PR-441-author-run]
code: [tools/node-parity-runner/src/run-in-rifty.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, tools/node-parity-runner/cases/worker_threads/exec-argv-startup.case.ts, tools/node-parity-runner/cases/process/exit-lifecycle-child.case.ts]
---

## Context

Mechanism: the rifty side of the runner ends a case with
`awaitDrain({ capMs: isPhysicalWorkerCase(testCase) ? 10_000 : 1_000 })`
(`run-in-rifty.ts`); past the cap `event-loop-keepalive.ts` rejects with `child realm
exceeded keepalive drain cap (10000ms) — suspected hang or leaked handle (N active
ref(s))`. Physical-worker kinds: `worker-env`, `child-worker`, `node-cli-eval`.

Observed on one machine (macOS arm64; Node v24.16.0 where the run recorded it), load from
other agent sessions on it (not controlled), each reported by the agent that ran it:

| date | where | case | load average | rerun |
|---|---|---|---|---|
| 2026-11-22 | PR #421 author, `pnpm test:parity` (goal ledger) | `worker_threads/exec-argv-startup` | ~250 | green alone |
| 2026-11-23 | PR #425 author, `pnpm pr:check` | `worker_threads/exec-argv-startup` | ~38 | 3/3 green in isolation |
| 2026-11-24 | PR #431 cross-review delegate, `pnpm pr:check` | `process/exit-lifecycle-child` | 17–70 | first red, second green |
| 2026-11-24 | PR #441 author, `pnpm pr:check` | `worker_threads/exec-argv-startup` | ~13 | full `test:parity` green ("all cases match") |

Rows 3–4 quote the cap message; rows 1–2 are recorded as "drain-cap timeout" without the
text. PR CI was green at each of those PR heads. Not reproduced on an idle machine; no
controlled repro attempted (untried: the `yes`-process stand of
`distribution/isolate-host-time-phase-rows-under-load`).

Open, not established: whether the drain is only late (a starved worker that would settle)
or a ref a slow schedule really leaves behind — no observer recorded the message's
`N active ref(s)` or what held them. The ~13 load of the last row is low for plain
starvation.

Rule: `docs/process/traps.md` wall-clock-assertion-under-load — no bigger cap; an event at
the judged point, or a stall injected there as the RED.

Owner: toolchain-build (parity runner). Trigger: the same message in CI, or the next
local red — capture the ref count and its holders before rerunning.

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
