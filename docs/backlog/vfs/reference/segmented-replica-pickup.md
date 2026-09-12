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
