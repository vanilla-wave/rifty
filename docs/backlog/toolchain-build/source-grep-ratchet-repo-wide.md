---
area: toolchain-build
status: draft
title: Source-grep ratchet repo-wide
created: 2026-07-05
why: check:source-grep gates only the playground test surface; other packages keep unratcheted source-grep tests
user_story: As a rifty maintainer, I want the no-new-source-grep gate to cover every first-party test, but today a grep added under packages/* or tests/integration passes CI silently
blocked_by: []
sources: []
code:
  - tools/checks/source-grep-ratchet.mjs
---

## Context

PR #113 review: the ratchet's stated policy ("refuses new source-grep tests") read repo-wide while the scanner walked `apps/playground/src` only. The scanner now also covers `tests/browser-unit`, and the wording states the scope honestly — but a full sweep (detector run, 2026-07-05) found pre-existing greps outside it:

- `packages/ts-language-service/src/hard-ceil-source.test.ts` — 34
- `packages/ts-language-service/src/trigger-context-source.test.ts` — 14
- `tests/integration/landing-static.test.ts` — 6
- `packages/net/src/sqlite/engine-sync-pending.test.ts` — 3
- `packages/runtime-js/src/module-loader/resolver-bundling.test.ts` — 2
- `packages/service-worker/tests/preview-routing-docs.test.ts` — 2

Extending scope means auditing each (behavioral conversion vs honest allowlist why) — package-owner judgment, not a blanket allowlist dump. The detector also false-positives on its own test file (`tools/checks/source-grep-ratchet.test.ts` fixtures are string literals), so a `tools/` scan needs fixture exclusion first.

## Acceptance

- `SCAN_ROOTS` covers all first-party test roots (`apps`, `packages`, `services`, `tests`, `tools`), skipping `node_modules`/`dist`/symlinks.
- Every surviving grep has an allowlist entry with an enforced non-empty `why`; the rest converted to behavioral tests.
- Ratchet self-test fixtures excluded without weakening real-file detection (RED-check: a real grep in `tools/` still counts).
