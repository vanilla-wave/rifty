---
area: playground
status: draft
title: Dev-server restart must report supersession and pre-running exit
created: 2026-07-15
why: restart resolves successfully when a newer lifecycle generation supersedes it or when the replacement command exits before owner running proof
user_story: As a developer restarting a real Node dev server after a project transition, I want the restart promise and UI state to report whether a server actually reached running, but today the operation can resolve while no replacement server exists.
blocked_by: []
sources: [PR-145-scope-audit-2026-07-15]
code: [apps/playground/src/orchestration/dev-server-lifecycle.ts]
---

## Context

This lifecycle defect predates the PR #145 Reset proof and was found while separating that proof from general restart hardening. restart() stops the current session, then returns normally when its generation has been superseded. It also ignores the false result from startSession() when the replacement command exits before the owner publishes running (for example, a missing executable). Both paths settle as success even though this restart did not establish a live server.

The observable result can be a completed Reset/restart action with an idle session, stale preview status, or a caller that proceeds as if relaunch succeeded. Refinement must define terminal outcomes for superseded restart, pre-running process exit, owner replacement, and successful running proof, then add stateful RED cases before changing the lifecycle contract. This is separate from PR #145's requirement to stop a proven-live server before replacing project bytes.
