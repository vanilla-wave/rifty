---
area: vfs
status: active
title: Persist OPFS atime/mtime across reloads (utimes side-table durability + cross-surface coherence)
created: 2026-06-13
why: utimes side-tables are in-memory only; touch/utimesSync timestamps vanish on reload (statSync falls back to mtime 0) and OpfsVfs vs OpfsFsSync side-tables diverge.
user_story: As a dev who `touch`/`utimesSync`-es OPFS files and expects the mtime to survive a page reload, I want timestamps persisted, but today the side-table is in-memory only so after reload `statSync` reports mtime 0 (and the two OPFS surfaces disagree)
sources: [ADR-0029, ADR-0041, ROADMAP M4]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts]
---

## Context

OPFS exposes no native mtime mutation, so utimes lives in per-surface `times` Maps. OpfsFsSync.statSync defaults mtime to 0 and reads only the side-table; init() rehydrates the path index + content cache but never the `times` map. OpfsVfs keeps a second, independent side-table, so the two surfaces' mtimes diverge unless callers route both through one node:fs path. ADR-0029 explicitly flagged persisting in an OPFS metadata file as a follow-up; no existing vfs backlog item covers timestamp durability (opfs-persistence=content round-trip, opfs-lazy-content-preload=content memory, fs-sync-fd-api=fd API + content fsync). runtime-wasi/filestat-set-times is a distinct WASI-syscall-wiring concern.

## Options or Next

Option A: persist a single OPFS metadata sidecar (e.g. /.rifty-meta/times.json) keyed by path; OpfsFsSync.init reads it into `times`; utimes/writeFileSync/rename/rm enqueue an async write-through over the existing ADR-0072 flush queue so it drains before reload. A shared sidecar also closes the OpfsVfs↔OpfsFsSync drift (ADR-0041 left pairing deferred). Option B: defer per ADR-0029 until a cross-reload parity test fails. Either way gate on a failing cross-reload parity/e2e case (touch -> reload -> assert mtime persists).

## Reversibility

REVERSIBLE — backlog item; localized to OpfsFsSync/OpfsVfs side-table load/persist over the ADR-0072 flush queue, no public API change. A shared sidecar storage format is the only mildly sticky choice.
