---
area: playground
status: draft
title: Refresh the opt-in m10-hmr e2e for the ADR-0165 multi-project default boot
created: 2026-06-22
why: the opt-in real-Vite HMR e2e (tests/e2e/m10-hmr.spec.ts, RIFTY_E2E_HMR=1) was written for the pre-ADR-0165 default-preset boot + per-run worker; multi-project changed the default boot (scratch from DEFAULT_PRESET at /scratch) so the spec is bit-rotted
user_story: As a maintainer, I want the opt-in HMR e2e to validate live module HMR under the current multi-project shell, but today it assumes the retired default-preset boot and fails when opted in (RIFTY_E2E_HMR=1) regardless of code correctness.
sources: [docs/adr/playground/0165-multi-project-management-with-durable-scratch.md, ADR-0145]
code: [tests/e2e/m10-hmr.spec.ts]
---

## Context

`tests/e2e/m10-hmr.spec.ts` is opt-in (`RIFTY_E2E_HMR=1`), skipped in CI/default, so it is NOT in the gate — but it is bit-rotted: it assumes the old default-preset boot + a per-run worker. ADR-0165 made the cold boot a scratch from `DEFAULT_PRESET` at `/scratch` (single persistent owner respawned on switch), so the spec's setup no longer matches the shell. Surfaced while validating ADR-0165 (the spec fails identically with/without the program-mirror fix — i.e. not a regression of this work, a stale spec). Live HMR itself is exercised by the default e2e suite (m0/project-switch/fullstack/socket all green); this is the deeper opt-in HMR probe.

## Options or Next

- Rewrite the opt-in spec against the multi-project shell: cold boot → scratch at `/scratch`, edit `<root>/src/main.js` via Monaco, assert the HMR client applies the update without a full reload (the root-relative program mirror, ADR-0165 §4, now reaches `<root>/src/main.js`).
- Or retire it if m10-dev-hmr + the default-suite HMR coverage subsume it.

## Reversibility

REVERSIBLE — test-only refresh of an opt-in, non-gated spec. No code/API change.
