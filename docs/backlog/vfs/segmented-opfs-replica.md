---
area: vfs
status: ready
title: One segmented OPFS substrate for base, mutations and compaction
created: 2026-08-31
why: current per-file drain is 10.320 s and fresh offline restore 4.465 s on Tracker; both storage budgets are 2 s
user_story: As an embedder or developer with a Tracker-scale persistent project, I want fast first storage flush and offline reload after package-scale edits without weakening durability honesty.
epic: fast-project-open-reopen
blocked_by: []
sources: ["issues #255/#256", ADR-0072, ADR-0358, docs/backlog/vfs/reference/storage-journal-design-benchmarks-2026-08-31.md, docs/backlog/vfs/reference/storage-open-reopen-candidate-benchmarks-2026-09-01.md]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs-preload.ts, packages/vfs/src/opfs.ts, packages/vfs/src/opfs-drain-scheduler.ts, packages/workbench/src/glue/install-stamp.ts, packages/workbench/src/glue/install-stamp-authority.ts, packages/workbench/src/workers/workbench-owner-storage.ts, packages/workbench/src/workers/no-coi-install-context.ts]
---

## Context

Accepted goal I1/I2/I5 storage boundary + I3 format trigger. T: 15,568 files /
73,637,414 bytes. Current native drain 10.320 s, fresh offline preload 4.465 s;
reference and independent DEC-2: `reference/segmented-replica-pickup.md`.
ADR-0425 selects one physical replica behind existing OpfsFsSync and its
ledger/scheduler. A+B are combined; no temporary per-file delta layer.

## Acceptance

1. Workbench/configured no-COI consumers use the same replica-backed OpfsFsSync
   under the captured namespace root. Standalone default per-file installation
   remains available. Sync reads are eager; no partial or lazy ready. → scenario, ADR-0425
2. Binary bytes, file/directory shape, copy/rename/delete and timestamps survive
   replay exactly. Healthy paired native reads return the committed bytes;
   live-cache equality cannot conceal native corruption. → scenario, ADR-0425
3. On T's committed path/size manifest, a 4-byte per-path discriminator prevents
   artificial same-size content dedup. Median flush tail ≤2 s; fresh-process
   offline restore ≤2 s before and after 5,000 changed paths (three samples).
   Every reopened byte is checked outside the restore timer. → I1, I2, I5
4. The store uses `/.rifty/workbench/v2`; a valid v1 definition/project is not
   adopted. New materialization uses its definition, old native bytes remain.
   The user-facing layout notice stays with the linked legacy unit. → I3

## Parity cases

- Existing OpfsFsSync and MemoryFsSync behavior remains the FsSync reference;
  no new Node API. Native-backed roundtrip covers binary data, structural
  changes and explicit utimes; existing sync and owner parity suites remain. → scenario, ADR-0425

## Fault matrix

| Boundary / fault | Required outcome and carrier | Trace |
|---|---|---|
| OPFS / corrupt-input | Invalid HEAD/segment/truncation: diagnosed cold restoration, no old file/claim publication; native bytes not deleted by recovery. `replica-persistence.spec.ts`. | → scenario, ADR-0425 |
| OPFS / provenance-lie | Corrupt native bytes while cache remains intact: paired read rejects; healthy paired reads succeed. Same native fixture. | → scenario, ADR-0392, ADR-0425 |
| OPFS / native read failure | NotReadableError rejects as OpfsPreloadError with cause, never cold-restore/memory success. Same fixture. | → ADR-0393, ADR-0411 |
| OPFS / quota-perm-fail + lossy-aggregate | One failed physical batch records its full logical footprint beyond the 20-entry sample; a single repaired path heals only itself. Same fixture, 230 writes. | → scenario, ADR-0358, ADR-0425 |
| OPFS / quota during compaction | Dirty report, prior HEAD/tree survives; no reachable old segment deleted. Same fixture after 63 append rounds. | → scenario, ADR-0425 |
| OPFS / concurrent-same-key | Second writer refused until previous physical work really settles or its Worker dies. Reporting timeout retains exclusion and fence; late success heals. Same fixture. | → scenario, ADR-0358, ADR-0425 |
| OPFS / lossy-aggregate after structural failure | Entry success never clears an unproven subtree; later full-scope proof heals only covered sequences. Both modes, rm/rename/failed mkdir/late rm. `opfs-structural-repair.spec.ts`. | → Acceptance 2, ADR-0429 |
| OPFS / reader-reclamation observable-order | readFile/stat/readdir and content already admitted before compaction finish without stale-segment ENOENT; GC follows real reader settlement. `replica-native-read.spec.ts`. | → Acceptance 2, ADR-0429 |
| Worker death / torn-state | Kill at native before/after-close during append and compaction: replay one complete old/new tree, never a mixed batch. Same fixture. | → scenario, ADR-0425 |

## Challenge

challenge: 2026-08-31 — 1 problem
Cheaper per-file index/lazy route was unmeasured. The 2026-09-01 benchmarks
resolved it: 4.42 s lazy burst versus 2.73 s preload; traced segment replay
1.14 s. Accepted goal rejects route R and pending-ready. Reuse that premise;
2026-09-12 independent DEC-2 selects existing owner/scheduler over a new
MemoryBackend-based owner, and removes the temporary delta substrate.

## Out of scope

- Legacy user-facing health/catalog notice: linked
  `vfs/legacy-per-file-layout-cold-restore`.
- Public openProject → Node command → offline reopen → real post-init npm
  install composition: required goal closure proof, explicitly still open in
  the goal map; isolated storage measurements do not claim it complete.
- Cross-project dedup, lazy sync I/O, guest overlays, native modules and a new
  public persistence default. Existing loud unsupported behaviors remain.
- General storage-pressure UX/reclaim of untouched v1 or orphan bytes.

## Decisions

- ready-verdict: 2026-09-12 — Contract+RED @ de8777d746f357a648ab0522101cbbada37cbf92

- re-cut: 2026-09-12 — merge predecessor segmented-replica-append-compaction into this unit; omit temporary per-file deltas; keep I1/I2/I3/I5 and Outcome (c) — trace: none
- 2026-09-12 — ADR-0425; DEC-2 /root/replica_decision; existing OpfsFsSync state, one scheduler batch mode, native physical guard, fresh native proof.
- 2026-09-12 — prior draft's compaction-quota append fallback replaced by exact failure + preserved HEAD; no second maintenance ledger/queue. Goal fault outcome is unchanged.
- 2026-09-12 — preparation carriers and actual RED outputs: `reference/segmented-replica-pickup.md`; no new Node oracle asserted.

- 2026-09-13 — Final review B1/B2 repair observed baseline under RDY-8; ADR-0429 and native RED carriers. B3 adds promised control refusal coverage.
