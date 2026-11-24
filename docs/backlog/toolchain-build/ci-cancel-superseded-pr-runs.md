---
area: toolchain-build
status: ready
title: A new PR push cancels that PR's unfinished CI run
created: 2026-11-24
why: 238/419 PR runs (2026-11-16…24) were superseded before finishing and burned 464 runner-hours (58% of PR CI) against a 20-job account ceiling; cancelled runs still queued `CI gate` (if always()) up to 124 min
user_story: As a user running 5–10 agent PRs in parallel, I want a new push to free the runners of its PR's stale run, but today the stale run finishes or holds `CI gate` in the queue
sources: [/tmp/rifty-ci-analysis (GitHub API profile, 931 runs)]
code: [.github/workflows/ci.yml]
---

## Context

`ci.yml` has no `concurrency`; `netlify.yml` already cancels per PR. `CI gate`
is `if: always()` (ADR-0323 §4), so a cancelled run still waits for a runner to
run the reducer.

## Challenge

challenge: 2026-11-24 — clear (direction is the user's explicit decision «давай» on the measured profile; no critic)

## User scenario

Agent pushes commit A to a PR, then B before A's `CI` finishes → A's run
concludes `cancelled`, its `CI gate` never takes a runner; B runs the full gate.

## Acceptance

1. Two pushes to this PR inside one run's duration: first run `cancelled` whole, its `CI gate` skipped without a runner (`gh run view` both runs) → scenario
2. A deliberately red commit in a live run: failed job and timed-out (cancelled) job each named by a red `CI gate` → ADR-0323
3. Config quote: push/merge_group get a per-run group, never share a PR's cancel group → ADR-0323

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| run cancelled by newer push × gate | gate skipped, no runner | Acceptance 1 run pair | → scenario |
| job failed in live run × gate | gate red, names job | Acceptance 2 run | → ADR-0323 |
| job timed out in live run × gate | gate red, names job `cancelled` | Acceptance 2 run | → ADR-0323 |
| push main / merge_group × newer run | both run to the end | Acceptance 3 quote | → ADR-0323 |

## Out of scope

Path filters, skipping heavy lanes on draft PRs, sharding, `typescript-worker` pin.

## Decisions

- Group `ci-pr-<N>` for `pull_request`, `ci-run-<run_id>` otherwise: one mechanism, no second guard.
- `CI gate` `!cancelled()` (run-level) replaces `always()`; ADR-0323 correction line.
