---
area: playground
status: ready
title: Durability-drain progress surface on the workbench owner port
created: 2026-08-15
why: the flush phase is 96% of heavy-tree project open and emits nothing observable — hosts cannot distinguish slow from stuck (issue #256's core complaint)
user_story: As a host UI embedding the workbench, I want an honest signal during the durability flush (still working / N of M persisted), but today WorkbenchOwnerHealthEvent carries only fatal-invariant and persistence, so a long flush looks identical to a hang
epic: project-open-drain-latency
blocked_by: []
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/playground/0359-durability-drain-progress-as-a-health-event-kind-on-the-workbench-owner-port.md, docs/adr/vfs/0358-bounded-per-path-parallel-opfs-write-through-drain-with-ancestor-fencing-and-stamp-barrier.md]
code: [packages/workbench/src/workbench/workbench-owner-port.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/glue/owner-vfs-ipc.ts, packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs-drain-scheduler.ts]
---

## Context

**ADR-0359** (this branch) records the user-resolved forks: shape = real
counts `{persisted, total}` + terminal `persisted === total`, arrival doubles
as heartbeat; surface = new `kind: 'durability-progress'` member of the
EXISTING `WorkbenchOwnerHealthEvent` union (compile-time break accepted as
loud migration); reach = owner-port only (`npm install` terminal output stays
byte-parity-clean). Honesty rule (Fidelity): only REAL completed-op counts
from the drain owner — never synthetic/timed/eased progress. This item
implements ADR-0359; its terms are not re-decided here.

Plumbing (charted 2026-08-16, file:line hops verified): the durability
channel worker→page already exists — `owner-vfs-ipc.ts` durability
request/ack frames ride `workbench:project-vfs` (controller :295 ↔
browser-owner :520-525), and `onDurabilityState` →
`publishHealth({kind:'persistence',…})` at `workbench-browser-owner.ts:774-785`.
The #256 drain call is `glue/install-stamp-authority.ts:716-726` `proofReport =
await flush()` threaded from `workers/workbench-owner-runtime.ts:294`
(`flush: () => authority.flush()`) via `owner-package-state.ts:328/653` and
`package-acquisition-authority.ts:1522`. Minimal seam set (no new
coordination mechanism, epic Budget 0):

1. vfs: `OpfsFsSync.flush(options?: { onProgress })` — events-out observer on
   the existing settle path (`opfs-drain-scheduler.ts` per-op settle);
2. authority passthrough (`workers/owner-vfs-authority.ts:217`);
3. worker forwarding: coalesced `rifty:owner-vfs-durability-progress` frames
   over the active project's vfs emit (late-bound emit hook — packageState
   composes before the controller/project exists; the playground npm-install
   restore drains with the transport live);
4. protocol frame (`project-vfs-protocol.ts` inspect + `owner-vfs-ipc.ts`);
5. page: `onDurabilityProgress` transport option (sibling of
   `onDurabilityState`) → `publishHealth({kind:'durability-progress',…})` +
   the union member (`workbench-owner-port.ts:33`).

Honest `total` (carrier decision): fixed at `flush()` invocation =
|scheduler.pending| — exactly the existing reporting-barrier watermark
universe (late arrivals excluded, matching the pinned watermark semantics at
opfs-sync.test.ts:1109). `persisted` counts watermark ops settled
SUCCESSFULLY since the call — failure-settled/watchdog-released ops never
advance it, so an unclean drain never reaches `persisted === total` even
though `flush()` resolves its bounded dirty report (wedge = arrival/advance
stops + dirty report). Zero new bookkeeping — the drain owner already owns
`pending` and per-op settle. In the promote restore scenario the op stream
is enqueued synchronously before `flush()`, so `total` = files + dirs + 1.

## Acceptance

All carriers COMMITTED with this contract, designed RED on main (no observer,
no frame, no union member — every RED fails on its runtime assert, compiles
on main via structural casts):

- vfs unit pins (opfs-sync.test.ts, describe 'OpfsFsSync flush progress
  observer (ADR-0359)'):
  - R1 observer: flush with `onProgress` over N deferred writes → real
    monotone non-decreasing snapshots ending `persisted === total === N`
    (RED: no callback fires on main);
  - R2 honesty: ops released one at a time → EVERY snapshot's `persisted`
    equals the surface-settled count at emission (kills synthetic/eased
    progress);
  - R3 wedge: one op held past the 30 s report bound (fake timers) →
    snapshots STOP advancing, NO terminal `persisted === total`, while the
    bounded flush report carries the wedge; EXTENDED past report
    resolution — the wedge released as success AFTER the dirty report must
    not advance `persisted` nor mint a terminal (watchdog-released ops
    never advance);
  - R4 failure-settle: one op REJECTS among N-1 successes → dirty report,
    `persisted` excludes the failed op (final N-1 of N), NO snapshot ever
    reaches `persisted === total` (kills advance-on-any-settle — the
    scheduler's `settled` resolves on success AND failure).
- workbench owner pin (workbench-browser-owner.test.ts): a
  `rifty:owner-vfs-durability-progress` frame over the real open handshake
  (fake owner worker, existing harness) → health listener receives
  `{kind:'durability-progress', persisted, total}` in frame order (RED:
  frame is not handled on main).
- Browser acceptance (tests/browser-unit/durability-progress.spec.ts +
  fixture, DESIGNED RED, `PD256-PROGRESS` JSON logged for the PR record):
  REAL OPFS, REAL 12 000-file restore stream (first 12k files of the
  committed real-tree manifest; 1 091 dirs → expectedOps 13 092; slice-1
  caller shape + ONE flush) through `OpfsFsSync.flush({onProgress})`:
  ≥1 MID-DRAIN snapshot (not only terminal), monotone non-decreasing,
  totals stable, terminal `persisted === total === expectedOps`, clean
  ledger. Pre-implementation run (2026-08-16, Playwright 1.60.0):
  `snapshotCount: 0` → RED on `> 0`; flushMs 6 370 on the landed parallel
  drain.
  - Driver depth (carrier decision, recorded honestly): this spec drives
    the WORKER-REALM drain-owner seam, not the page-side owner stream —
    the browser-unit lane's sealed-workbench definitions carry inline
    starter files only; no lane driver exists for a heavy dep-snapshot
    restore through the full page workbench. I1's "workbench owner health
    stream" is carried by the composition of this at-scale carrier (real
    counts at the drain owner) + the workbench owner pin (frame → health
    event, the page hop) — each hop pinned against its real neighbor.
- Implementation obligations (named): the seam set 1-5 above; coalescing at
  the worker forwarder (frames O(progress), not O(ops) — ADR-0359
  Consequences); existing suites green (union-member compile break is
  absorbed repo-internally — every in-repo exhaustive switch over health
  kinds gets the new case in the same commit).

## Parity cases

- P1 `npm install` terminal output byte-parity-clean — no new lines during
  the drain (existing `shell/byte-exact-command-output` suites bind
  unchanged; reach = owner-port only).
- P2 existing health kinds unchanged: `fatal-invariant` and `persistence`
  events keep their shapes and triggers (existing browser-owner suites).
- P3 `flush()` report/ledger contract unchanged (ADR-0358 suites bind; the
  observer is events-out only — R1-R3 assert no behavioral change to the
  drain itself).
- P4 restore/drain wall-clock unaffected within noise (observer emission is
  O(settles); the acceptance logs flushMs for the record, no CI assert).

New RED targets: R1-R3 (vfs), the owner frame pin, the browser acceptance.
GREEN preservation: P1-P4 via existing suites (no new carriers needed — no
behavior they pin changes).

## Fault matrix

Reporting-only surface over the storage boundary; tier production (epic).

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | frozen-assumption × progress source | synthetic/timed/eased counts | impossible by carrier: R2 pins every snapshot's `persisted` to the REAL surface-settled count at emission |
| b | unbounded-read × wedged op mid-drain | op held past the 30 s bound | counts stop advancing, NO terminal event; flush's bounded dirty report unchanged — stall distinguishable from progress AND from completion; post-report late success never advances (R3 extended) |
| c | observable-order × event stream | out-of-order/regressing counts | monotone non-decreasing pinned (R1, acceptance); frame order preserved page-side (owner pin) |
| d | quota-perm-fail × failing drain | ops settle as failures | failure-settles never advance `persisted` → no false terminal; ledger report stays the truth (R4 + R3 extended + P3) |
| e | corrupt-input × protocol frame | malformed progress frame | frame inspection at the existing protocol boundary rejects it like any other malformed vfs frame (existing protocol suites own the boundary; the new frame joins `inspectOwnerProjectVfsFrame`) |

## Out of scope

- Host UI rendering (playground app) — the epic scenario's "host UI shows
  progress" reach beyond the owner port was reviewer-flagged and ROUTED to
  the user (epic invariants-signoff 2026-08-15 binds I1 as owner-port
  stream).
- Terminal-line progress for `npm install` (P1 forbids; real npm parity).
- Progress for non-drain phases (acquisition already has ADR-0134 hooks).
- Cross-realm drains (page-realm terminal-persistence writes — the
  cross-realm intake owns that class).

## Decisions

ready-verdict: 2026-08-16 — Contract+RED @ 7792d70b4 (attempt 2; fresh isolated reviewer, all 8 axes pass, 0 blockers)

- Compiled to ready 2026-08-16: ADR-0359 records all three user-resolved
  forks (rifty-refine 2026-08-15, epic Decisions); remaining carrier
  decisions (honest `total` watermark definition; acceptance driver depth)
  recorded in Context/Acceptance above with rationale — both are
  agent-owned altitude (refine altitude: the user owns observable scope,
  the agent owns carriers).
- Reversibility: new public union member on the owner port = IRREVERSIBLE →
  ADR-0359 (recorded before this compile); vfs `flush(options)` widening is
  an internal cross-package seam extension recorded there too; no new
  dependency; no new coordination mechanism (epic Budget row holds at 0 —
  the forwarder coalesces on the existing channel).
- Budget: slice **drain-progress** band 80-250 source insertions
  (`check:budget` — tests excluded).
- Contract+RED attempt 1 (2026-08-16, blocker ANSWERED by re-cut, count
  carries): false-terminal progress killed — R4 (failure-settle never
  advances `persisted`, no terminal on an unclean drain) + R3 extended past
  report resolution (watchdog-released late success never advances);
  rows b/d re-carried accordingly; Context paths made package-exact.
  Final+GREEN obligations recorded from reviewer concerns: worker-forwarder
  emission proof + transport-live evidence for the npm-install restore
  scenario; coalescing inspection; row-e inspect case in the owning
  protocol suite.
- RED evidence (pre-implementation, this branch, 2026-08-16, darwin arm64,
  node v24.16.0, vitest 2.1.9, Playwright 1.60.0 Chromium):
  - `npx vitest run packages/vfs/src/opfs-sync.test.ts` → `4 failed | 87
    passed | 1 skipped (92)` — exactly R1/R2/R3(extended)/R4, each on its
    designed assert (`expected 0 to be greater than 0` — no observer
    callback on main; R3's bounded-report half and R4's dirty-report half
    already hold).
  - `npx vitest run packages/workbench/src/workbench/workbench-browser-owner.test.ts`
    → `1 failed | 17 passed (18)` — the owner frame pin: `expected [] to
    deeply equal [{kind:'durability-progress',persisted:3,total:10},
    {kind:'durability-progress',persisted:10,total:10}]`.
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts
    tests/browser-unit/durability-progress.spec.ts` → `1 failed`:
    `PD256-PROGRESS {"files":12000,"dirCount":1091,"expectedOps":13092,
    "snapshotCount":0,…,"reportTotal":0,"flushMs":6370}` — RED only on
    `snapshotCount > 0`; the restore itself is clean (ledger 0) on the
    landed parallel drain.
