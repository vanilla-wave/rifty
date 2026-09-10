---
area: playground
status: draft
title: Reload crash-consistency fault e2e — kill the page at the worst moment, reopen honest
created: 2026-07-05
why: npm page-death/reopen/retry is now proven; remaining restore, Git and editor-save crash rows and their UI indicators still need end-to-end coverage
user_story: As a developer, I want to close or reload the tab mid `npm install` / mid `git commit` / mid editor save and reopen to an honest project, but today nothing proves the reopened state isn't a half-tree presented as installed or a stale saved-indicator
epic: fault-honest-opfs-persistence
blocked_by: [vfs/iso-git-ref-torn-write-rows]
sources: [docs/backlog/playground/reference/project-open-ide-boundaries-refine.md]
code: [packages/workbench/src/glue/project-deps.ts, packages/workbench/src/workers/package-acquisition-authority.ts, tests/browser-unit]
---

## Context

PR #323 already proves the npm row: real Vite, page death after native lodash
persistence, saved files/terminal with zero acquisition, explicit retry and live
preview (`tests/browser-unit/saved-project-interrupted-install.spec.ts`). Reuse
that carrier; remaining crash/UI rows stay open.

Playwright can inject the REAL fault — `page.close()` / `page.reload()` at a chosen mid-operation moment — no mocks, no seams. Rows assert the reopened page, not internals. Existing reload e2e covers the happy path (dev-server relaunch, LIVE pill); this item adds the crash rows. Timing: anchor each kill on an observable mid-marker (terminal output, request count), never a sleep — flaky-kill = useless row.

## Acceptance

One e2e row each (RED first where the row fails):

- kill mid `npm install` in a saved snapshot-created Vite project → reopen: preserved files and terminal are accessible, with zero implicit install/restore; commands fail on missing dependencies when used. An explicit user `npm install` completes and the subsequently launched preview goes LIVE; partial install is never presented as complete.
- kill mid snapshot-restore → reopen: restore redone cleanly (stamp written only post-restore — pinned by observation, not code reading).
- kill mid `git commit` → reopen: repo opens clean per `vfs/iso-git-ref-torn-write-rows` observables (`git log`/`status` clean at either state).
- kill mid editor save → reopen: file content = saved or prior version, editor dirty/saved indicator matches the actual content — never «saved» over lost bytes.
- every row: status indicators honest after reopen (LIVE pill only with a running dev server — extends the existing reload e2e assert).

## Parity cases

- npm/Node: after interrupted install, independent local source still runs; using a missing package fails at that use. Explicitly re-running install reconciles the tree. The native local-source/missing-module/explicit-repair oracle and real browser interruption/retry are recorded in `reference/pr323-implementation-evidence.md`; remaining native crash probes are assessed at pickup.
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
- Saved npm recovery UX = open actual saved files and terminal, with no automatic install/restore; user explicitly re-runs install. Existing own snapshot/catalog recovery and Git/save rows remain unchanged.
- Lane: chromium-heavy (serial) — kill-timing rows must not share workers (e2e two-lane precedent).
- re-cut: 2026-09-10 — fork: user «да, ок, ровно поведение node» accepts the concrete interrupted-install reopen scenario in `reference/project-open-ide-boundaries-refine.md`; replace automatic npm rerun, demote to draft for missing new RED and linked implementation — trace: scenario.
- 2026-09-10 — pre-amendment row: "kill mid `npm install` → reopen: no stamp, install re-runs to completion, preview goes LIVE (npm parity: rerun just works; no half-tree trusted)."
