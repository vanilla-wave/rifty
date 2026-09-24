---
area: distribution
status: draft
title: Diagnose page closed during sandbox-support SW-denied probe
created: 2026-09-24
why: browser-unit CI went red once on a checkSandboxSupport fault spec with the page closed mid-probe; it does not reproduce locally
sources: [https://github.com/vanilla-wave/rifty/actions/runs/36020399983]
code: [tests/browser-unit/sandbox-support.spec.ts, packages/workbench/src/support/check-sandbox-support.ts]
---

## Question

Why does the page, context or browser close during `checkSandboxSupport`?
Observed in CI run 36020399983 (`2f2e3aa89`, a diff that only touches
tests/e2e): `tests/browser-unit/sandbox-support.spec.ts:248` (`sw-denied`)
failed with `page.evaluate: Target page, context or browser has been closed`
at :79. The failure came 3.1 s into the probe, as test 191 of 273 in a 23.8 min
run on one long-lived browser (`workers: 1`). The test trace holds only runner
calls; no browser-side trace survived.

Only one failure of this spec in the last 60 CI runs. Local Chromium
148.0.7778.96, both runs pass:

- `--grep "SW registration denial" --repeat-each=25`: 25/25.
- the whole `sandbox-support` file with `--repeat-each=5`: 170/170.

Repro command: `RIFTY_PLAYGROUND_PORT=5394 pnpm exec playwright test --config
playwright.browser-unit.config.ts sandbox-support --repeat-each=5`.
No speculative fix is made.

Owner: sandbox-support probe lifecycle. Pickup trigger: the next reproduction.
Before choosing a fix, capture the page `crash`/`close` event and browser
stderr. The candidate is a renderer crash late in the long suite, but no cause
is established.
