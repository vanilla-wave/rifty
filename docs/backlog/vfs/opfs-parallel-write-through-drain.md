---
area: vfs
status: draft
title: Bounded-parallel per-path OPFS write-through drain (supersedes FIFO-order contract)
created: 2026-08-15
why: the globally-serial FIFO drain is the 96%-of-project-open cost on big trees; bounded ~16-lane per-path drain measured 4.6-6.1x headed on a real node_modules slepok
user_story: As a developer opening a project with a heavy node_modules, I want the durability flush to finish in seconds, but today the write-through queue drains strictly serially and a 26.8k-file tree takes 40+ seconds
blocked_by: []
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md, docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md]
code: [packages/vfs/src/opfs-sync.ts, packages/workbench/src/glue/install-stamp-authority.ts]
---

## Context

`OpfsFsSync.enqueuePending` (opfs-sync.ts:744) chains every persist op behind
`pendingTail` — globally serial by recorded contract: "FIFO is load-bearing
(ADR-0187 Corrected) … Parallelizing this queue requires per-path ordering +
an explicit stamp barrier (tripwire: the FIFO pin in opfs-sync.test.ts)". The
exit is thus ANTICIPATED by the ADR; taking it = superseding ADR via decision
subagent (decision-workflow §Reconsidering), replacement pins, mechanism sweep.

Measured (prototype `proto/opfs-flush-speed-256`, commit a01870a5f,
`tests/browser-unit/proto-opfs-flush-speed.spec.ts`, real gravity-ui tree
26 811 files / 166.8 MB, Playwright 1.60.0 Chromium): 16-lane parallel drain
with dir-handle reuse 8.0/9.1 s headed vs faithful serial 48.9/42.1 s →
4.6-6.1x (headless 3.1x). Saturation at ~16 lanes; 4-worker sharding lands on
the same floor (per-origin backend serialization — all shards finish within
4 ms of each other) → parallel-16 is the ceiling for the per-file layout;
&gt;10x requires a pack-format layout change (separate strategic decision,
deliberately out of scope here).

Design obligations discovered by 4-lens adversarial review of the prototype
(all verdicts holds-with-caveats; recorded in RESULTS.md on the branch):

- per-path ordering alone is INSUFFICIENT: needs ancestor-chain gating (child
  write persists only after its ancestor mkdirs — OpfsVfs.writeFile creates no
  parents) and subtree fences for rm/rename;
- flush()'s watermark is NOT the stamp barrier: promote() writes the trusted
  stamp AFTER the proof flush with only FIFO closing that window today → the
  supersede must add an explicit full fence before the trusted-stamp write
  (one per transition, negligible cost);
- ledger heal semantics (`operationSequence` compare, `healPersistFailure`,
  `healAncestorPersistFailures`, `clearPersistFailuresUnder`) must survive
  out-of-order completion — phantom/unhealable entries are the failure mode;
- per-op watchdog + `reportBlockedPending` (blocked-behind-timed-out-head) are
  FIFO-shaped → per-lane redesign;
- the RED-on-parallelize pin in opfs-sync.test.ts is REPLACED by pins for:
  same-path order, ancestor-before-child, rm/rename fences, stamp full-fence;
- dir-handle cache admissibility (the 2.7x→3.7x delta) is unresolved: stale
  handle semantics after rm/recreate unverified; keep it drain-scoped and
  structurally invalidated, or ship without it (2.3-2.7x still lands).

Class-kill inventory (fault-classes §Class-kill, recorded at capture):
serialization mechanisms already owning nearby invariants — (1) this FIFO
(opfs-sync.ts:744); (2) install-stamp authority per-root serialized slots
(install-stamp-authority.ts `enqueue`); (3) `epics/trusted-state-authority`
(ready) inventories ~7 hand-rolled coordination mechanisms over 3 modules and
is landing ONE trust-claim authority. The lane scheduler stays INSIDE
OpfsFsSync (the single OPFS write-through owner) — no new cross-module
mechanism; whether the stamp full-fence belongs to the trusted-state authority
primitive instead of promote() is a Contract+RED question against that epic.

Fault rows to pin (Storage boundary, full surface): out-of-order op fails →
ledger records exactly the failed path, later same-path success heals;
mid-queue isolation per lane; quota-fail during parallel drain → stamp
refused, live session unaffected; reload during parallel drain → pending
stamp never trusted (ADR-0187 boot semantics unchanged); e2e:
`owner-snapshot-restore-exec` install-survives-reload stays green.

Acceptance proof for the shipped capability (DoD): real-browser measurement on
a big tree (browser-unit lane) showing the drain wall-clock multiple, plus the
untouched reload-survival e2e — a source grep or unit-only proof does not
close it.

Candidate shared epic with `vfs/opfs-mkdir-persist-dedup` and
`playground/project-open-durability-progress`.
