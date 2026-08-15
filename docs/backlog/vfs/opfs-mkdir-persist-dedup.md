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

Fault rows (a)–(d) below GREEN; existing `opfs-sync.test.ts` suites (mkdir
error parity, FIFO completion-order pin, persist-failure ledger) untouched and
green. Approximations rejected: a skip keyed on mirror existence alone FAILS
rows (a)/(c); dropping the persist for chains with new segments FAILS the
durability re-read.

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
chain-ledger no-skip (rows a/c), R3 op-count bounds (unit + browser
acceptance above).

## Fault matrix

Storage boundary (OPFS), tier production. Reachable axes for this change:
`quota-perm-fail`, `torn-state`. Excluded here: network/cache axes (no such
boundary in mkdirSync), `concurrent-same-key` (single Worker owner — the FIFO
serializes persists; parallel drain is slice 2).

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | quota-perm-fail × mkdir persist | mkdir persist of P fails (create rejected), later mkdirSync(P, recursive) retried after fault clears | retry is NOT skipped (ledger entry on chain) → re-persist heals; `flush().total` returns to 0 |
| b | torn-state × skip decision | none — fully-persisted, ledger-clean chain re-mkdir'd | ZERO new persist ops enqueued; `flush().total === 0`; stamp-gate view (`anyFailure`) unchanged |
| c | quota-perm-fail × chain check | mkdir persists of A and of A/B BOTH failed (both ledgered, both in mirror); fault clears; mkdirSync(A/B, recursive) retried | retry NOT skipped (chain ledgered) → ONE recursive re-persist heals A/B (direct) and A (ancestor heal); `flush().total` → 0 |
| d | torn-state × in-flight window | second mkdirSync(P) while P's first persist is in flight; the in-flight op then FAILS | skip is taken (ledger empty at decision time); `flush()` still reports the failure (honest); NEXT mkdirSync(P) or child write heals |

Row (c) sibling: a persisted child WRITE healing ledgered ancestors is already
pinned in the main suite (`healAncestorPersistFailures`) and must stay green
with the skip in place.

## Out of scope

- Async `OpfsVfs.mkdir` dedup — separate surface, not on the drain hot path
  measured; loud gap: none (behavior unchanged there).
- Any FIFO/ordering change, lane parallelism, watchdog redesign — slice 2
  (`vfs/opfs-parallel-write-through-drain`); the ADR-0187 FIFO pin stays RED
  on parallelize.
- Drain progress events — slice 3 (`playground/project-open-durability-progress`).
- Pack-format storage — rejected for the epic (epic `## Decisions`).
- rm/rename persist paths — untouched.

## Decisions

- Skip condition (fork from Context, RESOLVED): skip the persist enqueue iff
  (1) the mkdirSync call created NO mirror segment, AND (2) the
  persist-failure ledger has no entry for ANY segment of the normalized path
  (target + all ancestors). O(1) fast path: ledger empty → condition (2) free.
  `healAncestorPersistFailures` alone is NOT sufficient — a general-API caller
  that mkdirs an existing ledgered path with no subsequent child write (empty
  dir) would leave the entry unhealable forever, `flush().total` stuck > 0,
  install stamp permanently refused. Ledger check is required; it is cheap
  (non-empty ledger only after real failures).
- Ancestor coverage of the chain check (RESOLVED): ancestor-only-dirty with a
  proven-durable target is UNREACHABLE under the serial FIFO — every persist
  success under a path heals its ancestors (write/mkdir/rename heal paths,
  rm clears under) — so today a target-only check is observably equivalent.
  The chain check is kept because it is what the signed draft prescribed
  ("no ledger entry covers any of its segments"), it makes the skip locally
  sound instead of dependent on that cross-path invariant, and slice 2's
  out-of-order completion is exactly where the invariant becomes fragile
  (its review lens flags ledger-heal-under-reorder as the failure mode). Not
  new machinery: 6-line guard over existing state, O(1) on the empty ledger.
- In-flight window semantics (row d, ACCEPTED): the skip decision reads
  mirror + ledger synchronously; a failure of an already-in-flight op for the
  same path lands AFTER the skip. Honesty is preserved by `flush()` reporting
  the ledger; healing defers to the next explicit retry or descendant write —
  the same triggers that heal today. The only lost healer is a redundant
  queued duplicate racing its predecessor's failure; it was never a contract.
- No new coordination mechanism (epic Budget: 0): the skip is a guard over
  the existing mirror + ledger; Class-kill inventory unaffected.
- Evidence: prototype `proto/opfs-flush-speed-256` @ a01870a5f, real 26 811-file
  gravity-ui tree — faithful 48.9/42.1 s vs mkdir-dedup 26.7/31.0 s headed
  (1.4–1.8x), headless 37.6 → 28.5 s (1.3x); run command in RESULTS.md on that
  branch.
