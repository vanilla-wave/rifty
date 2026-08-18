# ADR 0358: Bounded per-path parallel OPFS write-through drain with ancestor fencing and stamp barrier

Status: Accepted
Date: 2026-08

> TL;DR: `OpfsFsSync`'s write-through queue goes from globally-serial FIFO to a
> bounded ~16-lane per-path drain with ancestor-chain gating, rm/rename subtree
> fences, and an explicit full fence before every trusted-stamp write.
> Supersedes ADR-0187 (removed): only its FIFO-order contract falls; pending
> boot stamps, checked drains, and the persist-failure ledger stand — carried
> forward below.

## Context

`OpfsFsSync.enqueuePending` (`packages/vfs/src/opfs-sync.ts`) chains every
persist op behind `pendingTail` — globally serial by ADR-0187's recorded
contract ("FIFO order is load-bearing"). Measured on a real gravity-ui tree,
26 811 files / 166.8 MB (prototype branch `proto/opfs-flush-speed-256`, commit
a01870a5f, `tests/browser-unit/proto-opfs-flush-speed.spec.ts`): 16-lane
parallel drain with dir-handle reuse 8.0/9.1 s headed vs faithful serial
48.9/42.1 s → 4.6-6.1x (headless 3.1x). Saturation ~16 lanes; 4-worker
sharding lands on the same floor (per-origin OPFS backend serialization — all
shards finish within 4 ms of each other), so ~16 lanes is the ceiling for the
per-file layout; >10x needs a pack-format layout change — separate strategic
decision, deliberately out of scope (epic `project-open-drain-latency`
Decisions). The mkdir-dedup slice (epic I2) already cut op COUNT; this ADR
changes op ORDERING only.

ADR-0187 anticipated exactly this exit — its recorded contract at the enqueue
site: "Parallelizing this queue requires per-path ordering + an explicit stamp
barrier"; its Consequences: "the vfs FIFO pin fails loudly if attempted
naively." This ADR takes it (decision-workflow §Reconsidering); driving item
`vfs/opfs-parallel-write-through-drain`, epic invariant I3 (≥2.5x in the
headless browser-unit lane, clean ledger, reload e2e green).

Class-kill inventory (repo-wide, fault-classes §Class-kill; grep sweep
2026-08-15 over packages/ + apps/ for semaphore/tail/queue/concurrency
owners): (1) this FIFO — the mechanism being replaced; (2) install-stamp
authority per-root serialized slots (`install-stamp-authority.ts` `enqueue`)
— serializes trust CLAIMS by root, not I/O ops; consolidation owned by epic
`trusted-state-authority` (~7 mechanisms → one trust-claim authority);
(3) `packages/npm-client/src/utils/semaphore.ts` — FIFO counting semaphore
capping tarball fetches (network boundary, npm-client-internal). Reuse
REJECTED: npm-client sits above vfs (layer rules — reverse import
forbidden), and a counting cap is the trivial ~10 lines of the scheduler;
its correctness lives in per-path lane routing + fences, which no counting
semaphore provides. Moving a shared primitive down to vfs would couple
layers to share the smallest part of the mechanism; (4)
`apps/playground/src/glue/terminal-persistence.ts` `createWriteQueue` —
page-realm tail-promise serializer writing OPFS DIRECTLY through `OpfsVfs`,
physically outside the worker-realm `OpfsFsSync` queue (cross-realm class
captured in `vfs/opfs-sync-cross-realm-mirror-coherence`); cannot share the
in-worker scheduler; (5) `FifoPackageAcquisitionAuthority`
(`packages/workbench/src/workers/package-acquisition-authority.ts`) —
serializes install/edit COMMAND admission per project, a logical authority
whose separate ownership ADR-0261 already establishes; it schedules
commands, not persist ops — no consolidation with an I/O drain scheduler. The lane scheduler therefore stays INSIDE `OpfsFsSync`
— the single sync-mirror write-through owner — the one new mechanism the
epic Budget sanctions; no second OPFS-write-through owner is created.
Whether the stamp full fence belongs to the trusted-state authority
primitive instead of `promote()` is a Contract+RED question against that
epic.

## Decision

- **Bounded per-path lanes inside `OpfsFsSync`.** ~16 concurrent lanes; ops on
  the same path complete in enqueue order. The global FIFO contract is dropped.
- **Ancestor-chain gating.** A child write persists only after its ancestor
  mkdirs — `OpfsVfs.writeFile` creates no parents, so per-path ordering alone
  is insufficient.
- **Subtree fences for rm/rename.** A structural op on a path fences its whole
  subtree: ops under it neither overtake nor straddle it.
- **Explicit full fence before the trusted-stamp write.**
  `install-stamp-authority.ts` `promote()` writes the trusted stamp AFTER its
  proof flush; today only FIFO closes that window. `flush()`'s watermark is
  NOT the stamp barrier — the trusted-stamp write gets an explicit full fence
  (all previously enqueued ops settled) in `promote()`. One per transition,
  negligible cost.
- **Ledger survives out-of-order completion.** `operationSequence` compare,
  `healPersistFailure`, `healAncestorPersistFailures`,
  `clearPersistFailuresUnder` keep exact heal semantics under parallel settle —
  phantom/unhealable entries are the failure mode to pin.
- **Per-lane watchdog.** The per-op timeout + `reportBlockedPending`
  (blocked-behind-timed-out-head) are FIFO-shaped; redesigned per-lane so a
  wedged op reports itself and blocks only its own lane/fences.
- **Replacement pins.** The RED-on-parallelize FIFO pin in `opfs-sync.test.ts`
  is REPLACED by pins for: same-path order, ancestor-before-child, rm/rename
  fences (no straddle either side), stamp full-fence, and the admission
  ceiling (mixed-kind held ops: `1 < peak concurrency <= 16` — unbounded
  fan-out can never pass).
- **Dir-handle cache: ship it, drain-scoped.** Dir-handle reuse ships, scoped
  to a drain and structurally invalidated on rm/rename of any cached path — a
  cached handle never survives a structural op. Why: epic I3 demands ≥2.5x in
  the headless lane; headless measured 3.1x WITH reuse, without it the multiple
  risks 2.3-2.7x — at/under the floor. Stale-handle admissibility pinned by a
  fault row: rm/recreate mid-drain → correct bytes persisted. Alternative —
  ship without reuse (2.3-2.7x still lands headed) — rejected: headless I3
  margin unproven.

## Standing decisions carried from ADR-0187 (file removed)

- **Boot/restore stamp: non-blocking PENDING → trusted.** Boot writes a
  pending stamp (`durability:"pending"`) for the exact dep-set; pending never
  satisfies reuse. A deferred drain promotes to trusted only after a clean
  full-ledger report + unchanged deps; tree damage or dep drift discards it;
  stamp-file failure leaves it pending/untrusted. Crash/reload before
  promotion re-runs arrival instead of trusting an unproven tree.
- **Command site: drain→check→stamp→drain**, as amended by ADR-0216/ADR-0261:
  the sequence runs in BACKGROUND behind a pending-first, root-bound stamp;
  `npm install` exit does not await the drain. The checked-drain gate stands —
  a trusted stamp is written only over a clean guarded-scope ledger.
- **`flush()` never rejects and RETURNS the persist-failure ledger report.**
  Ordering callers ignore it; durability-promising callers gate on a clean
  report. A per-path failure heals on a later successful persist of the same
  path.
- **Reload honesty unchanged.** A reload at ANY moment mid-drain never trusts
  a stamp over an unproven tree; `owner-snapshot-restore-exec`
  install-survives-reload stays green; a mid-drain kill e2e is a tier
  obligation of the implementing item.
- **Reload-critical drains untouched**: dev-ready drain
  (`devServerChild.boot({flush})`), eval-boundary flush, project-index and
  starter-baseline flushes.

## Consequences

- Big-tree durability drain drops 4.6-6.1x headed / ~3.1x headless (measured);
  the per-file layout ceiling stays — ~16 lanes saturate the per-origin
  backend; >10x remains a pack-format decision, not made here.
- Compile/test churn: the FIFO pin is deleted and four replacement pins added;
  watchdog + `reportBlockedPending` rewritten per-lane; fault rows for
  out-of-order ledger heal (failed path recorded exactly, later same-path
  success heals), per-lane mid-queue isolation, quota-fail during parallel
  drain (stamp refused, live session unaffected), reload mid-drain (pending
  never trusted), stale dir-handle after rm/recreate.
- `promote()` pays one explicit full fence per trusted-stamp transition
  (negligible — one per stamp write).
- ADR-0261's scope note "Its persist-ledger, checked-drain, FIFO, and
  pending-boot rules stand" is overtaken for the FIFO clause only (corrected
  in place there).
