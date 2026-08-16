---
area: playground
status: ready
title: First-open materialization drain delivers durability-progress on the owner health stream
created: 2026-08-16
why: the FIRST open of a project — the epic's central 40s-scenario — is still mute; slice 3's emit slot binds only at project-runtime creation, AFTER the first-materialization promote proof-flush completes, so every frame drops (I1's plain reading is unmet; Final+GREEN #264 reviewer finding, code-verified)
user_story: As a host embedding the workbench, I want honest N-of-M progress on the owner health stream during the FIRST open of a heavy project (the snapshot/first-materialization drain), but today the durability-progress forwarder routes through a per-project emit slot that is null until the project runtime exists — first-open frames are silently dropped
epic: project-open-drain-latency
blocked_by: []
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/playground/0359-durability-drain-progress-as-a-health-event-kind-on-the-workbench-owner-port.md]
code: [packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/workbench/owner-protocol.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/glue/owner-vfs-ipc.ts, packages/workbench/src/workbench/project-vfs-protocol.ts, packages/workbench/src/workbench/project-content-transport.ts]
---

## Context

The gap (code-verified 2026-08-16): first-open flow
`playground-project-authority.ts` `openProject` → `acquisition.ensure` →
first-materialization → snapshot/install ensure → promote proof-flush
(`install-stamp-authority.ts:716` `proofReport = await flush()`) runs BEFORE
`createProject` binds the slice-3 emit slot
(`workbench-owner-runtime.ts:336` declared, `:581` bound, `:616-618`
cleared); null slot → the forwarder drops every frame. The non-playground
materializer path (`project-materialization.ts:184`) has the same shape.

Resolution (carrier altitude, resolved from code; ADR-0359 in-place
correction 2026-08-16): the per-project vfs frame hop is REPLACED by an
owner-LEVEL control message — durability is owner-scoped (`authority.flush`
drains the whole owner), and page-side `healthListeners` are owner-level
(`workbench-browser-owner.ts:282`, alive before any open). One channel for
ALL drains; the late-bound slot mechanism is deleted, not extended
(§Simplicity: the slot exists only because the old channel was
project-scoped). Not user-observable: same events, same
`WorkbenchOwnerHealthEvent` stream, internal hop only.

Seam set (no new coordination mechanism, epic Budget row stays 0):

1. `workbench/owner-protocol.ts`: new `WorkbenchOwnerToPageMessage` member
   `{ type: 'workbench:durability-progress'; persisted: number; total:
   number }` + inspect case (both directions ride the existing
   `inspectWorkbenchOwnerToPageMessage` boundary).
2. `workers/workbench-owner-runtime.ts`: the ADR-0359 forwarder
   (`createDurabilityProgressForwarder`, coalescing unchanged) sends via
   `sendOwnerMessage(ipc, …)` directly; the `emitDurabilityProgress` slot,
   its bind, and its clear are deleted.
3. `workbench/workbench-browser-owner.ts`: `acceptMessage` case
   `'workbench:durability-progress'` → `publishHealth({ kind:
   'durability-progress', persisted, total })` — owner-level, no project
   token gate (progress can precede `workbench:project-opened`).
4. Removals (dead after the migration): `rifty:owner-vfs-durability-progress`
   frame (`glue/owner-vfs-ipc.ts:95,326`), its `project-vfs-protocol.ts`
   inspect case, the `onDurabilityProgress` transport option
   (`project-content-transport.ts`) and its wiring
   (`workbench-browser-owner.ts:782-785`). Existing suites pinning the old
   hop are updated in the same commit (channel superseded by this contract +
   the ADR correction — legitimate suite update, not carrier edit).

The vfs observer seam (`OpfsFsSync.flush({ onProgress })`) and all slice-3
vfs pins (R1-R4: monotone, honesty, wedge, failure-settle) are untouched —
counts semantics live at the drain owner and do not change.

## Acceptance

All carriers COMMITTED with this contract, designed RED on main (compile on
main via structural casts; every RED fails on its runtime assert):

- Page hop, I1 altitude (workbench-browser-owner.test.ts, existing
  FakeOwnerWorker harness): owner-level `workbench:durability-progress`
  messages sent after `workbench:owner-ready` with NO project open →
  `subscribeHealth` listener receives `{kind:'durability-progress',
  persisted, total}` in message order; no `fatal-invariant`; owner not
  killed. RED on main: the unknown message type trips the protocol
  inspector into fatal-invariant and no progress event is delivered.
  (Before-open-reply ordering is pinned by the first-open acceptance below,
  at the real composition.)
- Protocol boundary (owner-protocol.test.ts):
  `inspectWorkbenchOwnerToPageMessage({type:'workbench:durability-progress',
  persisted: 3, total: 10})` returns the frozen message (RED on main:
  unknown type throws); malformed counts (non-finite / negative /
  non-number) are rejected like any malformed owner message.
- First-open closure proof (tests/browser-unit/first-open-progress.spec.ts +
  fixtures/first-open-progress-worker.ts, `FIRSTOPEN256` JSON logged for
  the PR record): the REAL `runWorkbenchOwner` composition in a browser
  worker realm (fake `KernelIpc` recording every owner→page message in
  order; REAL OPFS via `storage.persistence: 'preferred'`; minimal
  process-shim replacing the kernel pre-entry), driven over the real owner
  protocol: `workbench:initialize` → `workbench:open-project` with a
  2 002-file / 201-dir inline starter tree + empty-deps `package.json` (no
  network); the first-open materialization → ensure → promote proof-flush
  drains through real OPFS before the reply. Asserts (in order): reply is
  `workbench:project-opened`; post-reply REAL OPFS walk finds
  `persistedProjectFiles >= fileCount`; **designed RED** `progressCount >
  0` (owner-level `workbench:durability-progress` messages — 0 on main,
  drain mute: total owner→page traffic during the whole 2 002-file first
  open is exactly 2 messages); then post-fix I1 pins: every progress seq <
  reply seq; per-flush-segment (`total` fixed per drain watermark)
  monotone non-decreasing `persisted`; ≥1 mid-drain snapshot; final drain
  terminates `persisted === total`. Watermark SIZE is deliberately not
  asserted (write-through settles ops eagerly; universe durability is the
  OPFS walk's pin).
  - Driver depth (carrier decision, recorded honestly): this drives the
    full worker-realm owner composition — the exact production
    `runWorkbenchOwner` wiring (packageState flush → forwarder → ipc) — at
    the real protocol seam; the page hop is carried by the
    browser-owner pin above (each hop pinned against its real neighbor,
    slice-3-accepted composition pattern). The playground first-open
    (`playground-project-authority` `openProject`) rides the SAME
    packageState flush closure by construction (single forwarder bound at
    composition, no per-path slot remains).
- Implementation obligations (named): seam set 1-4 above; coalescing
  unchanged (frames O(progress) — ADR-0359 Consequences); slice-3 owner
  frame pin + transport/protocol suites updated to the owner-level channel
  in the same commit; every in-repo exhaustive switch over
  `WorkbenchOwnerToPageMessage` gets the new case.

## Parity cases

- P1 `npm install` terminal output byte-parity-clean (reach owner-port only;
  existing `shell/byte-exact-command-output` suites bind unchanged).
- P2 existing health kinds and the durability ACK channel
  (`rifty:owner-vfs-durability`/`-ack`) unchanged — existing browser-owner
  and transport suites bind.
- P3 `flush()` report/ledger contract unchanged (ADR-0358 suites; the
  observer seam is untouched).
- P4 slice-3 vfs pins R1-R4 (monotone/honesty/wedge/failure-settle) bind
  unchanged in opfs-sync.test.ts.
- P5 app-level `WorkbenchHealth` still drops `durability-progress`
  (open-workbench.ts reach line) — host-UI reach stays routed out of the
  epic.

New RED targets: the browser-owner pin, the protocol inspect case, the
browser-unit first-open acceptance. GREEN preservation: P1-P5 via existing
suites.

## Fault matrix

Reporting-only surface over the owner protocol; tier production (epic).

| # | axis × operation | injected fault | honest outcome (fault-test target) |
|---|---|---|---|
| a | frozen-assumption × emit window | drain completes before any project runtime exists | impossible by construction: forwarder sends owner-level, no bind window; first-open acceptance pins delivery-before-open-reply |
| b | observable-order × owner stream | out-of-order / regressing counts | page publishes in ipc arrival order (browser-owner pin); count monotonicity owned by the drain observer (P4 binds) |
| c | corrupt-input × protocol message | malformed `workbench:durability-progress` counts | rejected at the existing `inspectWorkbenchOwnerToPageMessage` boundary like any malformed owner message (protocol pin) |
| d | quota-perm-fail × failing drain | ops settle as failures mid first open | `persisted` never reaches `total`, no terminal event (P4 R4 binds); the open outcome stays owned by the promote proof-flush report — progress stays advisory |
| e | crash-restart × ipc send mid-drain | send throws (owner shutting down) | forwarder catch drops the frame, never fails the drain (existing catch, preserved behavior) |

## Out of scope

- Host UI rendering / app-level `WorkbenchHealth` widening (user-routed out
  of the epic; P5 pins the drop).
- Terminal-line progress (P1 forbids).
- Eddy dep-snapshot fixtures in any test lane (the closure proof drains a
  real multi-thousand-file materialization through real OPFS without
  network; the
  at-scale 13 092-op real-manifest drain proof is merged slice-3
  acceptance, unchanged by this unit).
- Progress for non-drain phases.

## Decisions

- Channel altitude resolved from code as carrier decision (agent-owned; not
  user-observable — same public stream/shape/reach): owner-level control
  message replacing the per-project vfs frame hop; ADR-0359 corrected in
  place (dated note + README Corrections row) per the active-ADR correction
  pattern — not a silent widen. Slot mechanism deleted (§Simplicity).
- Reversibility: internal protocol member + internal removals — REVERSIBLE;
  no new dep; no new coordination mechanism (epic Budget row holds at 0).
- Budget: slice **first-open-progress** band 40-150 source insertions
  (`check:budget` — tests excluded).
- This unit's Final+GREEN doubles as the epic I1 end-to-end proof; the same
  PR records epic closure (I2/I3 proofs = merged PR #262/#263/#264
  acceptance artifacts) and deletes the epic file (delete-on-done).
- Closure-proof depth (carrier decision, resolved by feasibility spike
  2026-08-16): an e2e-lane full-app spec observing `subscribeHealth` is
  structurally impossible without widening user-routed-out reach — the
  owner handle is package-private by design (`open-workbench.ts` "no owner
  handle crosses the public Workbench"), the app-level `WorkbenchHealth`
  deliberately drops `durability-progress` (reach), and the e2e env has no
  eddy resolver for heavy dep snapshots. The browser-unit carrier above
  drives the deepest real altitude that exists: the exact production
  `runWorkbenchOwner` composition over the real owner protocol with real
  OPFS; the page hop to `subscribeHealth` is pinned against the same real
  protocol boundary in workbench-browser-owner.test.ts (slice-3-accepted
  composition pattern).
- RED evidence (pre-implementation, this branch, 2026-08-16, darwin arm64
  macOS 26.3.1, node v24.16.0, vitest 2.1.9, Playwright 1.60.0 Chromium;
  raw logs /tmp/first-open-evidence/):
  - `npx vitest run packages/vfs packages/shell packages/workbench` →
    `2 failed | 3588 passed | 1 skipped` — exactly the two designed REDs:
    owner-protocol accept case (`expected null to deeply equal {type:
    'workbench:durability-progress', …}` — unknown type throws on main)
    and the browser-owner pin (`expected [] to deeply equal
    [{kind:'durability-progress',persisted:4,total:12}, …]`).
  - `RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config
    playwright.browser-unit.config.ts
    tests/browser-unit/first-open-progress.spec.ts` → `1 failed`, RED only
    on `expect(result.progressCount).toBeGreaterThan(0)`; `FIRSTOPEN256
    {"replyKind":"workbench:project-opened","progressCount":0,
    "vfsDurabilityFrameCount":0,"fileCount":2002,"dirCount":201,
    "persistedProjectFiles":2004,"timings":{"openMs":7799,…}}` — the open
    itself is fully real and green (deterministic across 3 runs incl. the
    spike's two).
