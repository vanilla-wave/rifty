---
area: vfs
status: ready
title: Load persisted OPFS bytes honestly in one native traversal
created: 2026-09-08
why: Reopening cannot trust unreadable bytes; boot repeats native handle acquisition already paid by the index walk.
epic: no-coi-persisted-warm-open
sources: [docs/backlog/vfs/opfs-preload-failure-empty-bytes.md, docs/backlog/vfs/reference/no-coi-opfs-preload-handles-evidence.md]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts, packages/vfs/src/sync-mirror.ts]
---

## Context

Executed Chromium baseline: eight persisted files produce 24 directory lookups,
8 file-handle lookups, 16 getFile calls and 2 root acquisitions. Twelve concurrent
init calls acquire twelve roots. Native getFile rejection still permits boot,
empty sync reads and an empty copied file. This unit consumes the existing
[unreadable-preload finding](opfs-preload-failure-empty-bytes.md), not a separate
residual. [Evidence](reference/no-coi-opfs-preload-handles-evidence.md).

## Direction

[ADR-0393](../../adr/vfs/0393-single-pass-honest-opfs-preload.md): one eager tree
traversal supplies real bytes and metadata directly from native entry handles;
paired surfaces share their root and concurrent OpfsVfs.init calls share a
retryable promise. Post-root unreadable preload rejects as OpfsPreloadError;
indexed uncached sync read/copy throws EIO. Root-denied fallback stays unchanged.
No native wrapper. Contract+RED remains before implementation.

## Acceptance

1. Native getFile or Blob.arrayBuffer rejection prevents successful boot/preload,
   sync read and copy; no fabricated destination file. Browser test modes
   `unreadable` and `unreadable-bytes`. → I3
2. Eight files at depth three preload exact bytes with one root acquisition,
   one getFile per entry and no repeated path lookups. `preload`; elapsed time
   recorded separately, no timing threshold. → I5
3. Twelve concurrent calls on one instance acquire one root; failed initialization
   remains retryable. `concurrent`. → I5
4. Async reads see native edits and replacement files; removed old directory handles
   remain detached; native invalid receiver/argument errors remain native.
   `native` preservation probe. → I5

## Reference contract

Chromium 148.0.7778.96 native OPFS, real dedicated Worker without COI. Eager
sync-readable bytes remain ADR-0072's protocol; ADR-0358 owns the existing
write-through drain and its strictly drain-scoped directory cache.

## Parity cases

1. Native external write then async read returns current bytes; delete/recreate
   returns replacement bytes and old directory handle reports NotFoundError.
   Executed native observations in evidence; browser-only API, no Node analogue. → I5
2. Raw native method with invalid receiver or slash-containing filename returns
   TypeError. No wrapper/cache carrier is proposed; recorded native fixture
   establishes the existing behavior to preserve. → I5

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| quota-perm-fail × getFile preload | reject, never empty read/copy | `unreadable` | → I3 |
| quota-perm-fail × arrayBuffer preload | reject, never empty read/copy | `unreadable-bytes` | → I3 |
| concurrent-same-key × root init | share one acquisition; reject permits retry | `concurrent` | → I5 |
| poisoned-cache × external edit/delete/recreate | fresh read or ordinary missing-file error | `native` | → I5 |
| observable-order × native receiver/argument | native exceptions preserved | `native` | → I5 |

## Out of scope

Lazy sync reads, persistent native wrappers, new content cache policy, cross-realm
mirror coherence, install equality proof and warm-install authority. Unsupported
sync-OPFS realms retain NotImplementedError('OpfsFsSync'); no new capability claim.

## Challenge

challenge: 2026-09-08 — clear; single traversal uses handles already obtained; no native wrapper/invalidation mechanism needed.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ f822d4e2281bd66c28aeafbf63056309e23452a9 — docs/backlog/distribution/reference/issue319-contract-red.json

- 2026-09-08 — ADR-0393 records independent DEC-2 review; preparation only, Contract+RED remains with goal driver.
