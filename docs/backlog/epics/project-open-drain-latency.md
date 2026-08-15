---
kind: epic
status: ready
title: Heavy-node_modules project open — fast, honest durability drain
created: 2026-08-15
value: Opening a project with a heavy real node_modules stops looking like a hang — the durability flush drops from ~40s to seconds and the host always sees honest progress, with reload-honesty guarantees intact and no on-disk format change.
user_story: As a developer opening a real frontend project (gravity-ui stack, 14-27k files) from a baked snapshot, I want the open to finish in seconds and show real progress, but today the write-through drain is globally serial (~2 FIFO ops per file) and mute — 40s of spinner indistinguishable from a hang.
tier: production
---

## Outcome

The install-stamp durability drain on big trees becomes bounded-parallel with
deduped mkdir persists (measured on a real 26 811-file gravity-ui slepok:
48.9/42.1 s → 8.0/9.1 s headed), and the owner port reports honest
counts-based progress during any drain. The per-file OPFS layout, the
persist-failure ledger semantics, and ADR-0187's reload honesty (pending
stamps, checked drains) are preserved; the FIFO-order contract is superseded
by per-path ordering + ancestor fencing + an explicit stamp barrier — the exit
ADR-0187 itself anticipated. Pack-format storage is explicitly NOT part of
this epic (separate strategic decision).

Prototype evidence: branch `proto/opfs-flush-speed-256` (commit a01870a5f),
`tests/browser-unit/proto-opfs-flush-speed.spec.ts` + RESULTS.md; 4-lens
adversarial review verdicts holds-with-caveats, caveats folded into the item
contracts.

## User scenario

A developer opens a project whose baked snapshot materializes a ≥20k-file
node_modules in Chromium. The host UI shows a progress indicator advancing
with real persisted-file counts; the durability flush completes in single-digit
seconds on reference hardware (vs ~40s today); reloading at any moment
mid-drain reopens an honest project (no trusted stamp over an unproven tree);
`npm install` terminal output remains byte-parity-clean (no new lines).

## Invariants

<!-- Each false on main; evidence checked 2026-08-15. -->

<!-- I1 false: WorkbenchOwnerHealthEvent union carries only fatal-invariant |
     persistence (packages/workbench/src/workbench/workbench-owner-port.ts:33);
     grep of packages/workbench finds no drain progress mechanism. -->
- I1. During a snapshot-restore durability drain of a ≥10k-file tree, the
  workbench owner health stream delivers `durability-progress` events with
  monotone non-decreasing `persisted` counts and a terminal event where
  `persisted === total`; a wedged OPFS op is distinguishable from progress
  (counts stop while the drain reports unfinished).
<!-- I2 false: OpfsFsSync.mkdirSync persists unconditionally
     (packages/vfs/src/opfs-sync.ts:950) and restore mkdirs before every write
     (workspace-archive.ts:230) — prototype faithful run measures ~2 persist
     ops/file (48.9s vs mkdir-deduped 26.7s on the same tree). -->
- I2. Restoring an N-file, D-dir tree enqueues at most N + D + O(1) OPFS
  persist operations — never ~2N — with ledger heal-on-retry preserved (a
  previously-failed mkdir path is still re-persisted and healed).
<!-- I3 false: enqueuePending chains every op behind pendingTail — globally
     serial by recorded contract (packages/vfs/src/opfs-sync.ts:744, ADR-0187
     pin); the drain multiple over serial is 1.0x by construction. -->
- I3. A browser-unit proof on a real ≥20k-file node_modules tree shows the
  durability drain completing ≥2.5x faster than the serial baseline measured
  in the same run on the same machine, with a clean flush ledger and the
  reload-survival e2e (`owner-snapshot-restore-exec`) green.

## Items

1. `playground/restore-mkdir-persist-dedup` — **mkdir-dedup** — serial
   op-count fix in the restore apply loop; no ordering change; lands first.
   (Re-refined carrier of `vfs/opfs-mkdir-persist-dedup` after two
   Contract+RED blockers — lineage in the item.)
2. `vfs/opfs-parallel-write-through-drain` — **parallel-drain** — superseding
   ADR to 0187 (decision subagent), per-path lanes + ancestor fencing + stamp
   barrier + per-lane watchdog + replacement pins; after mkdir-dedup.
3. `playground/project-open-durability-progress` — **drain-progress** — new
   `durability-progress` health-event kind, counts done/total, owner-port only;
   ADR for the public API; independent of parallel-drain (works on the serial
   drain too).

## Budget

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0, except the lane scheduler owned by
  `vfs/opfs-parallel-write-through-drain` inside OpfsFsSync (Class-kill
  inventory recorded in that item)

| slice | band |
|---|---|
| mkdir-dedup | 20–80 |
| parallel-drain | 250–600 |
| drain-progress | 80–250 |

## Decisions

- invariants-signoff: 2026-08-15 — user
- tier: production — the parallel drain rewrites the mechanism inside
  ADR-0187's reload-honesty window; crash/reload e2e proof is contractual, not
  optional (user-confirmed 2026-08-15).
- Fork resolutions (rifty-refine 2026-08-15, user-chosen): progress shape =
  counts done/total (arrival doubles as heartbeat); channel = new
  `durability-progress` kind on the existing WorkbenchOwnerHealthEvent stream
  (smallest honest surface; compile-time break for exhaustive switches is an
  accepted, loud migration); reach = owner-port only, `npm install` terminal
  output stays byte-parity-clean.
- Preserved constraint (not an invariant — already true on main): reload at
  any moment never trusts a stamp over an unproven tree (ADR-0187 pending
  stamps); the parallel-drain item proves it survives the new mechanism via
  mid-drain kill e2e (tier obligation).
- Pack-format storage rejected for this epic: >10x requires an on-disk layout
  change with format-versioning obligations — separate strategic decision,
  evidence in prototype RESULTS.md.
