---
area: distribution
status: draft
title: Atomic restore in the FS snapshot codec
created: 2026-11-23
why: a restore that fails while writing (memory) leaves its target FS partial; today the instance is thrown away (ADR-0567 §6), which is enough unless someone restores over a live FS
user_story: As an embedder restoring a snapshot over a FS that stays in use, I want a failed restore to leave the previous tree intact, but today the target is partial after `ERR_FS_SNAPSHOT_INCOMPLETE` and must be discarded
blocked_by: []
sources: [ADR-0567, docs/backlog/epics/isolate-host-fs-snapshot/goal.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/vfs/src/memory-backend.ts]
---

## Context

User, 2026-11-23 (via the manager): «ок» — to the recommendation quoted in goal
`isolate-host-fs-snapshot` `## Decisions` (the 2026-11-23 `amend:` line),
whose deferral reads «Атомарность в кодеке записать в backlog с условием
взятия: появился embedder, которому нужно восстановление поверх живой ФС».

Today (ADR-0567 §6): `restoreFs` validates the whole blob, removes the old
tree, writes the new one; a failure while writing is
`ERR_FS_SNAPSHOT_INCOMPLETE`, the target is partial, and in the guest bundle
the isolate refuses `run`/`snapshot`/`restore` — it is thrown away. Restore
runs only in a fresh isolate (`ERR_FS_SNAPSHOT_NOT_FRESH`), so nothing in use
is lost there.

What atomicity would buy: the target FS intact after a failed restore — needed
only by someone who restores over a FS that stays in use.

What it would cost (manager's comparison shown to the user, 2026-11-23):
memory about 3 × the budget instead of 2 (old tree, blob and new tree alive
together); a new «replace the root» operation in vfs; and a decision on what
open files, cwd and the module cache that refer to the old tree become.

Trigger (the user's accepted words): an embedder appears that needs to restore
over a live FS. Owner: distribution (isolate host).

No duplicate: `grep -rli atomic docs/backlog` + `restore|snapshot` hits OPFS
mirror coherence, the scratch migration, workbench controllers and sync-RPC
integrity — other mechanisms.

## Challenge

challenge: none — the user's deferral recorded, no direction proposed
