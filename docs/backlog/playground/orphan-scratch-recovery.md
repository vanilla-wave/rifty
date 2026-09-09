---
area: playground
status: ready
title: Retain downloadable orphan Scratch bytes while opening a fresh Scratch
created: 2026-09-07
why: An unjournaled Scratch tree blocks catalog creation with no public recovery path.
user_story: As the Tracker plugin-sandbox embedder, I want to retain downloadable orphan scratch bytes while opening a fresh scratch, but today an unjournaled Scratch tree blocks catalog creation with no public recovery path.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0406, ADR-0407, ADR-0279, ADR-0402]
code: [packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workbench/playground.ts, packages/workbench/src/workbench/internal/playground-archive.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

A real Chromium probe creates Scratch/tree/user.txt without catalog or journal,
then public Workbench boot rejects `Catalog mutation target already exists:
scratch`. Normal journaled crash recovery already has passing fault tests; the
cause of the report's unjournaled state is not established.

User choice: retain the orphan's bytes for enumeration/download via public API
and open fresh Scratch, without treating the old tree as a runnable project.
Downloads retain relative paths and exact ordinary bytes, including build output
and dependency files; internal trust claims are not admitted as restored trust.
Retained data survives close/reopen and stays in the selected namespace. No
automatic retention eviction/deletion. If preservation fails (quota, permission,
interruption), leave the only copy intact and surface the failure; do not claim
fresh Scratch/recovery success. A failed download remains retryable without
consuming the saved bytes.

The existing catalog transaction owner must remain the mutation authority.
Carrier/API/metadata choices belong to an ADR citing ADR-0279, with Class-kill
before any extra journal. Prove preserve → fresh boot → download → reload in
real OPFS, plus interruptions at the new persistent transitions.

Scope and user decisions: goal I6. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Reference contract

Accepted I6/scenario6 and the user's retain/download plus fresh-Scratch choice
own the result. ADR-0407 chooses the bounded public API/envelope and existing
catalog transaction route. ADR-0406 is the independently decided repair of an
observed read/copy defect, with real native baseline rather than a new simulated
filesystem contract. Pickup and executed evidence:
reference/orphan-scratch-recovery-pickup.md and
reference/orphan-scratch-recovery-evidence.md. No new maximum-project-size,
latency, eviction or arbitrary private-package promise.

## Acceptance

1. After existing catalog/legacy journal validation/recovery, createScratch preserves an unjournaled existing Scratch payload before replacing its occupied root with the requested fresh definition. Referenced/journal-owned state is not treated as orphan; malformed state remains preserved/loud. → I6, scenario6, ADR-0279, ADR-0407
2. Existing catalog FIFO/compact transaction publishes retained ownership only after ordinary copy durability. Before the catalog pointer the original remains the rollback source; after it retained ownership survives cleanup/reopen. Source cleanup precedes new orphan detection; repeated create/reopen cannot duplicate the same retention. Fresh creation is a subsequent transaction; its failure leaves committed retained bytes/record. → I6, ADR-0279, ADR-0407
3. Public catalog.listRetainedScratch and exportRetainedScratch expose stable opaque ids and non-consuming JSON downloads without a live ProjectSession, including while fresh Scratch is live and after reopening persistent storage. Unknown ids, closed owner, read failure or export overflow reject without consuming data. → I6, scenario6, ADR-0407
4. Retention/download preserves exact ordinary bytes and relative paths, including binary/source, node_modules, dist, Git, .vite, nested .rifty and empty directories. Only root-private .rifty and existing install-claim namespaces are excluded; ordinary similar names stay. Retained data receives no runnable definition, install identity or privileged claim. Normal archive ingress does not admit the recovery envelope as trusted state. → I6, ADR-0407, ADR-0261
5. Recovery JSON has distinct format/version, logical root /, explicit directories and canonical base64 files; no physical namespace/root leaks. Existing numeric archive bounds apply to allocation, never silent omission/truncation. Measured representative real produced Vite payload fits; over-limit export leaves retained storage untouched and retryable. Retention is independent file-by-file storage, not capped by export-string limits. → I6, ADR-0407
6. Missing cold OPFS cache content raises EIO on sync read/copy; healthy and genuine empty cached files work. Copy refuses before overwriting a destination, cp retains its existing partial-output/error ordering, native uncached rename keeps read/write-before-source-removal. Successful existing preload/write restores availability. Metadata size0 and clean flush cannot authorize fabricated empty bytes. → I6, ADR-0406, ADR-0072, ADR-0090
7. Real selected OPFS namespace survives native Worker/page interruption around retention copy, catalog pointer, source cleanup and subsequent fresh creation. Before commit original ordinary bytes survive with no false ownership; after commit retained bytes/id survive and recovery completes cleanup. Default/sibling namespaces and unrelated files stay exact. → I6, I4, ADR-0407, ADR-0402, ADR-0358
8. Mandatory packed public consumer using copied assets and snapshot-only exercises real orphan preservation, usable fresh snapshot-backed Scratch, public list/download and persistent reopen. Downloaded ordinary dependency/build/source bytes match actual source bytes; registry/Eddy egress remains zero. → I1, I2, I3, I4, I6, scenario6

## Parity cases

1. Actual Chromium OPFS file bytes/entries, including refusal and fresh-Worker observations, are the storage oracle; real Memory VFS/catalog tests supplement it. Unavailable source bytes cannot become successful empty copies. → I6, ADR-0406, ADR-0407
2. Real Node/public producer supplies the representative Vite dependency tree and native build output used for export sizing/byte checks; this adds no package compatibility or general Node filesystem mounting claim. → I1, I6, ADR-0407

## Fault matrix

| axis × operation | honest outcome / carrier | trace |
|---|---|---|
| false-fallback/provenance-lie × cold preload/read/copy | metadata+byte refusal remains unavailable; no fabricated empty read/copy, real empty control stays valid | → I6, ADR-0406 |
| sibling-drift × read/copy/cp/rename/export | one cache-read chokepoint; existing async rename custody/order retained; native source bytes are oracle | → I6, ADR-0406, ADR-0090 |
| quota-perm-fail × retention copy/flush | no new ownership or fresh-success before durable preservation; original stays intact, retry possible | → I6, ADR-0407 |
| torn-state × retention pointer/cleanup/fresh creation | native kills prove before/after custody, id stability, cleanup and no duplicate retention | → I6, ADR-0279, ADR-0407 |
| corrupt-input × catalog/journal/id/archive | malformed/unresolved metadata cannot steal/clear source; unknown id and invalid envelope fail without consumption | → I6, ADR-0407 |
| provenance-lie × copied claims/paths | root-private and true claim namespaces excluded; ordinary lookalikes retained; no definition/trust minted | → I6, ADR-0261, ADR-0407 |
| observable-order × create/list/export/reopen | existing owner FIFO/lifetime; committed retention remains observable even if later fresh creation fails | → I6, ADR-0279, ADR-0407 |
| unbounded-read × recovery export | finite entry/path/file/total/JSON allocation, overflow/read failure rejects with retained bytes intact | → I6, ADR-0407 |

## Out of scope

Arbitrary named-project adoption, restored trust, editable archive import changes,
new recovery UI, public delete/eviction, storage migration/concurrent owners,
new export-size promise or streaming codec. Populated-cache repeated-refresh
coherence remains the existing vfs/opfs-sync-cross-realm-mirror-coherence finding;
this cold-cache repair does not invalidate current sync writes or add an epoch.
I5 preview prefix and I7 operation budgets remain separate goal obligations.

## Decisions

- ready-verdict: 2026-09-09 — Contract+RED @ 5f9c7a1b5cbefa71780db8f76f3363f98f98cb43; reference/orphan-scratch-recovery-contract-red.json.

- 2026-09-09 — pickup: ADR-0406 repairs captured cold-cache byte fabrication; ADR-0407 uses the existing catalog pointer/roles and distinct bounded recovery download. Existing vfs/opfs-preload-failure-empty-bytes is a required prerequisite consumed by this unit.
- 2026-09-07 — finding draft; observable scope is settled by goal I6; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
