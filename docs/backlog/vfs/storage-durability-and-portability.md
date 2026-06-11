---
area: vfs
status: active
title: Storage durability (persist/estimate/quota UX) + project export/import
created: 2026-06-11
why: without navigator.storage.persist() the browser can evict the whole project, and OPFS data is trapped per-origin (the ADR-0076 snapshot is display-only) — both break the M11 "your code survives and can leave the browser" promise
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0072, ADR-0076]
code: [packages/vfs/src/opfs-sync.ts, apps/playground/src/glue/vfs-snapshot-port.ts]
---

## Context

Two adjacent data-ownership gaps for M11 (Consumer Ready). (1) **Durability**:
`navigator.storage.persist()`/`persisted()` is never called and `estimate()` quota is not surfaced,
so the browser can evict the user's whole project under pressure, and EDQUOT (mapped in ADR-0072) has
no visible out-of-space UX. (2) **Portability**: OPFS data cannot leave the origin — the ADR-0076 VFS
snapshot is read-only/display-only, not exportable; there is no zip/tar export or import. A
self-hostable IDE needs both: the data persists, and it can be exported/imported.

## Options or Next

- Call `persist()`/`persisted()` at boot; surface `estimate()` quota; wire EDQUOT into a visible
  out-of-space UX instead of a swallowed write-through error.
- Workspace export: zip/tar of the OPFS tree to download (stream large trees — don't whole-buffer).
- Import: zip → repopulate OPFS; optional `showDirectoryPicker` mount of a local folder into the VFS.
- Honest caveat: Safari ITP 7-day eviction + per-origin all-or-nothing eviction persist() can't fully
  prevent — document it.

## Reversibility

REVERSIBLE — additive playground/VFS surface; no lower-package public API break. Recorded here.
