# Segmented replica pickup — 2026-09-12

Authority: accepted fast-project-open-reopen goal I1/I2/I3/I5, Outcome (a–f).
Independent DEC-2 reviewer: `/root/replica_decision`; read-only against
`e1de2db6694fc34c949a6f3310070ab82b66d025`. Selected existing OpfsFsSync +
batched physical sink; rejected a new MemoryBackend-based sync owner. Exact
supersessions and alternatives: ADR-0425. No user fork reopened.

## Current native baseline

HEAD source: `93c05f463cc266eb47f36b4fd8cf528c9ad1d0b3` (storage unchanged
from main `acf594da9`). Chromium 148.0.7778.96, Node 24.16.0, macOS,
headless persistent profile; browser process closed and relaunched before every
sample. Offline set before Worker receives the reopen request. Host bootstrap
already loaded; no registry/snapshot/data fetch. OS page cache not evicted.
T paths/sizes from committed tracker-tree-manifest.json; payload bytes generated
at exact lengths. Every reopened byte checked, outside the restore timer.

| sample | durable flush tail, ms | eager fresh-process restore, ms |
|---|---:|---:|
| 1 | 9909.470 | 4499.240 |
| 2 | 10371.450 | 4464.665 |
| 3 | 10319.595 | 4422.050 |
| median | 10319.595 | 4464.665 |

Synchronous materialization: 66.485–69.985 ms. Root-empty init: 0.315–0.390 ms.
This measures the storage boundary, not end-to-end openProject latency. It
replaces no historical goal evidence: pre-ADR-0393 8.4 s stays labelled history.
Production acceptance must also cross the real opening/command boundary.

## Native commit probe

Real Worker/native handles; exclusive guard is separate from HEAD. Second
acquire: NoModificationAllowedError. Write `old`, close; write `new` without
close: native read is `old`. Terminate writer, reacquire guard: read remains
`old`. Write `new`, close: read is `new`. No simulated filesystem.

## Decision traps

- Per-file scheduler admission before batching caps the batch at 16 operations,
  and same-directory dependencies can make it one. Capture/register first.
- Workbench origin lease does not cover direct/configured no-COI SDK boot;
  native guard must reject contention before replay, under preferred too.
- Reporting timeout is not native settle. Releasing a guard early permits a
  previous HEAD close to overwrite a new owner's publication.
- Owner proof and installer equality already require fresh native reads.
  Reading the live content cache would manufacture durability.
- Capture the live front at one watermark for compaction; later mutations
  cannot leak into the base ahead of their persist operation.
- Native quota during compaction keeps prior HEAD; a failed cleanup after
  successful HEAD publication cannot authorize deletion of reachable segments.

A+B re-cut removes only temporary machinery. I1/I2/I5 and Outcome (c) are
unchanged; legacy health remains linked until its final slice. Broader existing
fault-honest-opfs-persistence drafts remain unlanded: replica carriers must prove
required faults on the new substrate; their old native-file injections are not
accepted by filename alone.

## Contract+RED execution

Production storage unchanged. Final full native/browser RED at `78aef7eac`:
`RIFTY_PLAYGROUND_PORT=5399 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/replica-persistence.spec.ts tests/browser-unit/replica-storage-budget.spec.ts`.
13 failed / 2 passed, 1.7 min. Semantic failures: current native format admits
corrupt bytes without diagnosis; utimes disappear; quota reports one path instead
of the failed batch's 230; closing a timed-out writer does not exclude a second
owner; after-close kill exposes new-a with old-b; no compacted HEAD exists.
Native read failure and before-close append preserve the existing good baseline.

Formal budget RED uses distinct 4-byte file prefixes, and includes namespace
acquisition in restore timing. Medians: first flush 10,451.515 ms; fresh offline
restore 5,027.200 ms; restore after 5,000 changes 5,021.365 ms. Every byte checked.
These are storage-boundary proofs, not a completed public opening/npm scenario.

`pnpm exec vitest run packages/workbench/src/workers/workbench-project-store-layout.contract.test.ts`:
1 failed, 4 ms — valid old definition adopted instead of absent in v2.

`RIFTY_NO_COI_PORT=5491 RIFTY_NO_COI_ORACLE_PORT=5492 RIFTY_NO_COI_RESOURCE_PORT=5493 pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/replica-storage.spec.ts`:
1 failed — real unisolated configured runtime reports per-file storage;
OpfsFsSync and persisted bytes otherwise work. No import/harness failure.

Strict standalone TypeScript check of all four browser fixture/spec files passes.
The native stream decorator injects only allowed storage faults and never
substitutes a rifty filesystem. The late-close case also explicitly closes the
old instance and attempts reacquisition after real settle; its targeted RED still
fails because baseline permits the competing writer before settle.

Advisories accepted before implementation: the roundtrip now drains before
metadata-only utimes; real required/preferred owner composition is exercised;
contention and acquired-read failure pass through the preferred owner selector.
Targeted native repeat: 4 RED / 1 baseline GREEN (5.4 s). No storage code changed.

## First GREEN

Native suite: 16 passed (7.2 s), including true required/preferred owner, native
read failure, independent metadata-only utimes, corruption, quota and kill.
Per-file OpfsFsSync + v2 layout tests: 96 passed / 1 existing skip. VFS and
Workbench typechecks pass; file-size ratchet holds.

T median first flush **340.575 ms**, fresh offline restore **215.865 ms**,
restore after 5,000 changes **278.990 ms** (three fresh processes each).
The same committed manifest and unique content pattern as RED; every byte
checked. Native budget suite: 1 passed (14.8 s).

PR-4: existing Workbench unit fixture addresses move v1→v2 with the active
store; their behavioral assertions remain. The dedicated old-v1 isolation
contract and native legacy fixture retain v1. The old Store tests' two REDs
were the expected namespace mismatch and corrupt-metadata seeding in old v1.

Replica native prewarm/external per-file refresh controls are retired as named
NotImplementedError (VFS README); ordinary FsSync is unchanged. No production
call-site uses those controls. Final image capture uses the existing scheduler
watermark and live front; no queued second byte mirror is introduced.

## IMPLEMENT gate evidence — 2026-09-12

- Native replica suite: 16/16; per-file OPFS + v2 Store unit: 96 pass / 1 existing skip;
  Workbench: 159 files / 3,099 tests pass. Configured no-COI native roundtrip passes.
- Three fresh Chromium processes, T manifest, all bytes checked after replay:
  flush 323.145/340.575/359.975 ms; restore 216.855/215.865/215.650 ms;
  post-5,000-mutation restore 278.990/286.450/249.460 ms.
  Medians 340.575 / 215.865 / 278.990 ms, all ≤2 s. Native storage proof only;
  public real-install composition remains in the map.
- PR-4 compiler pin: full gate + isolated `check:esbuild-legacy-retirement`
  rejected `typescript-worker.js` after the replica changed imported chunk hashes.
  Rebuilt BASE 93c05f4 sources with identical esbuild options: exact old
  10,022,694-byte SHA bd7eb420…eb936 reproduced. Diff is solely seven static
  chunk import references and one dynamic module-loader reference; after normalizing
  those emitted names, files are byte-identical. New exact SHA
  bda2365a4f089e9e897869e3d3acef6cc1c6504c6bb6a0e8d98c5e2e09687b59;
  byte ceiling, finite inventory and all raw/gzip/base64 rejection checks retained.
- PR-4 first-open progress: original native per-file walk returned -1 under replica
  despite successful v2 open. Replace physical-path enumeration with fresh-Worker
  validated replay after terminating the owner. File-count and pre-reply progress
  assertions remain; no cache from the writing owner can satisfy durability.
- Supplemental paired Vfs probe initially used Node stream's inclusive end by mistake.
  Vfs `openReadable` is `[start,end)` (existing MemoryVfs range contract).
  Request corrected from end=2 to end=3; expected bytes [255,128] retained.
  No production stream change. Other own-result, dirty-ledger, metadata and
  timeout assertions passed in that first run.
- PR-4 existing browser carriers: namespace proof faults now select native segment
  records; preload refusal targets committed HEAD; first-open proof uses a fresh
  reader Worker. Same namespace isolation, original bytes, error and recovery checks.
- Orphan Scratch seeds and all custody/kill/quota/read/metadata-kind rows now use
  the replica. Native observers decode actual HEAD/segments independently of VFS
  caches. Deletion cuts match a covering tombstone (empty-parent cleanup coalesces
  the removed source). All 18 orphan rows pass, including public retain/export/reopen.
- Historical per-file catalog adoption expectation is superseded by ADR-0425's
  accepted no-adoption decision: public test now checks empty catalog and exact
  retained historical bytes for selected and decoy workspaces. Low-level migration
  receipt cases keep their real per-file backend, now at the active v2 project path.
- Interrupted real npm install: after the HEAD containing lodash LICENSE, the
  complete package is executable (observed exit 0); per-file's forced partial-package
  expectation is inapplicable. Test both exact boundaries: before HEAD → missing
  package; after HEAD → full working package. Both preserve local source, no arrival
  on saved open, and explicit install/build still work. Both pass.
- E2E definition mismatch edits committed metadata only after old-owner teardown
  and before new-owner admission. Compensation passes. Real cowsay install/exec/
  reload with complete native scope hashes also passes; no page-cache oracle.

## Busy-Worker guard defect — RED, 2026-09-12

- CI and isolated `no-coi-agent-sdk --grep agentStopScenario` reproduce terminated
  instead of replaced. Runtime's new peer rejects OpfsPreloadError: native guard
  still occupied. Minimal `replica-persistence --grep 'busy Worker termination'`
  reproduces before any repair.
- Native standalone probe: terminate of a busy Worker does not immediately stop
  its JS or release locks. SyncAccessHandle reacquires after ~2,005 ms; independent
  DEC-2 probe matches ~2 s for sync handle, Web Lock and exclusive writable.
  A live competitor stays refused; another namespace opens immediately. Counter
  observations rule out stealing custody merely because terminate() was called.
- Axis: concurrent-same-key / observable-order at Worker death → OPFS admission.
  Existing one guard remains the physical settlement authority. No duplicate/reorder
  transport model, no epoch/steal/second owner; bounded admission waits for real release.
  Independent decision: /root/busy_guard_decision; repair/evidence follows.
- DEC-2 conclusion retains native SyncAccessHandle; ADR-0428 records a separate
  acquisition deadline using captured ioReportTimeoutMs, retrying only real
  NoModificationAllowedError. Late grant closes, no publication/fallback.
- A second RED holds a genuinely acquired native handle past the deadline;
  requires preferred refusal, eventual close and clean reacquisition. It fails
  before the repair. Existing busy-stop assertion stays unchanged.
- GREEN: all 19 native replica/paired/deadline cases, plus unchanged public
  `agentStopScenario`. Busy replacement now reacquires after native release;
  held-I/O competitor remains refused for the full 30 s admission budget.
- Revert-check: deleting only late-grant `handle.close()` makes the deadline
  carrier fail again; exact production file restored. No acquisition failure
  enters the mutation ledger; scheduler behavior unchanged.
- After admission repair, fresh T medians: flush 337.515 ms, replay 223.470 ms,
  post-mutation replay 283.610 ms (3 samples); deadline carrier GREEN after revert-check.
- PR-4 final compiler import pin: same 10,022,694 bytes and unchanged body after
  normalizing static/dynamic emitted import names; final SHA
  5b431255962e888846352f393c05ef017612c0a24422c043ac5d2f1bfcb2846d.
- Packed consumer exposed its own obsolete per-file orphan seed. Its native fault seed now uses
  the installed public VFS to write/flush v2 state before a Workbench owner exists;
  guarded SDK writes correctly refused the intentionally invalid private claim.
  Exact retention/export/reopen assertions remain. No internal source import.
- Full browser lane: 175 pass / 1 existing skip. `pnpm pr:check`: 25/25 pass.
- Packed consumer GREEN: 15 first-party + 83 real external tarballs, public
  producer and SDK, real Vite/HMR/sqlite, snapshot-only/scoped preview, no-COI
  update/reopen/native interruption+quota, and exact orphan retention/export.
  Private fault bytes are seeded before owner admission through installed VFS;
  application SDK protection remains enforced.

## Final review repairs — 2026-09-13

Independent report retained verbatim in `segmented-opfs-replica-final-review-1.json`.
All three findings accepted; no criteria waiver.

- B1 confirmed in both per-file and replica modes: rm, rm followed by another
  failed mkdir, and rename each falsely clear `/a` uncertainty. Native
  `opfs-structural-repair.spec.ts`: 6 RED; 2 existing late-rm cases GREEN.
  Explicit whole-subtree repair must then persist the exact live tree.
- B2: `replica-native-read.spec.ts`: continuous read/stat/readdir during 140
  writes plus four native held-I/O cuts RED. Per-file reference and both
  backend-control cases GREEN (5 fail / 3 pass). No fake VFS/reader.
- B3: all three named replica NotImplementedError controls now have committed
  behavioral carriers; default per-file behavior and untouched bytes also checked.
- ADR-0429 records the class sweep, causal scope in the one failure ledger,
  and reader retirement inside the existing replica publisher/guard.
- B1/B2 GREEN: 16 native cases. Failure scope remains in the existing ledger;
  entry-only proofs cannot erase subtree uncertainty, while late full-scope
  success discharges its own sequence. Native readers settle before old-segment
  GC; new readers use the new committed map.
- Additional class-sweep RED: corruption detected by a paired read during an
  unrelated in-flight append loses its force-base request when that append
  completes; subsequent repair flushes clean but fresh replay cold-restores.
  `replica-persistence` now captures this exact native overlap. A successful
  append cannot discharge a repair that requires a base.
