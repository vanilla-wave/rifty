---
area: distribution
status: draft
title: Drop unused adapter bindings from the no-COI activation snapshot
created: 2026-09-11
why: restore re-derives bindings from the saved lock, so the host-validated bindings field carries dead data
sources: [docs/adr/distribution/0420-apply-no-coi-snapshots-through-the-sdk.md, https://github.com/vanilla-wave/rifty/pull/332]
code: [packages/runtime-js/src/internal/toolchain-input.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts]
---

## Context

Since ADR-0420 `restoreActivation` calls `prepareSavedToolchain(state.cwd)` and
ignores `state.bindings`; the host still validates and copies the field
(`validateActivationState`) and every worker operation still fills it. Pure
shrinkage captured by the PR #332 review (REV-7), no behavior change.

## Question

Remove `bindings` from `ToolchainActivationState` and its validator, or keep it
as a documented recovery fact. Regression: restart recovery tests stay green.

## Decisions

- 2026-09-11 — capture only; not a checkpoint condition.
