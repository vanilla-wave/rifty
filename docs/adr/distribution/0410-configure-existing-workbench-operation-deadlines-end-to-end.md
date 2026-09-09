# ADR 0410: Configure existing Workbench operation deadlines end to end

Status: Accepted
Date: 2026-09

> TL;DR: expose effective host budgets through existing timer owners; preserve
> omitted defaults, mutation settlement and native persistence fencing.

## Context

Goal I7/scenario7 needs public effective boot/file/tool budgets with unchanged
mutation settlement. Existing page owner silence S and preview proof P already
have public options. A35s durability ACK and30s active OPFS report can defeat
larger outer settings. The existing port/coordinator/tool/drain owners remain.
Native Chromium148/Node24.16 prove overflow timers can fire immediately;
independent DEC2 decision: docs/backlog/distribution/reference/workbench-operation-budgets-range-decision.md.

## Decision

- Add deployment.ownerStartupTimeoutMs(B), projectFileCommitTimeoutMs(F),
  playgroundRequestTimeoutMs(T), inherited by both public entrypoints. Keep
  ownerOperationSilenceTimeoutMs(S) and previewProbeTimeoutMs(P) names/roles.
- All five public values: number, finite,0<value<=2147483647; validate original
  value then Math.ceil. Reject invalid/overflow before effects, including MAX+.25.
  Capture/freeze in existing options authority; preserve omission. Worker wire
  accepts only captured integers1..MAX. No clamp or segmented long timer.
- B controls existing raw-owner-ready total budget and storage-proof step
  deadlines. Omission keeps30s. Owner readiness includes mount/preload/catalog;
  it starts after SW registration/control proof, not at openWorkbench call.
  Existing physical-exit observation budget remains separate.
- F controls existing post-applied reflection/durability observation phases
  and hidden durability ACK barrier/recovery timeout. Omission keeps60s phases
  and35s ACK. No new deadline before applied terminal, retry or not-applied claim.
- T controls existing non-TS session-tool request timer: SCM/archive/durability/
  close, starting at send after document-save admission. Omission keeps60s.
  Timeout rejects that observation, not owner lifetime or an implicit rollback;
  later owner completion cannot rewrite the settled caller result.
- Catalog stays with uniform progress-only owner silence S (default60s), not T.
  Only real durability progress rearms S; ordinary traffic cannot sustain it.
- Derive shared ioReportTimeoutMs once from applicable explicit B/F/T/S
  overrides; omit if all omitted, otherwise use their maximum. P is excluded.
  Existing owner boot/storage installer conveys it to the paired OPFS instance
  and its existing drain scheduler. Default stays30s; no mutable global setting.
  An active persist operation starts this report bound at lane admission.
  Timeout releases reporting only, retaining lane/fences; late success heals
  existing ledger and never resends a mutation. Different outer timer start/
  reset rules remain intact; this is not one global operation duration.
- Extend existing installOpfsFs(root?, options?), OpfsFsSync.init(pair?,root?,
  options?) and constructor(root,pair?,options?) with optional ioReportTimeoutMs.
  Capture per instance before IO, not via a new queue/configuration owner.

## Alternatives

- Three semantic public budgets plus existingS/P; selected. Each governs its
  actual shorter siblings through current owners, without exposing their graph.
- Every inner timer public: unnecessary surface; callers could still choose
  inconsistent35/30/60 values and must reconstruct implementation dependencies.
- One wrapper/global timeout: conflates admission, silence, active IO and
  observation; breaks settlement and changes unrelated guest/TS semantics.
- Arbitrary finite durations via segmented timers: new scheduling/cancellation
  state without an accepted multi-week requirement. Native overflow is wrong;
  silent saturation admits a duration it does not honor. Explicit maximum is
  the smallest honest policy. Positive fractions round upward, not rejected.

## Existing decisions

Partially supersedes ADR0360 §Decision/Budget positive-finite-only validation
and page-side-only/no-owner-boot-config restriction: S stays page-owned, but its
shared inner report bound now crosses boot. Extends its §Uniform policy clause
that PROJECT_VFS_COMMIT_TIMEOUT_MS was untouched; F is independent of S.
Keep progress-only reset, uniform S, fatality/recovery/settlement and kernel/
child exclusions. ADR0263 owns deployment/pre-effects validation but promised
no unrestricted numeric range; cite without altering it. ADR0358 remains the
unchanged persistence lane/fence/ledger authority.

## Proof / scope

Public ingress and before-effects rejection; real browser-owner/file/tool/owner
composition with external clock/physical transport boundaries; actual native
OPFS close/read/cleanup and delayed active writes. Native default controls,
16 lanes plus same-path/capacity fencing and late byte-exact healing. Real owner
publishes file state BEFORE ACK over one ordered channel; do not manufacture
post-ACK reflection by reordering impossible frames. Existing generic reflection
controls remain, public40s/70s durability and pre-ACK wait prove reachable F.

Composed mandatory packed /sandbox/ snapshot-only Vite + namespace, saved-state/
apply/recovery and public budgets closes I1–I8. No machine-speed SLA, global
openWorkbench wall-clock cap, asset-stall override, guest execution/TS budget,
source/byte-cap relaxation or new coordination mechanism.
