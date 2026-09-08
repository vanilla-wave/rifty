---
area: distribution
status: ready
title: Run a snapshot-backed Workbench without a browser registry
created: 2026-09-07
why: The public options require a registry URL and first-snapshot rejection schedules a real install.
user_story: As the Tracker plugin-sandbox embedder, I want to run a snapshot-backed workbench without a browser registry, but today the public options require a registry URL and first-snapshot rejection schedules a real install.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/distribution/reference/workbench-snapshot-only-evidence.md, ADR-0400, ADR-0396, ADR-0263]
code: [packages/workbench/src/workbench/internal/workbench-options.ts, packages/workbench/src/workbench/owner-protocol.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/owner-package-state.ts]
---

## Context

Public `packageAcquisition.registryUrl` is required (ADR-0263). Internal
snapshot-only ensure exists, but first-materialization catches
`snapshot-unavailable` and returns deferred install. I8 now owns when a
snapshot is required. Evidence:
`reference/workbench-snapshot-only-evidence.md`.

## User scenario

The embedder opens Workbench with `packageAcquisition: {}` (no registry, no
Eddy) and first-seeds a snapshot-backed Scratch. A compatible snapshot
restores without a registry or Eddy request and without scheduling
`npm install`. A missing or id-mismatched snapshot required by I8 fails
before guest start and does not become deferred install. Reopening a valid
saved Scratch with an unused new snapshotId under initial-only still does
not fetch that asset.

## Acceptance

1. `packageAcquisition: {}` (omitted `registryUrl` and `eddy`) is valid Workbench admission; Eddy still requires `registryUrl` (`packageAcquisition.eddy requires packageAcquisition.registryUrl`). `workbench-snapshot-only.contract.test.ts` admission cases. → I3 → ADR-0400
2. A required snapshot that is missing, corrupt, or identity-mismatched rejects before guest start and does not return `kind: 'install'`. `workers/workbench-snapshot-only.contract.test.ts` unrestorable cases; registry-present deferred-install cases stay. → I3 → ADR-0400
3. Snapshot-only restore and later package/terminal commands make zero registry/Eddy requests; absent exact bytes fail loudly rather than network-install. Same workers file compatible-restore plus later `npm install left-pad` case. → I3
4. A compatible required snapshot restores as `kind: 'ready'` and does not schedule install. Same workers file compatible-restore case. → I3 → ADR-0400

## Fault matrix

- Corrupt/incompatible required snapshot × first seed or apply: reject before guest start; no deferred install. Same file identity/404 cases. → I3 → ADR-0400
- Unused new snapshot × initial-only reopen: unused asset is not fetched and does not fail snapshot-only admission. Existing I8 no-fetch case. → I3 → ADR-0396

## Out of scope

Storage namespace, orphan recovery, preview prefix, and operation budgets
remain named siblings. The composed packed-host Vite run of a published
producer tar.gz is I7 (plus the I1 packed residual). Registry-enabled
acquisition keeps deferred install. Guest application network is unchanged.
Retired `snapshotUrl` stays retired.

## Decisions

- ready-verdict: 2026-09-08 — Contract+RED @ 67655b61000899083e535251e6fc57e97a16a612
- 2026-09-08 — Final+GREEN PASS @ 085d55b3627533977113b6e86759e20af4576372; advisory leftover spies on the workers harness and I8 unused-reopen carrier.
- 2026-09-08 — ADR-0400: omitted registryUrl+eddy is snapshot-only; required snapshot failure does not become deferred install.
- 2026-09-08 — packed Vite/command proof stays on I7; this unit owns admission, loud required-snapshot failure, zero registry/Eddy requests, and compatible restore without install.
- 2026-09-07 — round 3: compose the separate generic application-policy authority; registry admission never chooses which existing files to overwrite.
- 2026-09-07 — finding draft; observable scope is settled by goal I3; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-08 — clear
