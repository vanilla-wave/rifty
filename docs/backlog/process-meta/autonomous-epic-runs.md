---
area: process-meta
status: draft
title: Bounded autonomous epic runs — orchestration, tripwire automation, escape-rate trial
created: 2026-07-22
why: PR-176 adds frozen goal, residual accounting, one-slice budgets, and a bounded coordinator; the remaining work is adoption measurement and honest scope/mechanism detectors, not completion semantics
sources: [workbench-retro-2026-07, PR-161, PR-162, PR-176]
code: [tools/review/blockers.mjs]
---

## Context

PR #176 owned run semantics in `decision-workflow.md` (now §Goal runs + `rifty-goal`); the marker/budget gates retired with goal artifact v2 (2026-08, `epics/TEMPLATE.md`).
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

## Residual — resolved 2026-08

Goal artifact v2 removed `check:budget`/`check:goal-contract` and the
`goal_baseline` marker: a goal bootstrap rides any PR, bands live in the goal
ledger (review-owned). Remaining draft scope = the detector ideas above
(SHA-lineage counter, posted verdicts, falsified-on-main invariant proof) —
promote only with field evidence.
