---
area: distribution
status: draft
title: Boot Workbench from copyable published runtime assets
created: 2026-09-07
why: A host still compiles Worker/SW entries and supplies aliases and a QuickJS wrapper.
user_story: As the Tracker plugin-sandbox embedder, I want to boot workbench from copyable published runtime assets, but today a host still compiles Worker/SW entries and supplies aliases and a QuickJS wrapper.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/tsup.config.ts, packages/workbench/README.md, tests/integration/fixtures/workbench-vite-consumer/host-builtins.ts]
---

## Context

Published Workbench entries leave imports external. A standalone host must
compile the owner/kernel/node/dev-server/TypeScript entries, supply builtin
aliases, build SW and locate WASM. Deliver a copyable complete runtime asset
closure with documented host headers and URLs: no consumer Worker/SW compilation
or custom bootstrap wrapper. Normal host application compilation is unaffected.
First prove the assets against the existing registry-enabled Workbench; strict
snapshot acquisition remains the next child. Preserve existing custom deployment
entries. Asset carrier/versioning and QuickJS URL wiring require an ADR citing
ADR-0352/0282, not a second runtime or hardcoded external CDN.

Proof uses packed artifacts and a built host; startup and an installed Vite
command must exercise the copied assets, not workspace-resolved entries.

Scope and user decisions: goal I2. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I2; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
