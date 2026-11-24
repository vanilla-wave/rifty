---
area: toolchain-build
status: ready
title: Draft PRs run only the light CI jobs; heavy lanes start when the PR is ready
created: 2026-11-24
why: 60% of PR runs (2026-11-16…24) fired while draft — 428 of 457 runner-hours in heavy lanes, 237 superseded; CI caps at 20 concurrent jobs
user_story: As a user running 5–10 agents in parallel, I want draft pushes to leave runners free, but today every draft push queues 19 jobs / 139 runner-minutes
sources: [manager thread cf2ae711-949d-43c2-8cfa-b6866a78402b, user "да" to "heavy checks only on ready PR"]
code: [.github/workflows/ci.yml, tools/checks/ci-gate.mjs]
---

## Challenge

challenge: 2026-11-24 — none (user chose the direction: "да"; manager's profile is the evidence; external review runs on the PR)

## User scenario

Agent opens PR as draft, pushes 3×: each run = `Change scope`, `lint-and-typecheck`,
`CI gate` only; marks ready → full run on the head; further pushes → full run each.

## Acceptance

1. Draft PR push → jobs of that run: only the 3 light jobs execute; heavy jobs `skipped`, no runner (run jobs API on this PR) → scenario
2. Draft → ready → full run on the same head SHA → scenario
3. Push to ready PR → full run; back to draft + push → light run again → scenario
4. Code-affecting draft: `CI gate` concludes `failure` with "draft PR: heavy lanes withheld" (`gh pr checks --json bucket` = `fail`) — never `skipped`/green → ADR-0323
5. push to `main` / `merge_group`: unchanged full gate (no PR payload → `!draft` true); change-scope death on ready PR still fails open → ADR-0323
6. Workflow contract + reducer covered by `tools/checks/ci-change-scope.test.ts`, `tools/checks/ci-gate.test.ts` → ADR-0323

Evidence (PR #446): draft runs 45453748956 (`420323cc7`) and 45455993791 (`6bb847dfb`, after ready→draft + push): 3 light jobs, heavy `skipped` without runner, gate red. Runs 45454866951 (`ready_for_review`, `420323cc7`) and 45455294277 (ready push, `bc0738faf`): full matrix expanded, then `cancelled` by the next push — heavy never ran. Completed full green: 45457070784 (`ready_for_review`, `6bb847dfb`).

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| change-scope dies × ready PR | heavy lanes run (fail open), gate red naming it | `ci-gate.test.ts` dead-classifier rows | → ADR-0323 |
| change-scope dies × draft PR | heavy withheld, gate red with both errors | `ci-gate.test.ts` draft+dead row | → ADR-0323 |
| draft-era run re-run after ready | payload snapshot stays `draft: true` → light run, gate red; re-run the `ready_for_review` run instead | traps `ci-draft-light-run` | → ADR-0323 |
| push and ready events race | later-queued run cancels earlier (`ci-pr-N`); if light run wins, gate red on head (fail-closed), never false green | traps `ci-draft-light-run` | → ADR-0323 |

## Out of scope

- Branch protection / ruleset enablement (both disabled on `main` today; merge stays gated by DoD reading `gh pr checks` states).
- `converted_to_draft` trigger.

## Decisions

- Draft code gate = red, not skipped/green: skipped counts as passed for protection; red stays fail-closed through ready → full run.
- Docs-only draft gate green: nothing applicable withheld; ready re-runs same set.
- Condition on `github.event.pull_request.draft` in job `if`, not classifier output: keeps docs-only/draft verdicts distinct; null on push/merge_group.
- No `converted_to_draft` trigger: an in-flight full run on that head stays valid; next push cancels it anyway.
