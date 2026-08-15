---
area: vfs
status: ready
title: Skip redundant mkdir persist ops for already-existing paths in OpfsFsSync
created: 2026-08-15
why: mkdirSync enqueues a persist op even when every segment already exists; restore paths mkdir before every write → ~2 FIFO ops/file, measured 1.3-1.8x of the whole durability drain
user_story: As a developer opening a project from a baked dep snapshot, I want the durability flush to not re-persist thousands of already-persisted directories, but today a 26.8k-file tree drains ~2 ops per file and the flush alone takes 40+ seconds
epic: project-open-drain-latency
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md, docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [packages/vfs/src/opfs-sync.ts, packages/workbench/src/glue/workspace-archive.ts]
---

## Context

`OpfsFsSync.mkdirSync` (opfs-sync.ts:950) calls `persistMkdirAsync`
unconditionally — the existence loop only `continue`s over known segments, then
persists anyway. Restore/apply loops (workspace-archive.ts:230 and siblings)
call `mkdirSync(dirname(target), {recursive:true})` before EVERY
`writeFileSync`, so a big-tree drain carries one redundant mkdir persist per
file.

Measured (prototype branch `proto/opfs-flush-speed-256`, commit a01870a5f,
`tests/browser-unit/proto-opfs-flush-speed.spec.ts`, real npm-installed
gravity-ui tree 26 811 files / 166.8 MB / 2 314 dirs, Chromium via
Playwright 1.60.0, headed, `fssync-FAITHFUL` vs `fssync-mkdir-dedup`
variants): faithful 48.9/42.1 s vs dedup 26.7/31.0 s → 1.4-1.8x; headless
37.6 s vs 28.5 s → 1.3x. Serial-only fix, no FIFO/ordering change.

Correctness constraint (why "path exists in mirror" alone is NOT enough to
skip): existing-in-mirror does not imply persisted-in-OPFS. A prior mkdir
persist may have FAILED (quota/perm) leaving a ledger entry; today a later
mkdirSync of the same path re-persists and heals it. A skip must preserve
heal-on-retry: skip only when the full path pre-existed AND no persist-failure
ledger entry covers any of its segments (or an equivalent condition proven at
Contract+RED). `healAncestorPersistFailures` (write success proves ancestors)
interacts here — a child write already heals ancestor mkdir failures, which may
make the ledger check cheap or even redundant; settle at contract time.

Fault rows to pin (fault-classes: `quota-perm-fail`, `torn-state` at the
Storage boundary): (a) mkdir persist fails → later mkdirSync of same path
still heals (no skip on ledgered path); (b) skip of a truly-persisted dir
leaves flush report clean and stamp promotion unaffected; (c) mixed: parent
ledgered, child new → child write-through still heals ancestors.

Epic: `project-open-drain-latency` (slice **mkdir-dedup**, lands first).
REVERSIBLE mechanism-local change, but persistence-touching → Review
convergence Contract+RED applies.

## Acceptance

Browser-unit spec (default lane, real Chromium worker + real OPFS), restore of
a deterministic synthetic tree (N≈3000 files, D≈500 dirs, node_modules-shaped)
through the REAL `applyWorkspaceArchive` loop
(`packages/workbench/src/glue/workspace-archive.ts`) against `OpfsFsSync` over
real `OpfsVfs`, instrumented ONLY by counting wrappers at the real OPFS
boundary (subclassed `OpfsVfs.writeFile` counter + delegating root handle
counting `getDirectoryHandle`; real I/O underneath — no fakes):

- mkdir persist ops ≤ D + 2 and < N (RED on main: ≈ N + 1, one per file);
- file write-through ops = N;
- `flush().total === 0` and tail file re-read byte-equal through a FRESH
  `OpfsVfs` (durability proven, not claimed);
- wall-clock apply+flush logged for the PR record (no CI assert — variance).

Unit: restore-shaped loop (mkdirSync(dirname) before every write) over a fake
root enqueues exactly ONE mkdir persist op per distinct file dirname (≤ D;
intermediate ancestors ride their leaf chain's op) + N writes (deterministic
op-count pin).

Fault rows (a)–(e) below GREEN; existing `opfs-sync.test.ts` suites (mkdir
error parity, FIFO completion-order pin, persist-failure ledger) untouched and
green. Approximations rejected: a skip keyed on mirror existence alone FAILS
rows (a)/(c)/(d); dropping the persist for chains with new segments FAILS the
durability re-read; a skip without duplicate coalescing FAILS row (d)'s
preservation pin.

## Parity cases

Sync-visible `mkdirSync` semantics are Node-parity-pinned already and MUST NOT
change (regression pins, stay green):

- P1 non-recursive on existing dir → `EEXIST`; missing parent → `ENOENT`;
  file on chain → `ENOTDIR`/`EEXIST` (existing `opfs-sync.test.ts` dir-mirror
  suite).
- P2 recursive on existing chain → no throw, idempotent.
- P3 write-through FIFO completion order under inverted latencies (ADR-0187
  pin) — the dedup removes ops, never reorders survivors.
- P4 `flush()` report contract: `total === 0` ⇔ everything drained is durable
  (ledger suite).

New RED targets (failing-test-first): R1 zero-op skip (fault row b), R2
op-count bounds (unit + browser acceptance above), R3 in-flight duplicate
coalesced — no follow-up op after the pending persist SUCCEEDS (row d —
RED via op-count; the failure-path healing outcome is GREEN on main), R4
loadFixture retry heals a ledgered fixture dir (row e — RED on main, real
existing defect: the mirror-existence guard makes the dir unhealable via
loadFixture for the whole session).
GREEN preservation pins (pass on main, must survive the skip): rows (a), (c),
and row (d)'s failure-path outcome — main heals them via the unconditional
re-persist; the dedup must keep healing them via the ledger check and
coalescing.

## Fault matrix

Storage boundary (OPFS), tier production. Reachable axes for this change:
`quota-perm-fail`, `torn-state`, `observable-order`. Excluded here:
network/cache axes (no such boundary in mkdirSync).
`concurrent-same-key` (cross-realm writers on one OPFS — a REAL fault surface
per the Storage boundary row, NOT physically excluded): pre-existing
repo-wide class of the sync mirror itself, not created by this change — a
foreign realm's rm already makes A's reads/stat/exists silently stale on main
(content cache + warm index), with or without the mkdir re-persist. Product
serializes workbench owners via the Web Lock
(`packages/workbench/src/workbench/open-workbench.ts`), and the OpfsFsSync
header disclaims cross-instance coherence ("Worker owns its filesystem view
for life"). A mkdir-only guard here would be a partial third mechanism on an
invariant with no owner (fault-classes §Class-kill) — the class is captured
as its own draft `vfs/opfs-sync-cross-realm-mirror-coherence` (this PR's
intake) with the reviewer's sweep sites; see Out of scope.

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | quota-perm-fail × mkdir persist | mkdir persist of P fails (create rejected), later mkdirSync(P, recursive) retried after fault clears | retry is NOT skipped (P ledgered) → re-persist heals; `flush().total` returns to 0 — GREEN pin |
| b | torn-state × skip decision | none — fully-persisted, ledger-clean, no-pending chain re-mkdir'd | ZERO new persist ops enqueued; `flush().total === 0`; stamp-gate view (`anyFailure`) unchanged — RED |
| c | quota-perm-fail × ledger check | mkdir persists of A and of A/B BOTH failed (both ledgered, both in mirror); fault clears; mkdirSync(A/B, recursive) retried | retry NOT skipped (target ledgered) → ONE recursive re-persist heals A/B (direct) and A (ancestor heal); `flush().total` → 0 — GREEN pin |
| d | observable-order × in-flight window | first persist of P HELD in flight; second mkdirSync(P, recursive) admitted; fault cleared; first persist then FAILS | duplicate is COALESCED (≤1 extra disk attempt — RED via attempt count), its one-shot follow-up re-persists after the failure → clean `flush()`, P durable on a fresh re-read (healer preserved — GREEN outcome pin, matches main) |
| e | quota-perm-fail × loadFixture sibling | fixture dir's earlier mkdir persist FAILED (ledgered, dir absent on disk so child writes fail too); fault clears; loadFixture over the same tree retried | retry produces a clean `flush()` and fresh on-disk bytes — RED on main: loadFixture's `!index.has(dir)` guard skips the mkdir CALL on retry, and `OpfsVfs.writeFile` creates no parents, so the dir is never re-persisted and the ledger stays dirty for the whole session. Fix = REMOVE the guard: every fixture dir flows through the mkdirSync chokepoint, whose ledger path re-persists (Class-kill consolidation — zero sibling mirror-existence skips remain) |

## Out of scope

- Async `OpfsVfs.mkdir` dedup — separate surface, not on the drain hot path
  measured; loud gap: none (behavior unchanged there).
- Any FIFO/ordering change, lane parallelism, watchdog redesign — slice 2
  (`vfs/opfs-parallel-write-through-drain`); the ADR-0187 FIFO pin stays RED
  on parallelize.
- Drain progress events — slice 3 (`playground/project-open-durability-progress`).
- Pack-format storage — rejected for the epic (epic `## Decisions`).
- rm/rename persist paths — untouched.
- Cross-realm mirror coherence (`concurrent-same-key` over one OPFS from two
  Workers/tabs) — pre-existing class of the whole sync-mirror surface
  (reads/stat/exists already serve stale state on main), owned at product
  level by the workbench Web Lock; no user-action repro path exists through
  the product (the lock serializes owners — §Reachability attempt recorded).
  Captured as draft `vfs/opfs-sync-cross-realm-mirror-coherence` with the
  sweep sites (runtime-js host/worker-entry OPFS installs, sync-mirror,
  OpfsVfs, open-workbench Web Lock); this item neither adds a writer nor a
  partial guard.

## Decisions

- Skip condition (fork from Context, RESOLVED): on a mkdirSync that created
  NO mirror segment — (1) target path ledgered → enqueue the persist
  (heal-on-retry carrier, rows a/c); (2) an UNSETTLED mkdir persist for the
  same normalized path exists → coalesce: mark that op's one-shot
  duplicate-intent; if it settles in FAILURE, exactly one follow-up persist
  re-arms (row d — preserves main's duplicate-healer semantics); (3)
  otherwise (chain proven: in mirror, not ledgered, no pending same-path op)
  → skip. Any call that created a segment persists as today.
- Target-only ledger lookup (RESOLVED; supersedes the draft's "any of its
  segments" sketch): ancestor-only-dirty with a clean target is UNREACHABLE
  under the serial FIFO — every persist success under a path heals its
  ancestors (write/mkdir/rename heal paths, rm clears under) — and where an
  ancestor-covering op fails, the ledger entry sits at that op's own target,
  whose own retry is not skipped; the gate's `anyFailure` keeps the subtree
  dirty meanwhile. An ancestor scan adds no reachable behavior → dropped
  (§Simplicity). Slice 2 (out-of-order completion) must re-derive this
  equivalence in its Contract+RED — its item already carries the
  ledger-heal-under-reorder obligation.
- `healAncestorPersistFailures` alone is NOT a substitute for the ledger
  check — a general-API caller that mkdirs an existing ledgered path with no
  subsequent child write (empty dir) would leave the entry unhealable
  forever, `flush().total` stuck > 0, install stamp permanently refused.
- Coalescing over duplicate enqueue (RESOLVED): without coalescing the dedup
  cannot exist — during a tight restore loop NO op settles between calls, so
  "enqueue while pending" degenerates back to ~2N ops; and dropping
  duplicates outright loses the in-flight healer main provides (epic I2
  "heal-on-retry preserved"). Coalescing delivers both: ≤1 disk attempt per
  settled outcome, healing equivalent to main (one follow-up vs K duplicates).
- Class-kill inventory (mechanism check): the duplicate-intent index is a
  per-path VIEW over the existing FIFO owner's pending mkdir ops plus a
  one-shot re-arm consumed inside the op's own failure path — no new
  ordering/authority; OpfsFsSync stays the single OPFS write-through owner.
  Existing same-boundary mechanisms: pendingTail FIFO, pending-by-sequence
  map, persist-failure ledger (all one owner, this class). Sibling
  mirror-existence pre-mkdir guard: `loadFixture` (opfs-sync.ts) — REMOVED by
  this item (fault row e): the guard is an unsound pre-dedup optimization
  (child writes create no parents, so a ledgered fixture dir could never heal
  through loadFixture), and post-dedup an unconditional mkdirSync is an O(1)
  no-op on the proven path. After this item, the mkdirSync skip is the ONE
  mirror-existence decision point; zero siblings remain.
- Epic-level review findings (Contract+RED attempt 1, 2026-08-15) against
  signed invariants I1/I3, the single-digit scenario wording, and the
  owner-port-only progress reach are ROUTED TO THE USER, not absorbed here:
  `invariants-signoff: 2026-08-15 — user` freezes them for agents
  (AGENTS.md §Data sources; backlog/README §Epic fit "Only the user changes
  an invariant"), and the progress reach/channel were user-chosen fork
  resolutions (epic `## Decisions`, rifty-refine 2026-08-15).
- Evidence: prototype `proto/opfs-flush-speed-256` @ a01870a5f, real 26 811-file
  gravity-ui tree — faithful 48.9/42.1 s vs mkdir-dedup 26.7/31.0 s headed
  (1.4–1.8x), headless 37.6 → 28.5 s (1.3x); run command in RESULTS.md on that
  branch.
