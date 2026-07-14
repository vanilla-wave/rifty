---
area: playground
status: draft
title: Project lifecycle outcome recovery under one owner
created: 2026-07-15
why: project lifecycle mutations split authority across root bytes, the project index, transport receipts, and page-only intent, so faults can leave the user with an unknown or dishonest project outcome
user_story: As a developer running a real Node project in the browser, I want Save, Delete, Discard, Reset, and Starter changes to survive storage and transport faults with one recoverable outcome, but today a reload can expose partial roots, stale identity, or an unreported delete failure.
blocked_by: []
sources: [ADR-0165, PR-145-scope-audit-2026-07-15]
code: [apps/playground/src/glue/project-index.ts, apps/playground/src/glue/project-index-port.ts, apps/playground/src/orchestration/save-flow.ts, apps/playground/src/orchestration/reset-refresh.ts, apps/playground/src/glue/app-project-store.ts, apps/playground/src/orchestration/project-index-boot.ts, apps/playground/src/orchestration/workspace-lifecycle.ts]
---

## Context

PR #145's scope audit found one repeated state-owner fault class outside that PR's VFS/package-authority goal: a lifecycle outcome is distributed across project-root bytes, `/project-index.json`, a BroadcastChannel receipt, and page memory. Fixing each symptom separately would preserve the split authority. Refine this as one authority redesign, or explicitly split it along proved ownership boundaries before implementation; do not land point fixes.

Fault evidence:

- **Pre-existing on `origin/main`, retained in PR #145:** Save, Delete, Discard, Reset, and `newScratch` can enqueue root and index changes before one OPFS durability proof. A partial persistence cut can therefore expose a copied, removed, or reseeded root with the old index, or a new index with only part of the intended tree. Relevant paths: `glue/project-index.ts`, `glue/project-index-port.ts`, `orchestration/save-flow.ts`, `orchestration/reset-refresh.ts`.
- **PR #145 regression from bounded `origin/main` behavior:** generic index mutations can lose their ACK and have no disposition/status/replay protocol. `origin/main` bounded these requests with `INDEX_ACK_TIMEOUT_MS`; the branch's generic `postIndexMutation` waits on owner settlements without an equivalent bounded terminal outcome. PR #145 may contain that regression at the common chokepoint with a loud finite `unknown`; exact disposition and recovery remain here. Rename, Delete, Reset, `newScratch`, active-project changes, and dirty-state writes can remain unknown after the owner applied them. Relevant path: `glue/project-index-port.ts`.
- **Pre-existing on `origin/main`, retained in PR #145:** Save and scratch Reset accept page-supplied `starter` as identity even though the durable owner index must arbitrate an existing project's baseline. A stale page mirror can save or reseed against the wrong Starter. A fresh `newScratch` Starter selection remains legitimate page intent; it is not evidence that Save/Reset should trust the page. Relevant paths: `glue/project-index-port.ts`, `orchestration/save-flow.ts`, `orchestration/reset-refresh.ts`.
- **Pre-existing on `origin/main`, unchanged by PR #145:** deferred inactive Delete keeps pending intent only in page memory; after the Undo grace period, failure is console-logged and not restored to an actionable user state. Reload/owner replacement can lose the retry intent while the page mirror has already removed the project. Relevant paths: `glue/app-project-store.ts`, `orchestration/project-index-boot.ts`.
- **Observed while certifying PR #145, not expanded there:** the GREEN Chromium Save→Starter→two-project round-trip can still emit an uncaught `ENOENT` for the moved `/scratch` root while the final owner tree and index remain correct. Refinement must first pin which superseded owner/request survives the root move, then include its cancellation or terminal disposition in the lifecycle contract; a local catch would only hide the unknown outcome. Relevant paths: `orchestration/workspace-lifecycle.ts`, `orchestration/project-index-boot.ts`, `tests/e2e/project-switch.spec.ts`.

Refinement must define one serial owner, durable operation identity and terminal disposition, recovery after every root/index persistence cut, and an honest user-visible outcome. Beyond restoring PR #145's lost finite bound, do not land lifecycle point fixes. The finite RED set must cover each writer and crash/ACK boundary before choosing whether this remains one item or becomes an explicit owner/UX split.
