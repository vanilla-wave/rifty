---
area: distribution
status: draft
title: Guest FS snapshot codec v1 in the isolate and the consumer realm
created: 2026-11-22
why: the goal's one expected wall — no export/import of the guest FS exists
user_story: As a Node service, I want snapshotFs/restoreFs over a rifty MemoryFs in either realm, but today the guest FS dies with its isolate
epic: isolate-host-fs-snapshot
blocked_by: [distribution/isolate-host-fs-snapshot-acceptance]
sources: [ADR-0567, ADR-0558, docs/backlog/distribution/reference/isolate-host-fs-snapshot-fit-probes.md]
code: [packages/isolate-guest/src/, packages/vfs/src/memory-backend.ts, packages/vfs/src/sync-mirror.ts]
---

## Context

Format v1 per ADR-0567: pure-JS codec in `@riftydev/isolate-guest` (root
export `snapshotFs`/`restoreFs`/`FsSnapshotError`), `GuestEntry.snapshot`/
`restore`, the FS installed at bundle load, a vfs hook that sets `ino`/times
verbatim on restore. Fault matrix per goal tier `robust`.

## Challenge

challenge: pending — reuses the goal's premise check
