---
area: service-worker
status: draft
title: Serve Workbench preview inside a host-selected service-worker scope
created: 2026-09-07
why: Fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
user_story: As the Tracker plugin-sandbox embedder, I want to serve workbench preview inside a host-selected service-worker scope, but today fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
epic: self-hosted-snapshot-workbench
blocked_by: [distribution/workbench-static-assets]
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/io/src/preview-protocol.ts, packages/service-worker/src/preview-bridge.ts, packages/workbench/src/workbench/internal/workbench-options.ts]
---

## Context

The host page can select a narrow SW scope, but preview addressing is fixed to
/preview/<port>. Host-selected prefix must work through actual iframe navigation,
preview assets, root-relative guest requests and HMR, without root scope or
editing the guest project's URLs. Preserve the existing default route for
existing hosts. SW scope must contain both the Workbench page and selected
preview route; malformed/out-of-scope config fails before deployment effects.

Use the existing canonical preview-addressing and owner-binding authorities;
no second URL parser or alternative request dispatcher. ADR must reconcile the
prefix with io/HTTP/WS/iframe consumers. Prove a built packed host under /sandbox/
and copied SW assets, with an unrelated host route outside its scope. Preserve
existing response and owner authorization semantics; scope is not JS isolation.

Scope and user decisions: goal I5. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I5; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
