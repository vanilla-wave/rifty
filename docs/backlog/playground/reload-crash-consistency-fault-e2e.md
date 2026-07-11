---
area: playground
status: ready
title: Reload crash-consistency fault e2e — kill the page at the worst moment, reopen honest
created: 2026-07-05
why: every persistence layer is (or is being) fault-proven in isolation, but no test ever closes/reloads the real page mid-operation — the end-to-end axis (torn-state at the orchestration layer, lying status indicators) has zero coverage
user_story: As a developer, I want to close or reload the tab mid `npm install` / mid `git commit` / mid editor save and reopen to an honest project, but today nothing proves the reopened state isn't a half-tree presented as installed or a stale saved-indicator
epic: fault-honest-opfs-persistence
blocked_by: [vfs/iso-git-ref-torn-write-rows]
code: [packages/workbench/src/glue/project-deps.ts, apps/playground/tests]
---

## Context

Playwright can inject the REAL fault — `page.close()` / `page.reload()` at a chosen mid-operation moment — no mocks, no seams. Rows assert the reopened page, not internals. Existing reload e2e covers the happy path (dev-server relaunch, LIVE pill); this item adds the crash rows. Timing: anchor each kill on an observable mid-marker (terminal output, request count), never a sleep — flaky-kill = useless row.

## Acceptance

One e2e row each (RED first where the row fails):

- kill mid `npm install` → reopen: no stamp, install re-runs to completion, preview goes LIVE (npm parity: rerun just works; no half-tree trusted).
- kill mid snapshot-restore → reopen: restore redone cleanly (stamp written only post-restore — pinned by observation, not code reading).
- kill mid `git commit` → reopen: repo opens clean per `vfs/iso-git-ref-torn-write-rows` observables (`git log`/`status` clean at either state).
- kill mid editor save → reopen: file content = saved or prior version, editor dirty/saved indicator matches the actual content — never «saved» over lost bytes.
- every row: status indicators honest after reopen (LIVE pill only with a running dev server — extends the existing reload e2e assert).

## Parity cases

- npm: killing `npm install` mid-run in real Node then re-running completes normally — our rerun row matches that observable.
- git: per `vfs/iso-git-ref-torn-write-rows` (real-git recovery observables) — this item consumes them at the e2e level.

## Fault matrix

- `torn-state` × {install, restore, commit, save} × page kill → honest reopen (rows above).
- `provenance-lie` × status indicators (stamp, LIVE pill, saved marker) → match reality after reopen.

## Out of scope

- Multi-tab concurrent crash semantics (single-tab rows only).
- Browser crash simulation beyond Playwright close/reload (OS-level kill indistinguishable at the OPFS layer).
- Quota faults (owned by the vfs items; this item is the crash axis).

## Decisions

- Fault injection = real page close/reload only — no storage mocks (AGENTS.md §Fidelity).
- Recovery UX = silent redo on next boot (npm/git parity); no new UI. A row demanding UI would be a scope change → back to refine.
- Lane: chromium-heavy (serial) — kill-timing rows must not share workers (e2e two-lane precedent).
