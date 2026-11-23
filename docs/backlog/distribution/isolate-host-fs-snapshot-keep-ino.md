---
area: distribution
status: draft
title: Keep ino across an isolate FS snapshot and restore
created: 2026-11-22
why: a restored file gets a new `fs.statSync().ino`; on a real disk that persists between runs it would keep its number
user_story: As a program in a rifty sandbox that remembers `ino` between runs to recognise a file (its own cache), I want the same `ino` after the next turn's restore, but today the restore renews every inode
blocked_by: []
sources: [ADR-0567, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/snapshot.ts, packages/vfs/src/stat-metadata.ts]
---

## Context

User, 2026-11-22 (via the manager): «давая в бэклог положим» — the answer to
the manager's text quoted in ADR-0567 `## Decisions` (the second line).

Today (ADR-0567 §1): format v1 carries no
`ino`; restore creates nodes that draw new inodes. Why not now: rifty draws
inodes from one counter per realm (`packages/vfs/src/stat-metadata.ts`
`nextInode`), shared by every `MemoryFs` there — a restored `ino` would move
the counter of every other FS in the consumer's realm, and a hostile blob
could push it past what restore accepts (the FIT premise critique of goal `isolate-host-fs-snapshot`, 2026-11-22; ADR-0567 «Rejected»).
Constraint, not a design: a kept `ino` must not reach other FSs of the realm,
and format v1 has no field for it (a reader change is a new format version,
ADR-0567 §3).

Node over a disk that persists keeps it: the same file read from two separate
`node -e` processes (v24.16.0, darwin APFS) reported `ino` 312176237 both
times.

Prior ruling it reopens: ADR-0567 «Rejected» (keeping `ino` in v1) and the
closed goal `isolate-host-fs-snapshot`'s `rejected route: keeping ino — violates I3` (I3: ADR-0567 «Goal invariants»); the user's deferral keeps
the question open. Dedup (`grep -rliw 'ino\|inode' docs/backlog`): this goal's
own documents; `npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md`
and `vfs/fs-sync-fd-api-and-fsync-durability.md` (fds, another concern) — no
duplicate.

Owner: distribution (isolate host); trigger: a consumer program keyed on
`ino` across runs, or the next format version.

## Challenge

challenge: none — the user's deferral recorded, no direction proposed
