---
area: toolchain-build
status: draft
title: Observable acceptance for docs-only CI skip path
created: 2026-07-26
why: PR #183 shipped docs-only heavy-job skipping proven only by YAML source assertions; DoD says source greps cannot close acceptance
sources: [PR #183 Final+GREEN review residual]
code: [tools/checks/ci-change-scope.mjs, tools/checks/ci-gate.mjs]
---

## Context

ADR-0323 gating landed with unit tests for classifier + `ci-gate.mjs` reducer
and YAML contract assertions (`tools/checks/ci-change-scope.test.ts`), but no
observed run of either contracted skip outcome:

- docs-only PR: 14 heavy jobs `skipped`, unconditional checks + `CI gate` green;
- merge-group event: full suite runs read-only.

This PR is itself docs-only — its own CI run is the first acceptance evidence
for the skip path. Remaining: one observed merge-group run (needs merge queue
enabled) and the fail-open path (dead `change-scope` job → heavy jobs still
run) which is only unit-proven in `ci-gate.test.ts`, not observed on GitHub.
Delete this item when each outcome has a recorded run URL.
