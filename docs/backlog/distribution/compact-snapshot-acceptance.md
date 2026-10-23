---
area: distribution
status: draft
title: Prove compact dependency snapshots through the public no-COI SDK journey
created: 2026-10-23
why: The compact producer/apply/build/reopen/reapply result has no executable acceptance proof yet.
epic: compact-dependency-snapshots
sources: [docs/backlog/epics/compact-dependency-snapshots/goal.md, docs/backlog/playground/reference/replay-cache-profile-refine-2026-10-23.md]
code: [tests/integration/no-coi-snapshot-browser-proof.mjs, tests/integration/workbench-packed-consumer.mjs, packages/workbench/src/glue/dep-snapshot-producer.ts, packages/workbench/src/workers/no-coi-snapshot-application.ts]
---

## Context

First unit: compile the goal's existing scenario into a real public-producer /
native-browser carrier and commit its meaningful RED as expected-failure.
Do not implement the profile in this unit. Current main rejects omitted replay
closure; code and three executed cases are in the evidence source.

Carrier targets: same-input ordinary/compact payload and compressed size (I1),
no-COI apply/read/edit/build/persist/reopen/reapply without acquisition or cache
writes (I2), valid-profile admission plus invalid/legacy compatibility (I3).
Keep explicit install behavior and existing snapshot conflict/persistence
guarantees from the scenario. Unit faults supplement the composed browser run;
no fake producer/tree/compiler or opt-in lane may close acceptance.

At PICKUP choose the profile API/format with its ADR, record fixture versions,
reuse the existing real Vite build oracle, and prove that the expected-failure
carrier fails on missing behavior rather than unavailable infrastructure.
Later implementation turns that same carrier GREEN.

## Decisions

- 2026-10-23 — first unit carries goal I1–I3; any later split follows its actual run, not speculative implementation layers.
- 2026-10-23 — premise inherited from the goal's post-answer Challenge; Contract+RED still required before new product behavior.
