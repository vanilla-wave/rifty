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

## Acceptance

1. Published Workbench dist/assets contains ready Worker/SW entry files and their complete relative JS/WASM closure; copying the directory requires no host Worker/SW compilation, builtin aliases or QuickJS bootstrap. Existing custom source/dist entries remain. Packed copy script and static import-closure gate. → I2
2. A fresh packed consumer serves copied assets, boots Workbench, runs real Vite7.3.6 preview/native HMR, SQLite and the public producer snapshot journey. It uses only ordinary host-app compilation. Existing workbench-packed-consumer runner is the mandatory carrier. → I2
3. QuickJS obtains its WASM sibling synchronously before init handling; copied closure includes lazily loaded compiler/QuickJS modules and preserves the existing lexical compiler boundary. Existing bundle/entry suites and packed browser proof. → I2

## Fault matrix

- Missing/external asset edge × build/copy: reject incomplete published closure, never leave an import requiring host aliases or a CDN. Build metafile and packed copy guards. → I2
- Worker/WASM acquisition or bootstrap failure × boot: reject through existing owner readiness; no alternative runtime or fake success. Existing Workbench owner/browser tests plus real copied-asset boot. → I2

## Out of scope

New runtime/package compatibility and no-COI SDK behavior remain outside this
unit. Existing worker exports stay available; their standalone distribution
shares the same asset closure without changing runtime policy.

## Decisions

- 2026-09-08 — ADR-0390: dist/assets copied whole; publish build owns aliases and static kernel wrapper, normal sealed exports retained.

- 2026-09-07 — finding draft; observable scope is settled by goal I2; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
