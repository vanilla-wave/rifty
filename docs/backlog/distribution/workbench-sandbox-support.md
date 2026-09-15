---
area: distribution
status: ready
title: Report browser support for COI and non-COI sandboxes before opening through Workbench
created: 2026-09-15
why: Existing capability flags neither distinguish the COI and non-COI compositions nor prove that their required browser operations are usable.
user_story: As an embedder, I want to query @riftydev/workbench before opening a sandbox and explain which modes my current browser context supports, but today Workbench has no such public report.
sources: [ADR-0007, ADR-0071, ADR-0372, ADR-0375, ADR-0383, ADR-0419, docs/backlog/distribution/reference/workbench-sandbox-support-refine.md]
code: [packages/workbench/src/workbench/public.ts, packages/workbench/src/workbench/open-workbench.ts, packages/workbench/src/workbench/internal/browser-workbench-composition.ts, packages/runtime-js/src/env/capabilities.ts, packages/rifty/src/capabilities.ts, packages/rifty/src/sandbox.ts]
---

## Context

Existing SDK `checkCapabilities()` reports current-realm globals; its
`sufficient` means Worker + ServiceWorker present. Workbench exports no support
preflight and rejects missing COI during `openWorkbench()`.

Executed Chromium probe: the detector returns `sufficient: true` even when CSP
blocks the real Worker. It reports sync OPFS absent in Window while a real
dedicated Worker writes/flushes/reads exact bytes in both COI and non-COI.
The Worker error can contain no explanatory message. Evidence, script, versions
and independent early Challenge: [refine evidence](reference/workbench-sandbox-support-refine.md).

Dedup found the related startup/e2e capability-logging audit. Playground already
calls the detector and renders a fallback panel, but logging remains unverified;
that obligation stays in the [logging item](../playground/capabilities-detection-e2e-logging.md).
It does not supply a pre-opening Workbench API. Browser-matrix generation stays in the existing
[cross-browser item](../service-worker/cross-browser-compat-matrix.md).

## User scenario

Before opening a browser sandbox, an embedder calls a public
`@riftydev/workbench` API to inspect COI and non-COI support and render the
available reasons in its own UI. The report describes the current execution
context and names the composition it evaluates:

- COI: existing `openWorkbench` topology.
- non-COI: existing shared-memory-free sandbox with the Workbench toolchain
  Worker, currently opened through the SDK.

The report distinguishes failed requirements, optional limitations and checks
that could not be established. It never equates lack of COI with failure of
non-COI, missing Window OPFS with missing Worker OPFS, or a successful probe
with compatibility of every npm project. Precise causes appear when evidenced;
otherwise the failed check and unknown cause stay explicit.

The API performs real, bounded browser-capability probes before any sandbox
opens. Required checks follow both compositions' actual browser operations;
Worker/messaging, memory and storage are categories, not an exhaustive inventory.
It returns a per-mode prerequisites conclusion, with structured results and
readable explanations. It distinguishes
blocked operations from checks not completed or not applicable. Temporary
Workers/test data are cleaned up; cleanup failure is reported rather than
claimed successful. Existing project data and active sessions remain intact.

A positive result establishes the tested browser prerequisites in the current
context, not the loading or configuration of all actual deployment assets,
future storage availability, or successful execution of arbitrary packages.
Failed/unfinished optional probes do not become unconditional mode blockers;
persistence policy and existing mode requirements determine the consequence.
Repeated checks observe current conditions rather than returning stale success.
An unproved required operation prevents a positive prerequisites verdict.
For Service Worker, API presence, usable registration and control of the actual
deployment are distinct observations; the last remains deployment-specific.
Excluding deployment verification does not silently exclude browser SW checks.
Probes must preserve existing SW registrations/controllers as well as projects.

## Out of scope

Playground UI, full deployment/control verification, npm compatibility and a new
non-COI `openWorkbench` topology; per original user choices and existing ADRs.

## PICKUP evidence required

- Trace requirements to actual boot/execution paths of both compositions and
  applicable options: nested/module Workers and imports, JS evaluation, WASM,
  SAB/Atomics, Web Locks, SW and owner storage. Prove the mapping with browser
  behavior tests, including negative cases; the inventory is not a second
  hand-maintained boot policy. Full disposable boot is not prescribed.
- Resolve each SW check's safe carrier and evidence scope. Incomplete checks
  stay explicit; no mutation of existing host registrations to obtain proof.
- Preserve SDK `checkCapabilities()` as the pure synchronous realm-presence
  wrapper (ADR-0071). Its flag must not be described as proof of startup;
  reconcile public documentation and examples with the active report in this delivery.
- Compile RDY-3 fault rows for same/other-tab active sessions, concurrent/repeated
  probes, pre-existing native files, denial/quota, stalled/dead Worker and failed
  cleanup; verify only probe-owned resources are removed.
- Sweep existing deadline/settlement owners before adding coordination
  (Class-kill). Choose the owning module/public seam by architecture + ADR;
  Workbench cannot import SDK, and two public surfaces need no duplicated probe.
- Document probe-relevant CSP requirements and evidence limits. JS eval and
  WASM compilation are separate checks; their necessity follows the selected
  engine/runtime path, not one unconditional browser-wide WASM blocker.

## Decisions

- ready-verdict: 2026-09-15 — Contract+RED @ 70b887072; [independent verdict](reference/workbench-sandbox-support-contract-red.json).

- 2026-09-15 — user Round 1: public Workbench API; no Playground UI delivery.
- 2026-09-15 — user Round 2: answer before opening a sandbox.
- rejected route: startup-only diagnosis — violates the user's before-opening requirement.
- 2026-09-15 — user Round 3: «Реальные пробы браузерных возможностей»; temporary Worker/test data and cleanup were explicit in the offered choice.
- rejected route: passive API presence alone — cannot establish usable operations, as the CSP/OPFS probe shows; user chose real probes.
- 2026-09-15 — user Round 3 chose browser probes over full deployment verification; exact assets/settings and package compatibility remain outside this result.
- 2026-09-15 — ADR-0372/0375: name the existing compositions; reporting non-COI support does not make `openWorkbench` run without COI.
- 2026-09-15 — ADR-0372/0419: storage conclusions respect selected persistence policy; API presence does not prove permission or durability.
- 2026-09-15 — ADR-0007: feature evidence, not UA allowlists; no expansion of the browser-support commitment.
- 2026-09-15 — repeat/current-context observations must not change host isolation, select a mode, erase projects or present contention as browser incompatibility; inspection is the requested action.
- 2026-09-15 — public API addition needs a short ADR at PICKUP; no signature or new coordination mechanism selected during refine.
- 2026-09-15 — feedback reception: prerequisite inventory/negative proof, SW evidence levels and legacy passive API boundary clarified; user outcome unchanged, full-boot carrier not adopted. See [evidence](reference/workbench-sandbox-support-refine.md#feedback-reception).
- 2026-09-15 — pickup: ADR-0437 adds one Workbench API and inert static probe assets; no new boot policy. Source mapping and executed RED: [pickup evidence](reference/workbench-sandbox-support-pickup.md).

## Acceptance

- A1: Public `checkSandboxSupport(options?)` before opening returns named COI/non-COI conclusions, structured operation results, readable observed/unknown reasons and explicit deployment/package limits; absent required evidence is inconclusive. → scenario
- A2: Native module Worker/import, nested Worker where required, ports/BroadcastChannel, host JS evaluation, conditional WASM and COI SAB/Atomics/locks checks follow the existing compositions and selected VM/workload. CSP/browser-negative tests reject false positive prerequisites. → scenario
- A3: Dedicated Worker proves native OPFS sync handle and replica write/read/delete operations; required/preferred/ephemeral policies give their existing consequence, independent of Window sync-handle presence. → scenario
- A4: SW API presence, disposable registration/activation and unverified actual deployment control remain distinct; COI registration failure blocks, non-COI reports its optional limitation. → scenario
- A5: Repeated/concurrent probes have bounded completion and honest cleanup, preserving existing native data, live sessions and SW registrations/controllers. → scenario
- A6: SDK detector remains pure/synchronous and presence-only; consumer examples explain active diagnostics, static assets and relevant CSP requirements. → ADR-0071

## Fault matrix

- F1: Worker CSP denial, nested/import denial, dead/stalled Worker: observed failure or incomplete, bounded settlement, no invented cause; terminate own Workers/ports. → scenario
- F2: Storage permission/quota failure: required blocks, preferred limits, ephemeral skips; failed cleanup remains explicit. → scenario
- F3: Same/other-tab active sessions and concurrent/repeated calls: unique scratch/SW scopes, existing native entries/registrations/controllers retained, origin lease contention is not incompatibility, fresh denial observed. → scenario
- F4: Late native registration/storage completion and cleanup timeout/rejection: bounded report never claims unobserved removal; late owned resources still cleaned when the browser settles. → scenario
- F5: Unproved required memory/locks/SW or selected WASM operations: no supported verdict; optional failures remain limitations. → scenario

## Challenge

challenge: 2026-09-15 — 1 problem

Verbatim premise verdict and resolution in [refine evidence](reference/workbench-sandbox-support-refine.md#early-challenge).
The cheaper startup-only route was offered and rejected by user Round 2.
Round 3 selected real browser probes. No current user-scope fork remains; the
exact API, probe carriers, browser-proof suite and ADR are agent-owned at PICKUP.
This is one implementable diagnostic outcome, not a multi-unit epic; the item
is ready after native baseline, executed RED and independent Contract+RED (RDY-8).
