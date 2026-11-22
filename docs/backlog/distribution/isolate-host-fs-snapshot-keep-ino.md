---
area: distribution
status: draft
title: Keep ino across an isolate FS snapshot and restore
created: 2026-11-22
why: a restored file gets a new `fs.statSync().ino`; on a real disk that persists between runs it would keep its number
user_story: As a program in a rifty sandbox that remembers `ino` between runs to recognise a file (its own cache), I want the same `ino` after the next turn's restore, but today the restore renews every inode
blocked_by: []
sources: [ADR-0567, docs/backlog/epics/isolate-host-fs-snapshot/goal.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/vfs/src/stat-metadata.ts]
---

## Context

User, 2026-11-22 (via the manager), on «a second run sees another `ino` for the
same file; size, times and content match exactly»: «давая в бэклог положим».

Today (goal `isolate-host-fs-snapshot`, ADR-0567 §1): format v1 carries no
`ino`; restore creates nodes that draw new inodes. Why not now: rifty draws
inodes from one counter per realm (`packages/vfs/src/stat-metadata.ts`
`nextInode`), shared by every `MemoryFs` there — a restored `ino` would move
the counter of every other FS in the consumer's realm, and a hostile blob
could push it past what restore accepts (FIT challenge, goal `## Challenge`).
Keeping `ino` needs both a per-FS inode counter in vfs and a format version
that carries it.

No match in `docs/backlog` (`grep -rli 'ino'` among snapshot items: none).

## Challenge

challenge: none — the user's deferral recorded, no direction proposed
