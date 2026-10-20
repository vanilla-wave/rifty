---
area: distribution
status: draft
title: Diagnose page closed during sandbox-support SW-denied probe
created: 2026-09-24
why: repeated browser-unit CI failures close the page mid-probe; the cause remains unknown and local runs pass
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

Second occurrence 2026-09-29: CI run 36491394224 (`c456b8ff9`, PR #359 head; the
diff touches no sandbox-support or SW code), same `sw-denied` probe, same
`page.evaluate: Target page, context or browser has been closed` at :79, as the
last agent-unrelated spec after 274 passes in a 23.4 min single-browser run.
Still not reproduced locally. Two of the last ~70 CI runs.

Rate jump 2026-10-19 (PR #377; no diff touches sandbox-support, SW or Workbench
support code): same `page.evaluate: Target page, context or browser has been
closed` at :79, now on both `sw-denied` users — :248 and :372 (`[fault:
poisoned-cache]`, its second probe is `sw-denied`). CI runs: 39172935764
(`97a9d056b`, main, :248), 39176716879 (`b9c77f5ec`, :372), 39179001991
(`d785f4faf`, :248 + :372); 39179010506 on the same `d785f4faf` passed both.
3 of the last 6 browser-unit runs. Local Chromium 148.0.7778.96, whole file
`--repeat-each=8`: 280/280. Still no browser-side cause captured.

Occurrence 2026-10-20 (PR #381, head `42a3d4626`):
[CI job 118446158154](https://github.com/vanilla-wave/rifty/actions/runs/39366901741/job/118446158154)
failed only `sw-denied` (:248), test 240 after 2.3s; 339 passed, 1 skipped overall
(22.3 min). Error unchanged at :79. Artifact 12240234469 contains only
`test.trace`, no browser-side trace or crash/close cause.

Unchanged-head local command `RIFTY_PLAYGROUND_PORT=5388 pnpm test:browser-unit
sandbox-support.spec.ts --grep 'SW registration denial differs'`: 1/1 pass
(4.8s, test 354ms). No speculative product/test change; the browser-close cause
is still unproven. The separately required main merge does not explain this
CI run, whose merge base was 3207b33ac.
