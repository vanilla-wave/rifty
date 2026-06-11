---
area: vfs
status: active
title: OPFS mkdir not tracked by the flush queue — durability hole on reload
created: 2026-06-11
why: directory creations appear not to enqueue to the OPFS write-through pending queue, so flush() may not guarantee mkdir survives the reload the persistence design exists for — suspected silent data loss
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0072]
code: [packages/vfs/src/opfs-sync.ts]
---

## Context

ADR-0072 made OPFS writes a sync content cache + async write-through, with a pending queue that
`flush()` drains. The 2026-06 reconcile found directory creations (`mkdirSync`) do not appear to
enqueue to that pending queue, so a `mkdir` followed by a reload before the next flush can lose the
directory — a correctness defect under the exact reload the persistence design targets. EDQUOT
mapping (ADR-0072) is separate and done; this is specifically the durability of directory-creation
ops. On the M11 "your code survives reload" promise.

## Options or Next

- Confirm the gap first: write a failing test — `mkdir`, cross a flush boundary, assert the directory
  is persisted.
- Track the directory-create op in the pending queue so `flush()` guarantees durability.
- Audit other structural ops (`rmdir`, dir `rename`) for the same hole.

## Reversibility

REVERSIBLE — bounded fix inside `opfs-sync.ts`. A correctness fix, not a design fork. Recorded here.
