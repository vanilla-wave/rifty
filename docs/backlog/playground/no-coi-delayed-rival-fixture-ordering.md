---
area: playground
status: draft
title: Remaining delayed resident-rival fixture races admission on Firefox CI
created: 2026-09-28
why: a 20 ms timer can bind the rival before startBin admission and falsify the fixture's expected ownership error
sources: [docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md, docs/backlog/distribution/reference/agent-bench-ci-resident-evidence.md]
code: [tests/no-coi/no-coi-dev-hmr.spec.ts, packages/workbench/src/workers/resident-node-entry.ts]
---

## Context

Finding. Manual CI run 36356372850, Firefox 150.0.2 / Ubuntu: the delayed-rival
case at `no-coi-dev-hmr.spec.ts:454` receives generic `Error: resident port
5196 is already in use`, expecting `SandboxResidentPortOwnershipError`.
Same unchanged case passed the local full Firefox run.

The fixture arms a rival after 20 ms, awaits the eval response, then sends
`startBin`; its ordering is not established. The exact returned error is the
product's pre-bound-port admission branch. This matches the prior sibling
fixture fault documented in `agent-bench-ci-resident-evidence.md`; that repair
missed this remaining 20 ms scheduler. Exact port-5196 delayed-admission RED
still belongs to pickup; no product behavior change is indicated.

Owner: no-COI test harness. Trigger: next harness reliability repair. Dedup:
the prior sibling repair is completed evidence; no current item owns this
remaining scheduler. Deferred by the browser-floor record-only run.
