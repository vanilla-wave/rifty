---
area: distribution
status: ready
title: Boot Workbench from copyable published runtime assets
created: 2026-09-07
why: A host still compiles Worker/SW entries and supplies aliases and a QuickJS wrapper.
user_story: As the Tracker plugin-sandbox embedder, I want to boot workbench from copyable published runtime assets, but today a host still compiles Worker/SW entries and supplies aliases and a QuickJS wrapper.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/distribution/reference/workbench-static-assets-evidence.md]
code: [packages/workbench/tsup.config.ts, packages/workbench/README.md, tests/integration/fixtures/workbench-vite-consumer/host-builtins.ts]
---

## Context

Published Workbench entries leave `@riftydev/*` external. A standalone host
compiles owner/kernel/node/dev-server/TypeScript/SW entries, aliases Node
builtins, and wraps the kernel for QuickJS (ADR-0352). Deliver ADR-0395
`dist/runtime/` : copyable bundled workers, SW and WASM with documented
headers. Existing sealed source entries stay for hosts that still compile.
First prove against the existing registry-enabled packed consumer; snapshot-only
admission is a sibling. Reference: `reference/workbench-static-assets-evidence.md`.

## User scenario

Host CI copies `@riftydev/workbench/dist/runtime/` to its static origin, sets
the documented headers, and passes those file URLs to `openWorkbench`. The
packed Vite consumer compiles no Worker/SW entry, ships no `host-builtins`
aliases and no kernel wrapper, then boots and runs an installed Vite command
through the copied assets.

## Acceptance

1. Published `dist/runtime/` contains bundled owner/kernel/node/dev-server/typescript/no-coi workers, `sw.js`, `sqlite.wasm`, `quickjs.wasm` and `manifest.json`; worker/SW JS contain no `@riftydev/` import specifiers. `runtime-assets.contract.test.ts` closure cases. → I2
2. The packed consumer copies that directory, compiles no Worker/SW entries, and writes no builtin-alias file or QuickJS host wrapper; startup plus an installed Vite command use the copied URLs, not workspace-resolved entries. `tests/integration/workbench-static-assets.contract.test.ts` plus packed-consumer lane. → I2
3. Existing sealed source/custom deployment entries remain importable; a host that still compiles is not forced onto the copyable path. Existing worker export/package-surface cases. → ADR-0395

## Fault matrix

- Missing/unreadable copied asset × boot: absent worker, SW or WASM URL fails before guest start with the existing deployment URL/fetch error; no silent fallback to workspace entries. `runtime-assets.contract.test.ts` missing-asset case. → I2
- Sibling-drift × kernel WASM: the copyable kernel publishes only the sibling `quickjs.wasm` URL (ADR-0352 order); a host that omits that file fails QuickJS preload loudly. `runtime-assets.contract.test.ts` kernel-sibling case. → ADR-0395
- Poisoned asset bytes × fetch: corrupt copied worker/SW/WASM fail at load/compile with the existing typed fetch/compile error; guest code does not start. Existing worker/WASM load faults plus kernel-sibling case. → I2

## Out of scope

Snapshot-only admission, preview-prefix routing, storage namespace, operation
budgets and a new runtime or CDN remain named siblings / rejected routes.
Playground may keep compiling sealed source entries.

## Decisions

- 2026-09-08 — ADR-0395: bundled `dist/runtime/` copy set; kernel asset publishes sibling QuickJS URL; sealed source entries remain.
- 2026-09-07 — finding draft; observable scope is settled by goal I2; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
