---
area: distribution
status: draft
title: Report browser support for COI and non-COI sandboxes before opening through Workbench
created: 2026-06-08
why: Existing capability flags neither distinguish the COI and non-COI compositions nor prove that their required browser operations are usable.
user_story: As an embedder, I want to query @riftydev/workbench before opening a sandbox and explain which modes my current browser context supports, but today Workbench has no such public report.
sources: [ADR-0007, ADR-0372, ADR-0375, ADR-0383, ADR-0419, docs/backlog/distribution/reference/workbench-sandbox-support-refine.md]
code: [packages/workbench/src/workbench/public.ts, packages/workbench/src/workbench/open-workbench.ts, packages/workbench/src/workbench/internal/browser-workbench-composition.ts, packages/runtime-js/src/env/capabilities.ts, packages/rifty/src/capabilities.ts, packages/rifty/src/sandbox.ts]
---

## Question

What depth must the pre-opening support result prove? User Round 3 pending:

1. Real bounded browser-capability probes, with temporary resources and cleanup
   (recommended after the executed CSP/OPFS discriminator).
2. Passive API-presence checks only, without effects; untested operations remain
   unverified, never a claim that opening will succeed.
3. Also verify the supplied deployment assets/settings; broader than browser
   capabilities and potentially repeats startup effects.

No answer is inferred; probe mechanism, exact API shape and acceptance proof
remain for the selected route. Resume this refine when the answer arrives.

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

## Decisions

- 2026-09-15 — user Round 1: public Workbench API; no Playground UI delivery.
- 2026-09-15 — user Round 2: answer before opening a sandbox.
- rejected route: startup-only diagnosis — violates the user's before-opening requirement.
- 2026-09-15 — Round 3 depth remains user-owned; active probes are a recommendation, not an accepted implementation.
- 2026-09-15 — ADR-0372/0375: name the existing compositions; reporting non-COI support does not make `openWorkbench` run without COI.
- 2026-09-15 — ADR-0372/0419: storage conclusions respect selected persistence policy; API presence does not prove permission or durability.
- 2026-09-15 — ADR-0007: feature evidence, not UA allowlists; no expansion of the browser-support commitment.
- 2026-09-15 — repeat/current-context observations must not change host isolation, select a mode, erase projects or present contention as browser incompatibility; inspection is the requested action.
- 2026-09-15 — public API addition needs a short ADR at PICKUP; no signature or new coordination mechanism selected during refine.

## Challenge

challenge: 2026-09-15 — 1 problem

Verbatim premise verdict and resolution in [refine evidence](reference/workbench-sandbox-support-refine.md#early-challenge).
The cheaper startup-only route was offered and rejected by user Round 2.
The remaining depth question prevents claiming settled scope.
