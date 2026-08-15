---
area: vfs
status: draft
title: Mirror-existence pre-mkdir guards can never heal a ledgered dir persist
created: 2026-08-15
why: sites that guard mkdirSync with "already in the mirror" skip the ONLY call that could re-persist a dir whose OPFS create failed — the ledger stays dirty all session because OpfsVfs.writeFile creates no parents, so child writes into the missing dir fail too instead of healing it
sources: [Contract+RED attempts 1-2 on vfs/opfs-mkdir-persist-dedup (2026-08-15), docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [packages/vfs/src/opfs-sync.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

`quota-perm-fail` + `sibling-drift` at the Storage boundary. Mechanism on
main: a dir's mkdir persist fails (quota/perm) → persist-failure ledger entry;
the dir EXISTS in the sync mirror. Every later mutation of that dir routed
through a mirror-existence guard skips `mkdirSync` entirely, so the
unconditional re-persist — the only heal carrier — never runs. Child writes
cannot substitute: `OpfsVfs.writeFile` creates no parents (opfs.ts), so
writes into the on-disk-missing dir fail and add their own entries. Within a
session the subtree is honestly reported dirty (`flush().total > 0`, stamp
refused) but is UNHEALABLE through these call sites; only an explicit
un-guarded `mkdirSync` or a reload (`refreshIndex` drops the phantom mirror
entry) recovers.

Sweep (review 2026-08-15): `OpfsFsSync.loadFixture`
(packages/vfs/src/opfs-sync.ts:824-834, `!this.index.has(dir)` — editor-save
fast path: repeated saves into a quota-struck dir never heal it);
`playground-project-authority.ts` guarded sites — `durableWriteJson`
(~:1073, `if (!isDirectory(...)) mkdirSync`, gates on `flushRequired` so the
failure is loud but retries keep skipping the heal), image-directory
restore (~:1104) and `applyManagedCopyDirectories` (~:1208, same
`isDirectory` guard shape).

Class-kill: the guards exist as micro-optimizations predating the ledger.
Candidate fixes at compile time: (a) drop the guards — post
`playground/restore-mkdir-persist-dedup` the restore hot path no longer
motivates them, and an unconditional `mkdirSync` on an existing chain is one
cheap no-op persist; (b) a ledger-aware guard helper owned by OpfsFsSync (one
chokepoint, not per-site copies). Either way ONE decision point; per-site
variants are the sibling-drift this capture exists to kill.

Repro (Node unit, per predecessor review): injectable root failing dir
creates + parent-checking paired surface; `loadFixture({'/fx/a.txt':'v1'})`
under fault → `flush().total === 2`; clear fault; retry same `loadFixture` →
on main `total` stays 2 forever (guard skips the mkdir; the write keeps
failing on the missing parent).
