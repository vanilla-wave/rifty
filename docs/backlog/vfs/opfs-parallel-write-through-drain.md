---
area: vfs
status: ready
title: Bounded-parallel per-path OPFS write-through drain (supersedes FIFO-order contract)
created: 2026-08-15
why: the globally-serial FIFO drain is the 96%-of-project-open cost on big trees; bounded ~16-lane per-path drain measured 4.6-6.1x headed (3.1x headless) on a real node_modules slepok
user_story: As a developer opening a project with a heavy node_modules, I want the durability flush to finish in seconds, but today the write-through queue drains strictly serially and a 26.8k-file tree takes 40+ seconds
epic: project-open-drain-latency
blocked_by: []
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/vfs/0358-bounded-per-path-parallel-opfs-write-through-drain-with-ancestor-fencing-and-stamp-barrier.md, docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md]
code: [packages/vfs/src/opfs-sync.ts, packages/workbench/src/glue/install-stamp-authority.ts]
---

## Context

`OpfsFsSync.enqueuePending` (opfs-sync.ts:744) chains every persist op behind
`pendingTail` — globally serial by ADR-0187's recorded contract. That exit was
anticipated by the ADR itself and is now TAKEN: **ADR-0358** (this branch;
decision subagent per decision-workflow §Reconsidering; ADR-0187 removed,
pointer in `docs/adr/README.md`) decides bounded ~16-lane per-path drain
inside `OpfsFsSync`, ancestor-chain gating, rm/rename subtree fences, an
explicit full fence before the trusted-stamp write in
`install-stamp-authority.ts` promote(), per-lane watchdog, replacement pins,
and a drain-scoped structurally-invalidated dir-handle cache. This item
implements ADR-0358; its contract terms are not re-decided here.

Measured (prototype `proto/opfs-flush-speed-256`, commit a01870a5f, real
gravity-ui tree 26 811 files / 166.8 MB / 2 314 dirs, Playwright 1.60.0
Chromium): 16-lane + dir-handle reuse 8.0/9.1 s headed vs faithful serial
48.9/42.1 s → 4.6-6.1x; headless 12.1 s vs 37.6 s → 3.1x; deduped-serial
(post-slice-1 regime) 28.5 s headless. Saturation ~16 lanes; 4-worker
sharding lands on the same floor (per-origin backend serialization);
>10x = pack format, out of scope (epic Decisions).

Class-kill sweep (fault-classes §Class-kill): serialization owners nearby —
(1) this FIFO (opfs-sync.ts:744); (2) install-stamp authority per-root
serialized slots (`install-stamp-authority.ts` `enqueue`); (3) epic
`trusted-state-authority` (ready) landing ONE trust-claim authority over ~7
hand-rolled mechanisms. The lane scheduler stays INSIDE `OpfsFsSync` — the
single OPFS write-through owner, the one new mechanism the epic Budget
sanctions. Whether the stamp full fence belongs to the trusted-state
authority primitive instead of promote() is that epic's Contract+RED
question (ADR-0358 Context); this item lands it in promote().

The real tree for acceptance is COMMITTED as
`tests/browser-unit/fixtures/real-tree-manifest.json` — paths+sizes of a real
npm-installed gravity-ui node_modules (regenerated 2026-08-15 from the
registry with the prep dep-set of a01870a5f: 26 811 files / 166 782 155
bytes / 2 314 dirs — byte-identical scale to the prototype tree). Bytes are
procedural at test time: OPFS drain cost is structure+size, not content;
committing 166 MB of real bytes buys no fidelity.

## Acceptance

Browser-unit (default lane, real Chromium worker + real OPFS), committed
executable carrier `tests/browser-unit/opfs-parallel-drain.spec.ts` +
`fixtures/opfs-parallel-drain-worker.ts` — DESIGNED RED on main:

- Real ≥20k-file node_modules tree (manifest gate `files >= 20_000`; actual
  26 811) driven through REAL `OpfsFsSync.init` over REAL `OpfsVfs`, twice in
  ONE run (I3 "same run, same machine"):
  1. **faithful-serial baseline** — pre-epic #256 regime: mkdir before every
     write (pre-dedup caller shape), every persist op individually awaited
     (`flush()` after each) ⇒ completion order == call order BY CONSTRUCTION
     — the superseded serial contract stays measurable after parallelization
     without any lane knob;
  2. **product drain** — the landed caller shape (slice-1 dedup: one mkdir
     per distinct dir) + ONE `flush()` — on main a serial FIFO drain, after
     this item the ~16-lane parallel drain.
- Gates: speedup = faithfulMs/productMs **≥ 2.5** (I3; RED on main —
  measured ~1.3x); both `flush().total === 0`; tail file byte-exact through
  a FRESH `OpfsVfs` per variant; wall-clock logged (`PD256-ACCEPTANCE` JSON
  line) for the PR record, no absolute-time CI assert (variance).

Mid-drain kill e2e (tier obligation, epic Decisions "Preserved constraint"),
committed carrier `tests/browser-unit/opfs-parallel-drain-kill.spec.ts` +
worker — GREEN on main, must survive the parallel drain: real OPFS project,
real install-stamp authority (`setSyncMirror` + `SyncMirrorVfs` +
`createInstallStampAuthority`), demote → tree write → promote() with the
real flush seam; worker TERMINATED on a DISCRIMINATED mid-drain ack
(`0 < completed < total` durably-closed writes); fresh realm proves the
stamp is NOT trusted (the boot path's own trust check), then a full re-run
ends trusted with a clean ledger and byte-exact spot verify. This carrier
owns the stamp-trust dimension slice-1's kill carrier explicitly excluded.

Unit replacement pins (opfs-sync.test.ts, committed; ADR-0358 "Replacement
pins"):

- RED R1 — ops on DIFFERENT paths complete out of call order under inverted
  latencies (parallel lanes); replaces the FIFO pin, whose deletion is part
  of the implementation commit (it inverts from GREEN to RED the moment
  lanes land — leaving it would make the suite self-contradictory);
- RED R2 — an op on an unrelated path behind a 30s-timed-out head is
  neither blocked nor ledgered (per-lane watchdog; on main FIFO admission
  wedges it and `reportBlockedPending` ledgers it);
- GREEN P1 — same-path ops complete in call order under inverted latencies;
- GREEN P2 — ancestor mkdir persist completes before its child write
  persist;
- GREEN P3 — rm/rename subtree fences: ops under a structural op neither
  overtake nor straddle it (write → rm → recreate → write completion order;
  rename persists after earlier writes inside the moved subtree).

Stamp-fence pin (install-stamp-authority.fault.test.ts, committed, GREEN):
a trusted stamp never becomes durable at the OPFS surface while an
earlier-enqueued persist op is unsettled — pinned with a wedged
out-of-guarded-scope op held past the 30s report bound; on main FIFO
delivers it, ADR-0358's explicit fence must preserve it (P4).

Implementation obligations landing in the implementation commit (named here
so the carriers above stay honest): delete the FIFO pin (R1 replaces it);
per-lane watchdog + `reportBlockedPending` redesign; ledger heal semantics
(`operationSequence` compare, `healPersistFailure`,
`healAncestorPersistFailures`, `clearPersistFailuresUnder`) surviving
out-of-order settle; dir-handle cache structural invalidation with its own
stale-handle fault test (rm/recreate mid-drain → recreated bytes persisted,
never a stale-handle write into a dead subtree — no cache exists on main,
so that specific row is only executable once the cache does).

## Parity cases

Drain-observable behavior narrows to ADR-0358's contract; everything else
must not move:

- P1-P4 above (same-path order, ancestor gating, structural fences, stamp
  fence).
- P5 `flush()` report contract unchanged: never rejects, returns
  `{failures, total, anyFailure}`, `total === 0` ⇔ drained is durable;
  existing persist-failure ledger + watchdog suites in opfs-sync.test.ts
  bind except the two FIFO-shaped pins R1/R2 replace.
- P6 reload honesty unchanged: pending stamps never trusted (kill e2e
  above); existing restore e2e pins (`snapshot|archive` specs) and
  `owner-snapshot-restore-exec` install-survives-reload stay green.
- P7 foreign-rm differential (cross-realm class, ON MAIN): row (f) carriers
  in `workspace-archive.fault.test.ts` stay green — the parallel drain must
  not be quieter than main on the same schedule
  (`vfs/opfs-sync-cross-realm-mirror-coherence` owns the class).

New RED targets (failing-test-first, all committed with this contract):
R1 cross-path parallel completion, R2 per-lane watchdog liberation,
R3 browser acceptance speedup ≥ 2.5x. GREEN preservation carriers committed
alongside: P1-P4, kill e2e, and the fault rows below.

## Fault matrix

Storage boundary (OPFS) through `OpfsFsSync`; tier production (epic).

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | quota-perm-fail × one lane mid-parallel-drain | one path's persist rejected while sibling lanes succeed | ledger records EXACTLY the failed path; `flush().total > 0` → stamp refused (guarded scope); sibling lanes complete — carrier: R2 pin (isolation half) + existing ledger suite (record/report half) |
| b | heal × later same-path success | failed path persists successfully later | entry heals under out-of-order settle (`operationSequence` compare) → `total` returns 0 — carrier: existing heal suite binds unchanged (P5); out-of-order variant is an implementation-commit extension of the same suite |
| c | torn-state × mid-drain realm death with pending stamp | worker killed while promote()'s drain is in flight | fresh realm: stamp NOT trusted; full re-run → trusted, clean ledger, byte-exact — carrier: kill e2e (committed, GREEN on main, tier obligation) |
| d | timeout-wedge × unrelated lanes | one op held past the 30s report bound | bounded `flush()` ledgers ONLY the wedged path; unrelated lanes complete un-ledgered (R2); the trusted-stamp write stays un-durable while the wedge is in flight (P4 fence pin) |
| e | stale-dircache × rm/recreate mid-drain | subtree removed+recreated while drain-scoped dir handles are cached | recreated bytes persisted, cached handle never survives a structural op — pre-implementation artifact: P3 structural-fence pin (order half); the cache-specific stale-handle row lands with the cache itself (no cache on main to poison) |
| f | concurrent-same-key × foreign realm rm | foreign realm removes persisted subtree mid-drain | not quieter than main on the same schedule — carrier: existing row (f) differential pins in workspace-archive.fault.test.ts stay green (P7); class owned by the cross-realm intake item |

## Out of scope

- Pack-format storage (epic Decisions — rejected; >10x ceiling evidence in
  prototype RESULTS).
- Cross-realm mirror coherence (`vfs/opfs-sync-cross-realm-mirror-coherence`
  intake owns the class; P7 only pins non-regression).
- Drain progress events — slice 3
  (`playground/project-open-durability-progress`).
- Moving the stamp fence into the trusted-state authority primitive — that
  epic's Contract+RED question (ADR-0358 Context).
- Any restore/apply caller change — slice 1 landed it; the caller shape is
  an input here.

## Decisions

- ADR-0358 (decision subagent, this branch) supersedes ADR-0187 per
  decision-workflow §Reconsidering — removed file, README pointer, standing
  0187 decisions carried forward verbatim-in-substance. The dir-handle
  cache SHIPS drain-scoped + structurally invalidated (ADR-0358 Decision:
  headless I3 margin — 3.1x with reuse vs 2.3-2.7x risk without;
  alternative recorded and rejected there).
- I3 baseline interpretation (named clauses): the epic Outcome quotes the
  FAITHFUL pre-epic drain as the baseline ("48.9/42.1 s → 8.0/9.1 s
  headed") and I3's "serial baseline measured in the same run" is that
  regime — NOT the post-slice-1 deduped serial. A deduped reading would
  make I2's landing weaken I3 (two slices of one epic fighting — measured:
  faithful 37.6 s vs deduped 28.5 s headless shrinks the same parallel
  drain from 3.1x to ~2.4x). The deduped-serial ratio is recorded here for
  honesty; the invariant gates on the faithful baseline, measured in the
  same run through the same real mechanism.
- Serial-baseline carrier (§Simplicity): per-op awaited `flush()` at the
  driver ⇒ completion order == call order by construction, on main AND
  after lanes land. NO lane-count knob ships — the contract is deliverable
  without it, so a config surface would be removable machinery (per-op
  await adds an event-loop turn per op, noise against 1-3 ms/op OPFS
  cost).
- Reversibility: mechanism change is IRREVERSIBLE and recorded (ADR-0358);
  no cross-package API change (`OpfsFsSync` construction surface
  unchanged — no knob), no new dependency.
- Budget: slice **parallel-drain** band 250-600 SOURCE insertions
  (`check:budget` — tests, docs/backlog/**, generated globs excluded; the
  committed manifest fixture and carriers are tier obligations, DoD binds
  acceptance to the same PR). New coordination mechanisms: the ONE
  epic-sanctioned lane scheduler inside OpfsFsSync.
- RED evidence (pre-implementation runs on this branch, 2026-08-15, darwin
  arm64, node v24.16.0, vitest 2.1.9, Playwright 1.60.0 Chromium):
  - `npx vitest run packages/vfs/src/opfs-sync.test.ts` → `2 failed | 71
    passed | 1 skipped (74)`: exactly R1 and R2 FAIL as designed (R1:
    `expected [ '/slow', '/fast' ] to deeply equal [ '/fast', '/slow' ]`;
    R2: `expected [] to deeply equal [ '/other' ]` — '/other' never
    reaches the surface behind the wedged FIFO head), P1-P3 + every
    pre-existing suite (incl. the still-present FIFO pin) PASS.
  - `npx vitest run packages/workbench/src/glue/install-stamp-authority.fault.test.ts`
    → `2 passed` incl. the P4 fence pin; pin's kill-power proven against a
    transient no-FIFO-admission mutant during authoring (fence assertion
    fails on it), file restored byte-exact.
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts
    tests/browser-unit/opfs-parallel-drain.spec.ts
    tests/browser-unit/opfs-parallel-drain-kill.spec.ts` → `1 failed, 1
    passed (1.3m)`: acceptance FAILS ONLY the I3 ratio gate — measured
    `speedup: 1.4` (`Expected: >= 2.5`), faithfulMs 41 202 / productMs
    29 521 on the 26 811-file real manifest, both ledgers 0, both tails
    byte-exact (`PD256-ACCEPTANCE` JSON in the run log); kill e2e PASSES
    (discriminated mid-drain kill, fresh realm refuses the stamp, retry
    ends trusted + clean ledger + byte-exact spot verify).
