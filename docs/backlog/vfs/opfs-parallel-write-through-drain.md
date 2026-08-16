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
`install-stamp-authority.ts` promote(), per-lane watchdog, replacement pins
(incl. the admission-ceiling pin), and a drain-scoped
structurally-invalidated dir-handle cache. This item implements ADR-0358;
its contract terms are not re-decided here.

Measured (prototype `proto/opfs-flush-speed-256`, commit a01870a5f, real
gravity-ui tree 26 811 files / 166.8 MB / 2 314 dirs, Playwright 1.60.0
Chromium): 16-lane + dir-handle reuse 8.0/9.1 s headed vs faithful serial
48.9/42.1 s → 4.6-6.1x; headless 12.1 s vs 37.6 s → 3.1x; deduped-serial
(post-slice-1 regime) 28.5 s headless. Saturation ~16 lanes; 4-worker
sharding lands on the same floor (per-origin backend serialization);
>10x = pack format, out of scope (epic Decisions).

Class-kill sweep (fault-classes §Class-kill, REPO-WIDE — grep sweep
2026-08-15 over packages/ + apps/ for semaphore/tail/queue/concurrency
owners; full rationale recorded in ADR-0358 Context): (1) this FIFO — the
mechanism replaced; (2) install-stamp authority per-root serialized slots
(`install-stamp-authority.ts` `enqueue`) — serializes trust CLAIMS, not I/O
ops; consolidation owned by epic `trusted-state-authority`; (3)
`packages/npm-client/src/utils/semaphore.ts` — FIFO counting semaphore
capping tarball fetches (network boundary, npm-client-internal); reuse
REJECTED: npm-client sits ABOVE vfs (reverse import forbidden by
`check:arch`), and a counting cap is the trivial ~10 lines of the lane
scheduler — its correctness is per-path routing + fences, which no counting
semaphore provides; moving a shared primitive down would couple layers to
share the smallest part; (4)
`apps/playground/src/glue/terminal-persistence.ts` `createWriteQueue` —
page-realm tail serializer writing OPFS DIRECTLY through `OpfsVfs`,
physically outside the worker-realm `OpfsFsSync` queue (cross-realm class:
`vfs/opfs-sync-cross-realm-mirror-coherence`); cannot share an in-worker
scheduler; (5) `FifoPackageAcquisitionAuthority`
(`package-acquisition-authority.ts`) — per-project install/edit COMMAND
admission, a logical authority whose separate ownership ADR-0261 already
establishes; it schedules commands, not persist ops. The lane scheduler stays INSIDE `OpfsFsSync` — the single
sync-mirror write-through owner, the one new mechanism the epic Budget
sanctions; no second OPFS write-through owner is created. Whether the stamp
full fence belongs to the trusted-state authority primitive instead of
promote() is that epic's Contract+RED question (ADR-0358 Context); this
item lands it in promote().

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
     without any lane knob. The per-op-flush denominator is CALIBRATED
     same-run against the one-final-flush FIFO shape (worker 'calibrate'
     phase, `PD256_CALIBRATE=1`): measured pre-implementation
     perOpFlushMs 41 423 vs oneFlushMs 41 141 → rawRatio 1.0069; the gate
     multiplies by the committed bound `SERIAL_OVERHEAD_BOUND = 1.05`
     (~7x headroom over measured inflation) so the synthetic denominator
     cannot manufacture a pass;
  2. **product drain** — the landed caller shape (slice-1 dedup: one mkdir
     per distinct dir) + ONE `flush()` — on main a serial FIFO drain, after
     this item the ~16-lane parallel drain.
- Gates: UNROUNDED `speedupRaw >= 2.5 * SERIAL_OVERHEAD_BOUND` (= 2.625; I3
  with the calibration bound; RED on main — measured raw 1.375); both
  `flush().total === 0`; WHOLE-TREE fresh-surface proof per variant: exact
  ENTRY equality (files AND dirs — 26 811 + 2 314; a stray empty dir or a
  missing dir fails) with the manifest walk plus BYTE-EXACT reads of ALL
  files vs in-memory source bytes (fault-classes exact-bytes — chunked
  ×64, compare-and-release, outside the timed window; same-length
  corruption anywhere fails); same-run FLUSH-OVERHEAD PROBES on the drained
  faithful instance, sweeping both baseline flush shapes: EMPTY (mean of
  2 000 awaited empty flushes) and SINGLE-PENDING delta (200 iterations
  of write+flush minus the batched per-op cost of 200 writes + one
  flush — the product's own shape); each extrapolated across the 2N
  flushes the baseline awaited must stay ≤10% of faithfulMs — bounds the
  SHIPPED flush() so neither an empty- nor a pending-only
  per-flush-overhead mutant can manufacture speedup (closes the
  only-old-drain reach of the one-time calibration); probes run on a
  scratch namespace outside the verified tree; wall-clock
  logged (`PD256-ACCEPTANCE` JSON) for the PR record, no absolute-time CI
  assert (variance).

Mid-drain kill e2e (tier obligation, epic Decisions "Preserved constraint"),
committed carrier `tests/browser-unit/opfs-parallel-drain-kill.spec.ts` +
worker — GREEN on main, must survive the parallel drain: real OPFS project,
real install-stamp authority wired as the PRODUCTION claimIo composition
(`createOwnerVfsAuthorityComposition(fsSync, {initialRoots: ['/','/.rifty']})`
→ authority as sync mirror + `createInstallStampAuthority({vfs, fsSync:
authority, claimIo: composition.installStampClaims})` + `flush: () =>
authority.flush()` — mirrors `workbench-owner-runtime.ts:244-294` /
`owner-package-state.ts:230-234`), demote → tree write → promote() with the
real flush seam; worker TERMINATED on a PATH-AWARE discriminated mid-drain ack
(the PENDING stamp's own write durably closed with `durability:"pending"`
content + package.json closed + `0 < treeCompleted < 600` tree-only
writes — aggregate counting was a FIFO-shaped assumption); fresh realm
proves the surviving stamp is EXACTLY the durable pending claim
(`preStampDurability === 'pending'`, absent no longer satisfies), NOT
trusted via the boot path's own check, and — BEFORE any mutation —
enumerates the torn tree through its own surface: `0 < tornComplete <
600`, every survivor either byte-exact COMPLETE or an EMPTY
created-not-swapped entry — the honest OPFS atomic-swap torn model
(writeFile materializes the handle before close() swaps bytes); any
partial/wrong-byte state is corruption and fails (dying-realm ack counts
are not evidence of what survived; all-600-settled fails loudly)
(`stamps.check(...)` + `installArtifactIdentity`, the
owner-package-state transition predicate), then a full re-run ends trusted
with a clean ledger and a FULL-TREE byte-exact proof (all 600 files:
count + paths + sizes + every byte vs the regenerated procedural spec — a
spot check could bless a partial tree). This carrier owns the stamp-trust
dimension slice-1's kill carrier explicitly excluded.

Unit replacement pins (opfs-sync.test.ts, committed; ADR-0358 "Replacement
pins"):

- RED R1 — ops on DIFFERENT paths complete out of call order under inverted
  latencies (parallel lanes); replaces the FIFO pin, whose deletion is part
  of the implementation commit (it inverts from GREEN to RED the moment
  lanes land — leaving it would make the suite self-contradictory);
- RED R2 — an op on an unrelated path behind a wedged head completes
  BEFORE the 30s timeout even fires (pre-timeout liberation — kills a
  release-on-timeout scheduler) and is never ledgered after it (per-lane
  watchdog; on main FIFO admission wedges it and `reportBlockedPending`
  ledgers it);
- RED R4 — admission ceiling: HELD persists on unrelated paths, MIXED
  kinds (writes + mkdirs + rm + a held RENAME — its three physical legs
  counted at their boundaries), in-flight counted at the persist boundary:
  `1 < peak <= 16`. On main serial peak === 1 (RED on the `> 1` half); the
  `<= 16` half makes unbounded fan-out unable to ever pass;
- RED R5 — R4×R2 composition: a never-settling wedge PLUS a sustained
  mixed-kind backlog held ACROSS the 30s watchdog transition (19 held ops,
  advance 30 000 ms — wedge ledgered — then more incl. a held RENAME's
  three legs), releases entry-order:
  `1 < peak <= 16` over the WHOLE run — a cap that frees the timed-out
  op's slot admits a 17th physical persist and fails the `<= 16` half; all
  30 non-wedge ops (32 physical boundaries) complete; final bounded ledger EXACTLY '/wedged';
- GREEN P1 — same-path ops complete in call order under inverted latencies;
- GREEN P2 — ancestor mkdir persist completes before its child write
  persist;
- GREEN P3 — structural fences BOTH SIDES: write → rm → recreate → write
  completion order; rename fenced before (source-subtree write precedes all
  rename legs) AND after (destination successor write follows every rename
  leg — no overtake, no straddle);
- GREEN P8 — timeout × routing-fence composition (four pins): a TIMED-OUT
  wedged op RETAINS its fences for dependents queued BEFORE the timeout
  fires (across-transition waiters) AND enqueued after — a child write
  behind a timed-out mkdir, an rm behind a timed-out subtree write, every
  rename leg behind a timed-out source write, and (structural-wedge
  sibling) recreates/writes behind a timed-out rm itself, all complete
  only after the wedge settles (kills the fence-cancelling-on-timeout
  approximation; wedge released as success → equal-sequence heal → clean
  ledger);
- GREEN P9 — capacity wait is not I/O time: a healthy op queued behind a
  full ~16-lane window for ~29 s completes with an EMPTY ledger (its own
  30 s I/O budget starts at admission, not enqueue — kills the
  timer-start-at-enqueue mutant; opfs-sync.ts:126-131 semantics);
- GREEN P10 — drain-scoped cache lifetime: two drains split by flush();
  drain 2's rm+recreate resolves the parent FRESH and its write carries
  the new bytes (kills a cache-outlives-its-drain incarnation-replacement
  mutant);
- GREEN fault-row carriers (schedule-agnostic end-state asserts, hold under
  serial today and overlapping lanes later): quota-rejected write with two
  concurrent surviving siblings + exact single-path ledger + later heal
  (row a); sequence-ordered ledger heal — fast child-write success clears a
  slow ancestor-mkdir rejection, fast later same-path success clears a slow
  earlier rejection (row b — kills the heal-then-record inversion a naive
  parallel drain would introduce); structural rm forces FRESH parent
  resolution and the recreated write carries the new bytes; structural
  RENAME poisons BOTH warmed sides in ONE drain (source and destination
  parents resolved in the same uninterrupted enqueue sequence, no
  mid-flush): moved bytes land at the new paths byte-exact, no write ever
  targets the dead source subtree, the destination chain re-resolves
  fresh, the recreated source resolves after the rename's rm (row e — a
  drain-scoped dir-handle cache can never serve a pre-rm or pre-rename
  handle on either side).

Stamp-fence pins (install-stamp-authority.fault.test.ts, committed, GREEN —
9 tests incl. the pre-existing hang pin, every family swept over BOTH
production writer branches): a trusted
stamp never becomes durable at the OPFS surface while an earlier-enqueued
persist op is unsettled — four families: (i) pre-proof wedge held past the
30s report bound; (ii) POST-PROOF window — an op enqueued after the
durability proof resolves but before publication still fences the stamp (a
fence frozen to the proof watermark fails); (iii) a SETTLED out-of-scope
rejection stays ledgered while promotion still trusts (kills the
global-ledger-cleanliness approximation of the fence); (iv) SATURATED
post-proof backlog — 17 held ops (> the ~16 cap, so ≥1 is cap-QUEUED, not
admitted), released one-by-one with zero trusted-stamp writes asserted
after every release until the last settles (kills an
admitted-lanes-only fence snapshot). Wirings: raw-fsSync
writer and the PRODUCTION claimIo composition (`createOwnerVfsAuthorityComposition` →
`installStampClaims.write` → `#writeInstallStampClaim` →
`authority.#fs.writeFileSync` → the same write-through queue; wiring
mirrors `workbench-owner-runtime.ts:244-294`). On main FIFO delivers the
fence, ADR-0358's explicit fence must preserve it (P4). Kill-power proven:
a transient no-FIFO-admission mutant (parallel lanes at
`opfs-sync.ts:774`) fails BOTH pins at the fence assertion; file restored
byte-exact.

Implementation obligations landing in the implementation commit (named here
so the carriers above stay honest): delete the FIFO pin (R1 replaces it);
per-lane watchdog + `reportBlockedPending` redesign; the dir-handle cache's
own internal stale-handle unit test extending row (e)'s pin once the cache
exists (the OBSERVABLE — fresh resolution after a structural op + correct
final bytes — is already pinned pre-implementation above).

## Parity cases

Drain-observable behavior narrows to ADR-0358's contract; everything else
must not move:

- P1-P4 above (same-path order, ancestor gating, both-side structural
  fences, stamp fence) + the row a/b/e GREEN carriers.
- P5 `flush()` report contract unchanged: never rejects, returns
  `{failures, total, anyFailure}`, `total === 0` ⇔ drained is durable;
  existing persist-failure ledger + watchdog suites in opfs-sync.test.ts
  bind except the two FIFO-shaped pins R1/R2 replace.
- P6 reload honesty unchanged: pending stamps never trusted (kill e2e
  above); existing restore e2e pins and `owner-snapshot-restore-exec`
  install-survives-reload stay green — current-tree artifact (2026-08-16,
  darwin arm64, Playwright 1.60.0): `npx playwright test -g
  "snapshot|archive"` -> `3 passed (43.8s)`, exit 0 (includes
  owner-snapshot-restore-exec "install cowsay + write -> reload").)
- P7 foreign-rm differential (cross-realm class, ON MAIN): row (f) carriers
  in `workspace-archive.fault.test.ts` stay green — the parallel drain must
  not be quieter than main on the same schedule
  (`vfs/opfs-sync-cross-realm-mirror-coherence` owns the class);
  current-tree artifact (2026-08-16, node v24.16.0, vitest 2.1.9):
  `npx vitest run packages/workbench/src/glue/workspace-archive.fault.test.ts`
  -> `4 passed (4)`, exit 0.

New RED targets (failing-test-first, all committed with this contract):
R1 cross-path parallel completion, R2 per-lane watchdog liberation,
R3 browser acceptance `speedupRaw >= 2.625`, R4 admission ceiling, R5
wedge×saturation ceiling across the watchdog transition. GREEN
preservation carriers committed alongside: P1-P4 (P4 = both stamp-fence
writer branches), the row a/b/e carriers, kill e2e (production claimIo
composition).

## Fault matrix

Storage boundary (OPFS) through `OpfsFsSync`; tier production (epic).
Canonical axes per fault-classes §Axes.

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | quota-perm-fail × one lane mid-drain | one path's persist rejected while sibling ops are in flight | ledger records EXACTLY the failed path (op 'write', message preserved); `flush().total === 1`, `anyFailure` covers it → stamp refused (guarded scope); both siblings complete; later same-path success heals → total 0 — carrier: committed GREEN pin (concurrent quota rejection), schedule-agnostic |
| b | quota-perm-fail × ledger heal ordering | ancestor mkdir slow-REJECTS while child write fast-succeeds; same-path slow-reject vs later fast success | heal is SEQUENCE-ordered, not completion-ordered: end ledger clean (`total 0`) in both — a naive parallel drain's heal-then-record inversion leaves a stale entry and fails the pin — carrier: committed GREEN pins (sequence-ordered heal ×2) |
| c | torn-state × mid-drain realm death with pending stamp | worker killed while promote()'s drain is in flight | fresh realm: the durable PENDING claim survived (`preStampDurability === 'pending'`) and is NOT trusted (boot-path check); full re-run → trusted, clean ledger, FULL-TREE byte-exact — carrier: kill e2e (committed, GREEN on main, tier obligation; path-aware ack — the pending claim + package.json durably closed before the kill, tree torn 0<n<600) |
| d | unbounded-read × wedged persist op | one op held past the 30s report bound; sustained backlog across the timeout | bounded `flush()` ledgers ONLY the wedged path; unrelated lanes complete un-ledgered (R2 RED pin); the trusted-stamp write stays un-durable while the wedge is in flight (P4 fence pins, both writer branches); admission fan-out is capped — `1 < peak <= 16` cold (R4) AND across the watchdog transition with the wedge still occupying its physical lane (R5) |
| e | poisoned-cache × drain-scoped dir handles | subtree removed+recreated while dir handles could be cached | FRESH parent resolution observed strictly after removeEntry; final surface write carries the post-recreate bytes — carrier: committed GREEN pin (fresh parent resolution); RENAME sibling: committed GREEN pin (both sides warmed and poisoned in ONE drain, no mid-flush — moved bytes at new paths, destination chain re-resolves fresh, no dead-source write, recreated source resolves after the rename's rm); the cache's internal stale-handle test extends both in the implementation commit |
| f | concurrent-same-key × foreign realm rm | foreign realm removes persisted subtree mid-drain | not quieter than main on the same schedule — carrier: existing row (f) differential pins in workspace-archive.fault.test.ts stay green (P7); class owned by the cross-realm intake item |
| g | lossy-aggregate × acceptance oracle | dropped/truncated non-tail op; ratio rounded up at the gate | WHOLE-TREE path equality + BYTE-EXACT reads of ALL 26 811 files (fault-classes exact-bytes); UNROUNDED `speedupRaw` at the gate — carrier: the hardened acceptance spec itself (kill e2e: all 600 files byte-exact) |
| h | frozen-assumption × serial denominator | per-op-flush baseline silently inflating the ratio | same-run calibration vs the one-final-flush shape, measured 1.0069, committed bound 1.05 multiplying the gate — artifact: `PD256-CALIBRATION` log line + spec constant provenance |

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

ready-verdict: 2026-08-16 — Contract+RED @ 07557646d (attempt 7; fresh isolated reviewer, all 8 axes pass, 0 blockers)

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
  without it, so a config surface would be removable machinery. The
  denominator is not trusted on argument: it is CALIBRATED same-run
  against the one-final-flush shape (measured inflation 0.69%; committed
  gate bound 1.05 — fault row h).
- Reversibility: mechanism change is IRREVERSIBLE and recorded (ADR-0358);
  no cross-package API change (`OpfsFsSync` construction surface
  unchanged — no knob), no new dependency.
- Budget: slice **parallel-drain** band 250-600 SOURCE insertions
  (`check:budget` — tests, docs/backlog/**, generated globs excluded; the
  committed manifest fixture and carriers are tier obligations, DoD binds
  acceptance to the same PR). New coordination mechanisms: the ONE
  epic-sanctioned lane scheduler inside OpfsFsSync.
- Contract+RED attempt 1 (2026-08-15, blockers ANSWERED by re-cut, count
  carries): admission ceiling now RED-pinned (R4; frozen-assumption kill);
  fault rows a/b/e now carried by committed pre-implementation pins (no
  deferral past Contract+RED); fault axes renamed to the canonical
  taxonomy (heal→quota-perm-fail, timeout-wedge→unbounded-read,
  stale-dircache→poisoned-cache); Class-kill inventory made repo-wide
  (semaphore + terminal write-queue found, reuse/consolidation rationale
  recorded in ADR-0358 + Context above); acceptance oracle hardened
  (unrounded ratio, whole-tree proof, calibrated denominator — rows g/h);
  kill e2e verify widened to the full 600-file tree; rename pin extended
  to both-side fencing.
- Contract+RED attempt 2 (2026-08-15, blockers ANSWERED by re-cut, count
  carries): stamp-fence carrier swept over BOTH production writer branches
  — the new claimIo-composition pin wires the exact production triple
  (`workbench-owner-runtime.ts:244-294`, `owner-package-state.ts:230-234`)
  and the kill e2e now drives that composition end-to-end; R5 composes R4
  with R2 (wedge retains its physical lane across the watchdog transition
  under sustained saturation); the Class-kill inventory names
  `FifoPackageAcquisitionAuthority` — per-project COMMAND admission whose
  separate logical authority ADR-0261 already establishes (no
  consolidation with an I/O drain scheduler).
- Contract+RED attempt 3 (2026-08-16, blockers ANSWERED by re-cut, count
  carries): acceptance oracle upgraded to BYTE-EXACT reads of ALL files
  per variant (sampling removed — fault-classes exact-bytes); rename
  sibling of the row-e cache pin committed (fresh resolution both sides,
  sweeping cached source/destination); P6/P7 regression pins now carry
  current-tree command+output artifacts (recorded in Parity cases).
- Contract+RED attempt 4 (2026-08-16, blockers ANSWERED by re-cut, count
  carries): a held RENAME (its three physical legs) joins both
  admission-cap RED mixes (R4/R5 — multi-path rename can no longer bypass
  the cap unpinned); the rename-cache pin re-cut to poison BOTH warmed
  sides in ONE drain with no mid-flush (an implementation omitting rename
  invalidation now fails it); the kill discriminator is PATH-AWARE (durable
  pending-claim content + package.json + torn tree count — the aggregate
  count was itself a FIFO-shaped frozen assumption) and phase 2 pins
  `preStampDurability === 'pending'` exactly; ADR-0261's whole-tree-rename
  removal-before-rename proof corrected in place to ride ADR-0358's
  structural subtree fences (dated note + README Corrections row) —
  active-ADR internal consistency restored.
- Contract+RED attempt 5 (2026-08-16, blockers ANSWERED by re-cut, count
  carries): stamp-fence family extended to the POST-PROOF window (late op
  enqueued via the flush seam after proof, before publication) and to the
  settled-foreign-failure-stays-ledgered-while-trusted differential — both
  swept over both writers (7 authority pins total); timeout × routing-fence
  composition pins added (P8 — ancestor/rm/rename fences survive a
  watchdog timeout); acceptance oracle: exact files+dirs entry equality
  (stray empty dir fails) + same-run empty-flush probe gating the SHIPPED
  flush() against per-flush-overhead mutants; kill e2e: fresh-realm torn
  proof before mutation (0<tornComplete<600; survivors classified by the
  OPFS atomic-swap torn model — byte-exact complete or empty
  created-not-swapped, discovered by this carrier's own first run: a
  zero-size survivor is a legitimate torn state, not corruption); R5
  counts corrected (30 ops / 32 boundaries).
- Contract+RED attempt 6 (2026-08-16, blockers ANSWERED by re-cut, count
  carries): R2 strengthened to PRE-timeout liberation; capacity-queue
  watchdog pin added (P9 — queue wait never ledgered, timer starts at
  admission); P8 extended to across-transition waiters + a timed-out
  STRUCTURAL rm wedge; drain-scoped cache lifetime pinned across two
  drains (P10); stamp fence extended to the SATURATED post-proof backlog
  (family iv, both writers — publication waits for cap-queued work);
  flush-overhead probe extended with the single-pending DELTA shape
  (pending-only overhead mutant closed).
- RED evidence (pre-implementation runs on this branch, 2026-08-15/16,
  darwin arm64, node v24.16.0, vitest 2.1.9, Playwright 1.60.0 Chromium):
  - `npx vitest run packages/vfs/src/opfs-sync.test.ts` → `4 failed | 82
    passed | 1 skipped (87)`: exactly R1, R2, R4, R5 FAIL as designed (R1:
    `expected [ '/slow', '/fast' ] to deeply equal [ '/fast', '/slow' ]`;
    R2: `expected [] to deeply equal [ '/other' ]` — '/other' never
    reaches the surface behind the wedged FIFO head; R4 and R5:
    `expected 1 to be greater than 1` — serial peak is 1), all GREEN pins
    + every pre-existing suite (incl. the still-present FIFO pin) PASS.
  - `npx vitest run packages/workbench/src/glue/install-stamp-authority.fault.test.ts`
    → `9 passed` — all four fence families over both writers (pre-proof
    wedge, post-proof window, settled-foreign-stays-ledgered, saturated
    post-proof backlog);
    kill-power proven against a transient no-FIFO-admission
    mutant (both fence pins fail on it), file restored byte-exact.
  - `PD256_CALIBRATE=1 RIFTY_PLAYGROUND_PORT=5299 npx playwright test
    --config playwright.browser-unit.config.ts -g "calibration"` →
    `PD256-CALIBRATION: {"files":26811,"perOpFlushMs":41423,
    "oneFlushMs":41141,"rawRatio":1.0068518139990048}` (1 passed).
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts
    tests/browser-unit/opfs-parallel-drain.spec.ts
    tests/browser-unit/opfs-parallel-drain-kill.spec.ts` → `1 failed, 1
    passed (1.6m)`: acceptance FAILS ONLY the I3 gate — `Expected: >=
    2.625, Received: 1.4103325750072615`, faithfulMs 39 564 / productMs
    28 053, both ledgers 0, empty-flush probe 0.00019 ms (margin ~400x),
    single-pending delta probe 0.5817 vs batched 0.5893 ms/op (delta
    clamps to 0 — shipped flush overhead nil), BOTH whole-tree FULL-ENTRY
    (26 811 files + 2 314 dirs) FULL-BYTE proofs verified (mismatch
    null) — the failure is the ratio, nothing
    else; kill e2e PASSES through the production claimIo composition
    (path-aware mid-drain kill — durable pending claim + torn tree; fresh
    realm reads `durability:"pending"` exactly, refuses trust, and proves
    the torn tree pre-mutation (run 7: 2 complete + 0 empty of 600; an
    earlier run observed 1+1e — both legitimate under the atomic-swap
    torn model); retry ends trusted + clean ledger + full-tree 600/600
    byte-exact).
