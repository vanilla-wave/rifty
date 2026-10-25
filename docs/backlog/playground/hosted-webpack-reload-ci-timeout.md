---
area: playground
status: draft
title: Investigate hosted webpack workspace admission timeout after reload in CI
created: 2026-09-28
why: a supported Chromium hosted scenario completed HMR but failed to observe the restored workspace after reload; the isolated local test passes and the failure state was not retained
sources: [docs/backlog/playground/reference/hosted-webpack-reload-ci-timeout-evidence.md]
code: [tests/e2e-hosted/webpack-dev-server.spec.ts, tests/e2e/helpers/webpack-dev-server-scenario.ts, playwright.hosted.config.ts, .github/workflows/ci.yml]
---

## Context

Finding. Ready-CI run36441519067, job108994290327, HEAD0228d6e5:
webpack JS/CSS HMR completed; after page.reload, the workspace-owner selector
was absent for90s. CI:1passed/1failed. No runtime cause established.

Same committed test on local hosted HTTPS origin, isolated once:1passed(1.3m).
This does not distinguish boot refusal, chooser state, pending reopen or a
schedule-dependent failure. Contention and a persistence defect are hypotheses,
not findings. No product or oracle change made.

Playwright reported screenshot/trace paths under test-results; CI attempted to upload only
playwright-report, absent with the github reporter. No failure image/trace retained.
Artifact retention repaired in this PR; independent proof:
`docs/backlog/distribution/reference/pr-362-workflow-final-review.md`.
Next diagnostic probe on recurrence: retain the reported artifacts and inspect
actual post-reload state before proposing a repair.

Owner: Workbench restoration / hosted-test maintainer. Trigger: recurrence or
hosted-lane diagnostics work. Hosted lane passed on the next CI run36447657710 at source0abea5edf;
this draft records the non-reproduced failure and does not waive any red gate. Dedup: no matching reload-timeout finding;
existing webpack starter work covers the scenario, not this observed failure.
