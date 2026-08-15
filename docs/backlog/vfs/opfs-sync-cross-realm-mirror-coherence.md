---
area: vfs
status: draft
title: Cross-realm OPFS mutation leaves a sibling realm's sync mirror silently stale
created: 2026-08-15
why: two realms over one OPFS origin (Workers/tabs each installing OpfsFsSync/OpfsVfs) have no coherence owner — after a foreign rm, a realm's reads/stat/exists serve deleted state and its mkdir may not recreate; the class has per-site symptoms but no single authority
sources: [Contract+RED attempt 1 on vfs/opfs-mkdir-persist-dedup (2026-08-15), docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/sync-mirror.ts, packages/vfs/src/opfs.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/workbench/src/workbench/open-workbench.ts]
---

## Context

`concurrent-same-key` at the Storage boundary — a REAL surface per
fault-classes §Boundary failure models ("cross-tab concurrent writers"), not
physically excluded. Observed on main: `OpfsFsSync`'s content cache + warm
index are seeded at boot and mutated only by their own realm; a foreign
realm's rm/write over the same OPFS origin makes `readFileBytesSync` /
`statSync` / `existsSync` serve deleted/stale state with no error and no
ledger entry (silent, not loud). `refreshIndex()` exists but nothing owns
calling it on cross-realm mutation. Sweep sites (review 2026-08-15, each
installs or wraps an independent mirror over the shared origin):
`packages/runtime-js/src/host.ts:194`,
`packages/runtime-js/src/worker-entry.ts:117`,
`packages/vfs/src/sync-mirror.ts:143`, `packages/vfs/src/opfs.ts:176`,
`packages/workbench/src/workbench/open-workbench.ts:645` (Web Lock).

User-action repro ATTEMPT (§Reachability): two workbench tabs — blocked, the
workbench Web Lock (`open-workbench.ts`) serializes owners; the reachable
path is API-level only (an embedder spawning two runtimes over one origin).
No user-action path found → stays draft with the attempt recorded.

Drain-level manifestation (review 2026-08-15, mkdir-dedup row f): a clean
`flush()` report cannot attest bytes a foreign realm deleted AFTER their
successful persist — on main, a foreign recursive rm between two drain ops
loses the already-persisted file while a later (redundant or distinct-chain)
mkdir recreates only the parent: `total === 0`, file absent, no ledger
entry. The ledger's contract covers the drain's own ops; foreign
interference needs the class owner (epoch/lock/refresh), not per-op guards.
Differential pin at the restore seam:
`packages/workbench/src/glue/workspace-archive.fault.test.ts` row (f).

Class-kill inventory (before any fix mechanism): existing coordination near
this invariant — (1) workbench Web Lock (product-level owner serialization);
(2) `refreshIndex()` manual reconcile; (3) install-stamp authority per-root
serialized slots; (4) `vfs/trusted-state-primitive` (draft) centralizing
trust claims. A fix must name ONE owner (lock tenure / epoch / refresh
protocol) — per-op guards (e.g. a mkdir-only recreate check) are the partial
third mechanism §Class-kill forbids; the mkdir-dedup item explicitly declined
one for this reason.

OpfsFsSync's header already disclaims cross-instance coherence ("Worker owns
its filesystem view for life") — the gap is that the disclaimer is silent at
runtime: no throw, no degrade signal, no epoch check. Honest-outcome options
to weigh at compile time: epoch/generation stamp in OPFS checked at flush
boundaries; Web-Lock-tenure assertion inside OpfsFsSync init; or a recorded
ADR accepting single-owner-per-origin as a contract with a loud runtime
guard.
