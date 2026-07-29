---
area: process-meta
status: draft
title: Bounded autonomous epic runs — orchestration, tripwire automation, escape-rate trial
created: 2026-07-22
why: PR-176 adds frozen goal, residual accounting, one-slice budgets, and a bounded coordinator; the remaining work is adoption measurement and honest scope/mechanism detectors, not completion semantics
sources: [workbench-retro-2026-07, PR-161, PR-162, PR-176]
code: [tools/review/blockers.mjs, tools/checks/goal-contract.mjs]
---

## Context

PR #176 owns run semantics in `decision-workflow.md` §Autonomous goals plus goal/budget/contract checks.
Remaining: run one mid-size epic and compare escaped horizontal defects with the
workbench baseline. Promote only honest detectors: scope-to-unit mapping, full
mechanism inventory, review-count tracking, and explicit run membership. Until
then, review owns them.

Exploit-hardening detectors (2026-07-25 six-agent audit): posted verdict
artifacts + SHA-lineage review counter (kills retry-until-green via slice
rename); reviewed-SHA == merge-head binding; falsified-on-main proof per epic
invariant (kills trivially-true `## Invariants`).

Field evidence 2026-07-26 (recipe-v2 authority, PR #180–#195): eleven abandoned
draft PRs from one over-broad contract — every Contract+RED blocker minted a
fresh PR, resetting attempt counts (the predicted retry-until-green shape, by
literal reading not malice). Root cause: the PR opened at Contract+RED under a
two-checkpoint cap — both removed by `AGENTS.md` §PR — unit of delivery; the SHA-lineage
counter + posted-verdict detectors remain the mechanical kill.

Repeat 2026-07-28 (honest-shadow-substitutions, PR #206–#223): 17 PRs on ~5,000
net lines; 7 of 13 merged carried zero production source. Same cap, plus two
agent over-reads (a second parallel reviewer per checkpoint; intake/ready-flip/
lineage each given its own docs PR).

## Residual — machine gates still mandate a second PR

§PR is canon, but four gates encode PR-as-unit-of-process and were left
untouched; each is a reachable §PR violation, not an ergonomics nit. Reproduced
against `5296991f5`:

- `tools/checks/budget.mjs:88` — epic must exist at merge-base, so a goal's
  bootstrap cannot ride the delivering branch: first slice PR of every new goal
  exits 1. Keeps `backlog/README.md:61-65` §Autonomous goal 1–2 mandating a
  contract-only bootstrap PR.
- `tools/checks/contract-drift.mjs:81-84` (pinned by `contract-drift.test.ts:55`)
  rejects an in-place `ready`→`draft` edit in the post-pickup diff, and pickup
  freezes at the first source commit — so `decision-workflow.md:51-53` mid-build
  demotion has no legal in-PR path and keeps its separate-PR mandate.
- `tools/checks/budget.mjs:136-143` counts `docs/**` against the slice insertion
  band (only `generated` globs and test-support are skipped). Absorbing
  discoveries into the branch consumes the band, whose canonical remedy is
  "re-cut the slice" — the split §PR removes. `backlog/README.md:94` still
  defines the band at PR scope.
- CI is `pull_request`/`merge_group`/`push→main` only (`.github/workflows/ci.yml:3-8`),
  so moving PR-open to Final+GREEN would leave the branch with zero CI until the
  merge candidate. `rifty-review` SKILL.md:6,:51 also hardcode "the PR body" as
  checkpoint review input. PR-open timing therefore stays at first Contract+RED.

Each needs a RED test before its fix (`contract-drift.test.ts:211` pins the
current `beside source` message and must be re-cut, not edited green).
