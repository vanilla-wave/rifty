---
area: playground
status: draft
title: Session-tool persistence failures degrade Workbench health
created: 2026-07-19
why: SCM and archive operations can fail owner persistence without projecting that failure into Workbench health, while document saves and explicit awaitDurability already do
user_story: As a developer whose browser storage fails during a Git action or archive import, I want Workbench to warn that reload may lose the change, but today the session-tool error can leave global health showing healthy.
epic: workbench-stabilization
blocked_by: []
sources: [PR-153-post-merge-audit, ADR-0278, fault-honest-opfs-persistence]
code: [apps/playground/src/workbench/internal/playground-workbench.ts, apps/playground/src/workbench/internal/playground-session-tools-transport.ts, apps/playground/src/workers/playground-session-tools-owner.ts, apps/playground/src/workers/playground-archive-integration.ts, apps/playground/src/workbench/workbench-browser-owner.ts]
---

## Context

SCM mutations run against the owner tree and then call `authority.flush()`. A flush failure is serialized as `PlaygroundPersistenceError`; archive import can likewise fail one of its durability-gated writes. Neither session-tool response projects persistence degradation into Workbench health. A stage, unstage, commit, discard, or import can therefore expose an error while `health.snapshot().disposition` remains `healthy`, even though memory and durable state may differ. SCM classification health is a separate channel and cannot stand in for durability truth.

Document writes are not evidence for this gap: `workbench-browser-owner` already reports their owner persistence failures, and explicit Save calls `awaitDurability()`, whose wrapper updates Workbench health. Refinement must preserve those honest paths rather than redesign them.

## Refinement path

- Pin the missing projection for session-tool SCM and archive mutations. Sweep documents, catalog/package acquisition, and close only to prove each sibling already projects health or to split a separately evidenced gap.
- Define one current-session health projection for degradation, recovery proof, stale-generation rejection, and close. Do not infer durability from a successful memory mutation or clear degradation on an unrelated operation.
- RED first for quota/permission failure during stage, unstage, discard, commit, and archive import; then a successful recovery barrier, concurrent stale recovery, project switch, and owner death. Assert both exact operation result and Workbench health history.
- `fault-honest-opfs-persistence` remains the owner of flush mechanics, ledgers, and reload/crash consistency. This item owns the live Workbench signal derived from those results and must not duplicate lower persistence policy.
