---
area: distribution
status: draft
title: Report browser support for COI and non-COI sandboxes before opening through Workbench
created: 2026-09-15
why: Existing capability flags neither distinguish the COI and non-COI compositions nor prove that their required browser operations are usable.
user_story: As an embedder, I want to query @riftydev/workbench before opening a sandbox and explain which modes my current browser context supports, but today Workbench has no such public report.
sources: [ADR-0007, ADR-0372, ADR-0375, ADR-0383, ADR-0419, docs/backlog/distribution/reference/workbench-sandbox-support-refine.md]
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
opens: Worker execution/messaging, mode-required memory operations, and
Worker-owned storage access. It returns a per-mode conclusion scoped to these
checks, with structured results and readable explanations. It distinguishes
blocked operations from checks not completed or not applicable. Temporary
Workers/test data are cleaned up; cleanup failure is reported rather than
claimed successful. Existing project data and active sessions remain intact.

A positive result establishes the tested browser prerequisites in the current
context, not the loading or configuration of all actual deployment assets,
future storage availability, or successful execution of arbitrary packages.
Failed/unfinished optional probes do not become unconditional mode blockers;
persistence policy and existing mode requirements determine the consequence.
Repeated checks observe current conditions rather than returning stale success.

## Decisions

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

## Challenge

challenge: 2026-09-15 — 1 problem

Verbatim premise verdict and resolution in [refine evidence](reference/workbench-sandbox-support-refine.md#early-challenge).
The cheaper startup-only route was offered and rejected by user Round 2.
Round 3 selected real browser probes. No current user-scope fork remains; the
exact API, probe carriers, browser-proof suite and ADR are agent-owned at PICKUP.
This is one implementable diagnostic outcome, not a multi-unit epic; the item
stays `draft` until PICKUP supplies Contract+RED and readiness evidence (RDY-1).
