---
area: vfs
status: parked
title: Browser storage pressure and eviction UX
created: 2026-06-12
why: the playground now requests persistent storage, surfaces quota, and can export/import a JSON workspace archive, but browser-specific eviction and out-of-space flows still need user-tested UX
sources: [ADR-0072]
code: [apps/playground/src/glue/storage-status.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

`navigator.storage.persist()` / `persisted()` / `estimate()` are probed at boot, and the playground
can download/import a dependency-free JSON workspace archive. Remaining fidelity is storage-pressure
UX: browsers may deny persistence, Safari may still evict origin data, and OPFS write-through quota
errors need a dedicated visible recovery path beyond ordinary operation errors.

## Options or Next

- Gate: reproduce a real browser quota or eviction failure in e2e/manual QA.
- Then: add a compact recovery surface that offers archive download/import and explains storage state.
- Keep VFS write errors loud; do not swallow EDQUOT or OPFS write-through failures.

## Reversibility

REVERSIBLE — user-facing playground UX only.
