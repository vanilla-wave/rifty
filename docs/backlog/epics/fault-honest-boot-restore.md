---
kind: epic
status: draft
title: Fault-honest boot restore — reload restores exactly what durable state proves
created: 2026-07-05
value: A page reload after any failure (mid-persist crash, killed worker, interrupted install) restores a correct project with honest status — never a silently wrong tree, a dead dev server shown as LIVE, or lost session state.
user_story: As a developer, I want to reload the tab at any moment and trust what I see, but today the restore orchestration (snapshot, owner re-root, dev-server relaunch, session/tab state) has no fault rows for torn-state at its layer — it trusts whatever the persistence layer hands it.
items: []
---

## Outcome

Boot/restore is the CONSUMER of persisted state: even with a fault-honest VFS layer (`fault-honest-opfs-persistence`), the playground orchestration can lie on its own — restore over a half-persisted snapshot, LIVE pill without a relaunched dev server (already bitten once: reload e2e missed a stopped dev server), stale session/tab state. Fault rows at the orchestration layer per `docs/process/fault-classes.md` (torn-state / false-fallback / provenance-lie).

## Candidate boundaries (items carved at refine)

- boot/restore snapshot + owner re-root: restore over partially-persisted state → honest outcome
- dev-server relaunch semantics on restore (status pill must reflect reality)
- session/tab/terminal persisted state: corrupt or torn entries
- related existing item: `playground/install-stamp-invalidation`

## Items

(to be carved by `rifty-refine`)
