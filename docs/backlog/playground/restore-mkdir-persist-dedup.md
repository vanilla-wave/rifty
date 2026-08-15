---
area: playground
status: ready
title: Restore apply loop mkdirs once per directory, not before every file write
created: 2026-08-15
why: workspace-archive apply calls mkdirSync(dirname) before EVERY writeFileSync and OpfsFsSync persists each call → ~2 FIFO ops/file on a big-tree restore; measured 1.3-1.8x of the whole durability drain
user_story: As a developer opening a project from a baked dep snapshot, I want the durability flush to not re-persist thousands of already-persisted directories, but today a 26.8k-file tree drains ~2 ops per file and the flush alone takes 40+ seconds
epic: project-open-drain-latency
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/vfs/0072-opfs-sync-content-cache-write-through.md, docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [packages/workbench/src/glue/workspace-archive.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

Lineage (fault-classes §Contract escalation — 2nd consecutive Contract+RED
blocker → re-refine in place): successor of `vfs/opfs-mkdir-persist-dedup` on
this branch; attempt 1 @ tree 16edebbde, attempt 2 @ tree 141246d81; this
contract enters at attempt 3. The predecessor's carrier — a persist SKIP
inside `OpfsFsSync.mkdirSync` — required either a permanent proven-chain skip
(cross-realm mkdir-recreate regression, speculative guard) or per-path
pending-op coalescing (a new coordination mechanism: epic Budget pins
mechanisms at 0 for this slice, and decision-workflow rule 4 makes it
ADR-bound). Both arms were review-blocked; the carrier is re-cut to the
CALLER, which needs neither.

The redundancy source is the caller, not the VFS: `apply()`
(workspace-archive.ts:230) calls `mkdirSync(dirname(target), {recursive})`
before EVERY `writeFileSync`, and `OpfsFsSync.mkdirSync` persists each call
unconditionally (opfs-sync.ts:950 — semantics this item does NOT touch).
Dedup at the caller, SAME PASS: the write loop keeps its exact shape and
order; a first-seen `Set` of dirnames merely skips the duplicate `mkdirSync`
calls ("no ordering change", epic slice clause — surviving mkdirs and every
write keep their positions and interleaving; a mid-apply failure leaves the
identical durable prefix main leaves). Persist ops per restore: 1 rm + 1
root mkdir + one mkdir per distinct dirname (≤ D + 1 incl. a root-dirname
file) + N writes = N + D + O(1) (epic I2), never ~2N.

Prototype evidence carries by op count, not literal call shape: the measured
`fssync-mkdir-dedup` variant precreated dirs in a separate phase, while this
carrier interleaves — but both issue exactly one mkdir persist per distinct
dir plus N writes, and the drain cost is the serial FIFO op count (branch
`proto/opfs-flush-speed-256` @ a01870a5f,
`tests/browser-unit/proto-opfs-flush-speed.spec.ts`, real gravity-ui tree
26 811 files / 166.8 MB / 2 314 dirs, Playwright 1.60.0 Chromium): faithful
48.9/42.1 s vs dedup 26.7/31.0 s headed (1.4–1.8x), headless 37.6 → 28.5 s
(1.3x). Run command in `proto-opfs-flush-speed-RESULTS.md` on that branch.

Because the VFS layer is untouched, every persist/heal/ledger/FIFO semantic
is preserved wholesale: heal-on-retry (I2) holds because a restore RE-RUN
mkdirs every distinct dirname again and `OpfsFsSync` re-persists
unconditionally; the ADR-0187 FIFO pin, watchdog, and ledger suites bind
unchanged.

## Acceptance

Browser-unit spec (default lane, real Chromium worker + real OPFS):
restoring a deterministic node_modules-shaped archive (N=3000 files, D≈700
dirs) through the REAL `applyWorkspaceArchive` over `OpfsFsSync` + real
`OpfsVfs`, instrumented only by counting wrappers at the real OPFS boundary
(delegating root-handle wrapper counting `getDirectoryHandle`; subclassed
`OpfsVfs.writeFile` counter — real I/O underneath):

- mkdir persist ops ≤ D + 2 and < N (RED on main: ≈ N + 1, one per file);
- file write-through ops = N; `flush().total === 0`;
- tail file re-read byte-equal through a FRESH `OpfsVfs` (durability proven);
- wall-clock apply+flush logged for the PR record (no CI assert — variance).

Unit (Node, the apply loop's own boundary is the `WorkspaceArchiveFs`
interface): `prepareWorkspaceArchiveImport(...).apply()` over a logging fs
is asserted against the COMPLETE desired call trace (RED on main):

- full-trace pin — the exact mkdir/write sequence: root mkdir, then per file
  in archive order a first-seen dirname mkdir (in place, no batching, no
  root special-case) followed by that file's write — one mkdir per distinct
  dirname total (main: one per file);
- failure-prefix pin — a mid-apply `writeFileSync` throw rethrows the
  ORIGINAL error object (identity, not a wrapped copy) and the call log
  equals the desired trace truncated exactly at the failing write — no
  look-ahead, no post-failure effects (observable-order).

Integration (Node, REAL `applyWorkspaceArchive` + REAL `OpfsFsSync` over an
injectable root — fake only at the OPFS boundary, unavoidable outside a
browser): quota-failing restore leaves a dirty `flush()` report (honest);
re-running the SAME restore after the fault clears re-persists every dirname
and heals → `flush().total === 0`, dirs present on the fake disk (I2
heal-on-retry preserved through the dedup).

Existing suites green and untouched: `workspace-archive.test.ts` (export/
import/validation semantics), the ADR-0187 FIFO pin, watchdog and
persist-failure ledger suites in `opfs-sync.test.ts` (zero vfs source
changes). Approximations rejected: deduping only consecutive repeats fails
the unit op-count on interleaved dirs; batching all mkdirs ahead of the
writes fails the interleaving pin; touching `OpfsFsSync.mkdirSync` violates
this contract's Out of scope.

## Parity cases

Restore-observable behavior must not change; the epic supplies the user
scenario. Regression pins (stay green):

- P1 final mirror tree and bytes identical to main for the same archive
  (existing import/export round-trip tests, which now run through the
  deduped apply; plus the browser fresh-surface re-read).
- P5 mid-apply failure leaves main's exact durable prefix and surfaces the
  same error (failure-prefix pin above).
- P2 archive validation errors and their order unchanged — decode, unsafe
  path, stamp-claim, collision guards all fire BEFORE any mutation (existing
  tests).
- P3 write-through FIFO completion order pin (ADR-0187, opfs-sync.test.ts)
  binds unchanged — no vfs source change.
- P4 `flush()` report contract unchanged: `total === 0` ⇔ drained is durable.

New RED targets (failing-test-first): R1 unit full-trace, prepared-reapply
trace, and failure-prefix pins (exact deduped call sequence; main issues one
mkdir per file), R2 browser acceptance op-count + durability bounds above,
R3 fault row (f) same-dir differential (main's silent self-repair must
become a dirty ledger). GREEN honest-outcome pins committed alongside:
fault rows (a), (b), (g), and row (f) adversarial (main-identical end
state). All four rows run through the REAL sibling `OpfsVfs` over one fake
FileSystem handle tree — the only mocked boundary; in-package doubles of
the paired-surface port remain legitimate inside `packages/vfs`'s own suite
(the port is that unit's own seam), cross-package tests use the real
sibling.

## Fault matrix

Storage boundary (OPFS) reached through the untouched `OpfsFsSync`; the apply
loop is the driver. Tier production (epic). `corrupt-input` at the archive
trust boundary is unchanged (P2 pins it). `concurrent-same-key` cross-realm:
pre-existing mirror-wide class on main, no new writer or guard here — captured
in `vfs/opfs-sync-cross-realm-mirror-coherence` (this PR's intake).

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | quota-perm-fail × restore mkdir persist | dir creates rejected mid-restore | `flush().total > 0`, `anyFailure` covers the subtree → install stamp refused; sync mirror stays live — GREEN pin (vfs semantics untouched) |
| b | quota-perm-fail × restore retry | same restore re-run after the fault clears | every distinct dirname is mkdir'd again → unconditional re-persist heals → `flush().total === 0`, dirs durable (I2 heal-on-retry) — GREEN pin |
| c | torn-state × mid-restore realm death | worker TERMINATED while its restore drain is in flight (real Chromium kill, in-flight OPFS I/O dies with the realm) | EXECUTABLE carrier in this PR (browser-unit `restore-mkdir-dedup.spec.ts` "KILLED mid-drain"): a fresh realm over the torn OPFS re-runs the SAME restore → clean flush ledger + EVERY archive byte readable through a fresh `OpfsVfs` — no lying tree survives a mid-drain death, retry restores byte-complete. Stamp-trust dimension is NOT exercised: this unit touches no stamp writer (`check:install-stamp-writers`); pending-stamp boot semantics stay owned by ADR-0187, `playground/reload-crash-consistency-fault-e2e` ("kill mid snapshot-restore" full-app row), and slice 2's mid-drain-kill tier obligation. Existing post-completion reload e2e stay green as regression pins |
| d | lossy-aggregate × op counting (test-only boundary) | counting wrapper vs real ops | acceptance counts at the REAL root handle/`OpfsVfs` boundary, never a projection of internal state — the browser test is the artifact |
| g | poisoned-cache × prepared-apply lifecycle | ONE `prepareWorkspaceArchiveImport` result applied, quota-struck, applied AGAIN after the fault clears | the second `apply()` re-runs the FULL mkdir set (dedup state is per-apply-invocation, never prepare-scoped) → heals, byte-complete; unit trace pin: the same prepared import re-applied emits the complete deduped trace twice |
| f | concurrent-same-key × foreign rm mid-drain | another realm removes a restored subtree (dirs AND file bytes — file-complete disk model) between drain ops | DIFFERENTIAL honest outcome — ground truth: a clean `flush()` cannot attest bytes a foreign realm deleted after their successful persist, ON MAIN TOO (main's redundant mkdir recreates only the PARENT; the removed file is never re-written — clean flush, file absent). The unit owns: the dedup is never QUIETER than main on the same schedule — same-dir schedule: the following same-dir write fails → DIRTY ledger, stamp refused (louder than main's silent self-repair; RED carrier); adversarial interleaving (later distinct-dirname chain recreates the parent): end state byte-identical to main (clean, foreign-removed file absent — the shared main-level hole, class-captured); restore retry recovers BYTE-COMPLETE in both (oracle checks every archive byte on the fake disk). Cross-realm coherence has no owner at this seam — `vfs/opfs-sync-cross-realm-mirror-coherence`; import/apply/dep-snapshot share the ONE `prepareWorkspaceArchiveImport().apply()` chokepoint |

## Out of scope

- ANY change to `OpfsFsSync` persist semantics — no skip, no coalescing, no
  ledger-condition change; `mkdirSync` keeps persisting unconditionally
  (predecessor carrier rejected at escalation; op dedup lives at the caller).
- Redundant mkdir persists from OTHER callers (editor `loadFixture` saves,
  workbench authority guarded mkdirs) — not the #256 restore regime; the
  mirror-existence-guard heal gap those sites share is captured as intake
  draft `vfs/mirror-existence-guards-cannot-heal-ledgered-dirs`.
- Cross-realm mirror coherence — intake draft
  `vfs/opfs-sync-cross-realm-mirror-coherence`.
- FIFO/ordering change, lane parallelism, watchdog redesign — slice 2
  (`vfs/opfs-parallel-write-through-drain`); the ADR-0187 FIFO pin stays RED
  on parallelize.
- Drain progress events — slice 3
  (`playground/project-open-durability-progress`).
- Pack-format storage — rejected for the epic (epic `## Decisions`).

## Decisions

- Carrier re-cut (fault-classes §Contract escalation, RESOLVED): after two
  consecutive Contract+RED blockers on the vfs-skip carrier (attempt 1 @
  16edebbde: in-flight duplicate healer lost, ancestor-scan speculative,
  concurrent-same-key mis-excluded; attempt 2 @ 141246d81: coalescing = new
  coordination mechanism vs epic Budget 0 + ADR trigger, K-healer fidelity,
  cross-realm recreate regression), the unit is re-refined to caller-side
  dedup. The reviewer-named non-removable core — bounding the restore loop —
  is delivered with ZERO vfs changes, so every objection's subject
  (skip/coalesce/index/re-arm) no longer exists.
- Reversibility (checklist walked, RESOLVED): no cross-package API change
  (apply() signature and observable results unchanged), no new dependency, no
  ADR contradiction (0187/0072 untouched), no new mechanism (a local Set of
  dirnames in one loop is data flow, not coordination) → REVERSIBLE →
  CHANGELOG in packages/workbench.
- Same-pass carrier (attempt 3 re-cut, RESOLVED): the reviewer-named minimal
  core — a first-seen Set inside the EXISTING write loop, skipping only
  duplicate mkdir calls. The earlier two-phase sketch (collect dirs, then
  write) was removable machinery AND drifted from the slice clause "no
  ordering change"; the interleaving + failure-prefix pins now reject it.
- Budget: slice **mkdir-dedup** band 20–80; source insertion ≈ 8 lines in
  workspace-archive.ts; new coordination mechanisms: 0 — genuinely
  satisfied. The RED-carrier volume objection (attempt 3) is answered by the
  gate's own definition — `check:budget` band counts SOURCE insertions,
  "tests, docs/backlog/**, generated globs excluded" (backlog/README
  §Budget) — and the carriers are tier obligations, not scope: browser
  acceptance is the DoD observable proof (fakes cannot close acceptance)
  and its worker fixture is harness, the fault file covers matrix rows
  (a)/(b), and the redundant reference-parity test was removed.
- Fault-carrier fidelity (attempts 6–7, RESOLVED): the paired surface in the
  fault rows is the REAL sibling `OpfsVfs` with its root injected as ONE
  fake FileSystem handle tree (the `vfs-async-contract.test.ts` pattern) —
  the handle tree is the only mocked boundary (unavoidable in Node), no
  sibling rifty package is mocked, and dirs + bytes share one authority so
  recursive removals are coherent. In-package `PairedAsyncSurface` doubles
  inside `packages/vfs`'s own suite remain legitimate: the port is that
  unit's own seam.
- RED-batch volume (attempts 3 & 8 objection, ANSWERED with named clauses):
  the 20–80 band is defined by `check:budget` over SOURCE insertions —
  "tests, docs/backlog/**, generated globs excluded" (backlog/README
  §Budget) — and the §Budget tripwires bind autonomous source PRs
  ("Each autonomous source PR selects one epic Budget row. Tripwires: …");
  no Goal-Baseline is declared here and attempt 7 passed the Budget axis on
  exactly these facts. The batch is dominated by (i) review-mandated
  preservation pins from this unit's own checkpoint lineage — per AGENTS.md
  §PR "Everything the unit discovers commits into its branch … A finding
  never opens a second PR" — and (ii) the browser acceptance harness, which
  the DoD binds to the SAME PR as the shipped capability ("shipped
  capability carries observable acceptance proof (e2e/parity) in the same
  PR"). Splitting either out detaches required work from the delivery a
  named rule pins it to; the source diff itself is ≈8 lines, comfortably
  inside the band.
- Epic-level review findings (attempts 1–2) against signed invariants
  I1/I3, the single-digit scenario wording, and owner-port-only progress
  reach remain ROUTED TO THE USER (invariants-signoff: 2026-08-15 — user;
  reach/channel forks user-resolved via rifty-refine in epic `## Decisions`);
  `goal_baseline` is absent because the ordinary-PR path is the default
  pending the user's explicit autonomous-run hand-off.
- RED evidence: unit + browser acceptance tests are COMMITTED with this
  contract (executable RED carriers). Pre-implementation runs on this branch
  (2026-08-15, darwin arm64, node v24.16.0):
  - `npx vitest run packages/workbench/src/glue/workspace-archive.test.ts
    packages/workbench/src/glue/workspace-archive.fault.test.ts` (vitest
    2.1.9) → 4 failed / 23 passed; the R1 full-trace, prepared-reapply
    trace, and failure-prefix pins fail on main's one-mkdir-per-file trace,
    and row (f)'s same-dir differential fails on main's silent self-repair
    (`total` 0 where the dedup must report dirty); rows (a)/(b)/(g), row (f)
    adversarial (main-identical end state), and all pre-existing archive
    suites GREEN. The fault carrier pairs the REAL `OpfsVfs` with
    `OpfsFsSync` over ONE fake FileSystem handle tree (the
    `vfs-async-contract.test.ts` injection pattern) — no sibling package is
    mocked; recursive removals clear dirs and bytes coherently.
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts -g "restore enqueues"` (Playwright
    1.60.0 Chromium, real OPFS, real applyWorkspaceArchive) → R2 fails:
    `mkdirPersistOps` Received 3001 vs bound `dirCount + 2` = 703 (N=3000,
    D=701) — exactly the ~one-persist-per-file regime issue #256 reports.
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts -g "KILLED mid-drain"` → 1 passed
    (6.6 s): row (c) carrier GREEN on the pre-implementation tree — the
    mid-drain realm-death recovery it pins is main behavior the dedup must
    preserve.
