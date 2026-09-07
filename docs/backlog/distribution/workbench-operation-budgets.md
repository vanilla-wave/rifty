---
area: distribution
status: draft
title: Configure effective Workbench boot and project-operation wait budgets
created: 2026-09-07
why: Hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
user_story: As the Tracker plugin-sandbox embedder, I want to configure effective workbench boot and project-operation wait budgets, but today hidden owner-ready, storage-proof, file-commit and tool deadlines can defeat a host-selected budget.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/src/workbench/workbench-owner-port.ts, packages/workbench/src/workers/workbench-owner-storage.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/internal/playground-session-tools-transport.ts]
---

## Context

Owner operation silence and preview probe already have public settings.
Remaining host-relevant paths include owner-ready (30 s), OPFS proof (30 s),
project-file commit/durability (60 s), and catalog/SCM/archive tool requests
(60 s). Expose effective budgets for these operations: a larger public budget
must not be cut short by a hidden shorter deadline on the same path. Exact
option grouping is agent-owned; do not blindly export every timer in the repo.

Retain positive finite validation, documented defaults and ADR-0360 silence vs
total-duration semantics. A deadline never proves an admitted mutation did not
apply; preserve applied/unknown/death outcomes and avoid hidden retries. Reuse
existing deadline owners. Deterministic delayed-boundary tests discriminate
short/long settings without promising a device-speed SLA; composed packed-host
acceptance closes the goal after sibling capabilities land. Snapshot byte caps,
TypeScript responsiveness policy and arbitrary guest execution limits do not
change as an incidental effect of these settings.

Scope and user decisions: goal I7. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I7; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
