---
area: playground
status: draft
title: Verify capabilities-detection startup and e2e logging
created: 2026-06-08
why: D-006 requires data-driven browser reporting; Playground consumes the detector, but startup and e2e capability logging remain unverified.
user_story: As a developer checking browser support, I want startup and e2e runs to record their real capability observations, but today that logging is unverified.
sources: [D-006, ADR-0007, docs/backlog/distribution/reference/workbench-sandbox-support-refine.md]
code: [packages/runtime-js/src/env/capabilities.ts, apps/playground/src/adapters/playground-app.tsx, apps/playground/src/components/CapabilitiesPanel.tsx]
---

## Question

Do startup and the e2e harness record capabilities with their actual realm and
mode? Verify existing wiring before prescribing additions. Do not mistake
the Window detector's OPFS flag for Worker storage support (ADR-0372).

## Context

2026-09-15 source verification: `playground-app.tsx:166` calls
`detectCapabilities`; lines 1365/1458/1515 gate execution/UI and render
`CapabilitiesPanel` when insufficient. The old audit's ambiguous UI-wiring
premise is partly resolved; startup/e2e logging itself was not checked.

The delivered public pre-opening API is documented in
[Workbench sandbox support](../../public/sandbox-support.md).
Generated per-engine reporting remains with the
[cross-browser matrix](../service-worker/cross-browser-compat-matrix.md).

## Decisions

- 2026-09-15 — retain the original logging obligation; Workbench API refinement does not close it. Owner: agent at this item's pickup; trigger: browser startup/e2e reporting work.
