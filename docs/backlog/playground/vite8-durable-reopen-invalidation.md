---
area: playground
status: draft
title: Durable Vite 8 reopen invalidates the pre-policy package tree
created: 2026-07-28
why: ADR-0336 changes the exact Vite 8 manifest and snapshot identity, but the blocked predecessor never proved that reopening the same saved project rejects pre-policy install trust and tree bytes.
user_story: As a user reopening a saved Vite 8 project after the runtime-policy upgrade, I want the project to use the current visible manifest and proven WASI runtime, but a stale trusted package tree must never survive under the old identity.
sources: [ADR-0336, docs/backlog/playground/reference/vite8-wasi-runtime-closure-contract-red.md]
code: [packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workbench/internal/playground-project-definition.ts, tests/e2e/project-switch.spec.ts]
---

## Context

Contract+RED attempt 2 used `pickStarter()` for the final transition. That
creates a fresh scratch; it cannot prove durable-project reopen or cache
invalidation. The required successor must save Vite 8 as a named project,
switch to another named project, then reopen the same project card and identity.

The test must seed or retain a reachable pre-policy definition/trust state,
observe its rejection after the policy identity changes, and sweep the snapshot
package bytes/id, definition identity, install trust, and runtime tree. How to
stage the before/after application identity without a fake owner remains to be
refined against the existing catalog migration and browser harnesses.

## Reversibility

REVERSIBLE proof and lifecycle repair under accepted ADR-0336; no new public API
or cache mechanism.
