---
kind: epic
status: draft
title: vitest `environment: 'jsdom'` — a DOM test runs in the browser shell
created: 2026-09-15
value: A vitest test that touches `document`/`window` under `environment: 'jsdom'` runs in rifty with jsdom's real behaviour, or fails with one named loud gap.
user_story: As a front-end developer, I want my component tests (jsdom environment) to run in the browser IDE like locally, but today `import('jsdom')` dies in undici's global write and, past that, jsdom 30's Window needs a vm realm rifty does not provide
---

## Outcome

Just-filed at the user's decision (2026-09-15, refine of
`vitest-run-in-browser`): deferred out of that goal because feasibility is
open. To be refined on its own before FIT.

## User scenario

Project from the closed `vitest-run-in-browser` scenario (`docs/public/compat/vitest.md`,
`tests/e2e/vitest-run.spec.ts`) plus `jsdom@30.0.1` and a test with
`// @vitest-environment jsdom` that appends an element and asserts
`document.body.innerHTML`; `vitest run` passes with the same output as Node.

## Evidence (probe 2026-09-15, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md §jsdom)

- Install: 85 packages, canvas optional peer skipped.
- `import('jsdom')` → `module-loader.cjs-global-function-assignment` on
  `undici/lib/global.js` (owned by
  `runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md`; landed,
  ADR-0444).
- Guards bypassed: `new JSDOM('<p>hi</p>')` parses and queries; with
  `runScripts: 'dangerously'` (vitest's forced default) → jsdom 30
  `Window.js:58` `vm.createContext(vm.constants.DONT_CONTEXTIFY)` →
  `vm.constants` undefined. Beyond that, the Window must live as the global
  of a vm realm; rifty's contexts are a QuickJS realm behind a membrane
  (ADR-0142/0383) — whether jsdom's interface installation survives it is the
  open question that may need a vm-engine decision (ADR).

## Challenge

challenge: 2026-09-15 — just-file capture at user decision; premise not yet critiqued (refine pending)

## Decisions

- 2026-09-15 — user: deferred out of `vitest-run-in-browser`; separate epic/spike.
