---
area: distribution
status: ready
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
Implementation follows independent Contract+RED in the same unit. Current main rejects omitted replay
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
Implementation turns that same carrier GREEN.

## Decisions

- re-cut: 2026-10-23 — carrier and its implementation remain one unit/PR; no added scope — trace: none.
- 2026-10-23 — ADR-0547 selects v5/profile compact; missing reader/producer behavior has executed RED.

- 2026-10-23 — first unit carries goal I1–I3; any later split follows its actual run, not speculative implementation layers.
- 2026-10-23 — premise inherited from the goal's post-answer Challenge; Contract+RED still required before new product behavior.

## User scenario

Goal scenario unchanged: public same-input Vite 7.3.6 production, no-COI SDK
apply/read/edit/build, native saved reopen/build, explicit conflict/force reapply.

## Acceptance

1. Public `profile: 'compact'` emits v5, identical prepared payload and smaller
   gzip than default replay output; no replay namespace. Packed producer pair
   in `produce-vite-snapshot.mjs`. → I1
2. Packed SDK runs both ordinary and compact journeys, including native OPFS
   reopen and reapply; compact preserves a warm shared-cache sentinel and writes
   no replay entries. No registry/Eddy requests. → I2
3. Compact JSON/tar admission retains identity/lock/path validation; unknown or
   ambiguous profile and smuggled replay bytes reject before mutation. Old readers
   reject v5. Ordinary closure/SRI and legacy suites remain unchanged. → I3

## Fault matrix

- corrupt-input × profile/lock/payload: reject before FS/flush; compact contract
  negative cases plus existing malformed tar tests. → I3
- poisoned-cache × ordinary replay: preserve exact closure/SRI rejection;
  compact has no cache namespace and never touches existing shared entries. → I3
- quota-perm-fail/torn-state × native payload persistence: existing loud failure
  and usable independent saved files; packed compact journey repeats existing
  interruption/quota checks, no added crash atomicity. → scenario

## Out of scope

Goal exclusions unchanged; no new install policy or offline reinstall promise.

## Challenge

challenge: 2026-10-23 — clear
Inherited unchanged goal premise and post-answer review.
