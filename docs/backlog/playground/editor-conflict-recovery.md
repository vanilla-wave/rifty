---
area: playground
status: draft
title: Actionable editor conflict recovery
created: 2026-07-17
why: editor CAS preserves both versions but the Playground exposes the conflict only as a transient error and repeatedly retries the same stale base
user_story: As a developer whose open file changed outside Monaco, I want to reload, compare, or explicitly replace it without losing either version.
blocked_by: []
sources: [ADR-0273, PR-151-post-merge-fixes]
code: [apps/playground/src/adapters/playground-app.tsx, apps/playground/src/adapters/playground-project-view.ts, apps/playground/src/workbench/project-documents.ts]
---

## Context

The Workbench contract is already honest: `FileConflictError` and the document
snapshot retain the local draft, exact remote bytes, and both versions; no
last-writer-wins retry occurs. The Playground presentation currently forwards
the rejection to a transient toast. Monaco stays dirty and its next debounced
write uses the same stale handle, so the user has no actionable recovery path.

Refine one UI authority for Reload remote, Compare local ↔ remote, and explicit
Replace remote. Closing/switching must retain the existing dirty-close guard.
Never infer overwrite from another edit or Save, and never discard either byte
sequence before the user chooses an outcome. RED cases must cover same-length
remote replacement, remote deletion, repeated debounce, and project teardown.
