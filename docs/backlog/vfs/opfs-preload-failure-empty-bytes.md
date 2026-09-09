---
area: vfs
status: draft
title: Failed OPFS preload silently becomes empty file bytes
created: 2026-09-06
epic: self-hosted-snapshot-workbench
why: A persisted file whose preload rejects remains indexed but sync reads return empty bytes, which recovery can propagate.
code:
  - packages/vfs/src/opfs-sync.ts
sources:
  - docs/backlog/terminal/reference/review-2026-06-07.md
---

## Context

Real native reproduction now exists: preload getFile refusal leaves a9-byte
persisted file indexed but uncached; sync read/copy returns empty and overwrites
an existing destination with empty bytes. Double metadata+preload refusal also
reports size0, while original native bytes remain. Read/copy/cp/uncached rename
sweep and5 semantic browser REDs are captured in
../playground/reference/orphan-scratch-recovery-evidence.md.

Required prerequisite is owned by playground/orphan-scratch-recovery in the
self-hosted-snapshot-workbench goal. ADR-0406 partially supersedes ADR-0072's
empty fallback after independent DEC-2: existing Map presence + shared read/copy
EIO guard; genuine empty works, native rename/write ledger retained. No source
fix yet; delete this consumed capture only after that unit is proven.

Dedup: terminal/reference/review-2026-06-07.md already noted cold-cache
copyFileSync empty bytes, but has no actionable item. vfs/opfs-lazy-content-preload
owns eager-preload cost, not failed-read honesty. ADR declined concepts have no
matching storage-read decision. Capture both sync read and copy siblings here.

## Decision

- 2026-09-09 — native evidence resolves the old init-vs-per-file question through ADR-0406; owned by the active I6 unit, no duplicate implementation.

## Challenge

challenge: 2026-09-06 — clear
