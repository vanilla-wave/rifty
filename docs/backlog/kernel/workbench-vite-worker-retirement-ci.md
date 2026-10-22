---
area: kernel
status: draft
title: Explain retained Worker observations after Workbench Vite close in CI
created: 2026-10-20
why: Chromium CI intermittently retains kernel-Worker observations after close; identities and physical liveness remain unproven.
sources: [tests/browser-unit/workbench-vite-lifecycle.spec.ts]
code: [packages/kernel/src/process-manager.ts, packages/kernel/src/spawn-worker.ts]
---

## Context

PR #379, HEAD `4c3208d2e00b71a53028217d050e01f4defddc24`, CI merge
`e78b6f8c6369e152c41de75190c64101e3914f4d` into main `40837803b656`.
[Browser-unit job](https://github.com/vanilla-wave/rifty/actions/runs/39381683173/job/118492329782):
383 passed, one skipped, one failed. Vite A → B → A passed its functional
assertions; at `workbench-vite-lifecycle.spec.ts:1054`, the five-second poll
still counted two `page.workers()` entries with the kernel asset URL after
`workbench.close()`. This does not identify the Workers or establish whether
physical retirement or driver observation lagged.

[Trace artifact](https://github.com/vanilla-wave/rifty/actions/runs/39381683173/artifacts/12247486003).
Local raw evidence: `/tmp/esbuild-4c-browser-plain.log`,
`/tmp/esbuild-4c-browser-artifact`; trace contained expected revoked-preview
503s but no diagnosis of those two Workers.

Exact isolated reproduction on `07dfb294b193a26921f034b92c4eea05b1774d09`:

```sh
RIFTY_PLAYGROUND_PORT=5897 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts \
  tests/browser-unit/workbench-vite-lifecycle.spec.ts --workers=1
```

PASS: one test, 24.9 s (29.2 s including setup);
`/tmp/esbuild-worker-lifecycle-isolated.log`. No runtime or test changes.
Between the failed HEAD and this reproduction, only packed-test watchdog
calibration/formatting and review records changed.

Owner: kernel/Workbench lifecycle. Trigger: the next CI gate or an isolated
reproduction retains the Workers again. Next probe: identify created/closed
Worker instances and correlate them with physical process retirement in the
same A → B → A scenario. Preserve the zero-Worker assertion and its current
deadline until evidence distinguishes a runtime defect from observation lag.

Delivery remains gated on green CI at the final PR HEAD. An isolated PASS
does not repair the recorded failure; a repeated red stays a named residual
under `rifty-fix` / `PR-6`, not a retry loop.

Dedup: no matching draft in kernel, distribution or toolchain-build; the
server-shaped lifecycle item concerns premature startup exit, not post-close
Worker retirement. No new mechanism or performance claim proposed.

2026-10-21: the same A → B → A test now fails in CI runs 39465239157 (`main`)
and 39513945622 (PR #382 merge-head); red since PR #379 merge `5e7da8be1`, at a different
assertion — `:1055` `ownerLifecycle.length` 2 of 7 after the zero-Worker poll
passed — alongside three Vite startup timeouts. Evidence and routing:
`docs/backlog/kernel/vite-startup-readiness-ci.md` §Follow-up 2026-10-21.
Trigger fired; isolated-PASS caveat no longer holds.


## Follow-up — 2026-10-22 (PR #383)

[CI job 119569092888](https://github.com/vanilla-wave/rifty/actions/runs/39700601423/job/119569092888)
on HEAD `028db5c28` passed 384 tests; only this lifecycle case failed. All
functional assertions passed. The unchanged five-second zero-Worker poll
observed three kernel-URL Workers, versus the earlier two. No lifecycle,
kernel or worker code changed in the PR's product diff.

Trace artifact `playwright-report-browser-unit`, data
`5cff43aa461c1b2f09691255d928b5560927f767.zip`, records expected revoked-preview
503s but no retained Worker identities. It does not distinguish physical
liveness from driver observation. Failure-only diagnostics retain both five-
second assertions and identify pid/ppid/argv/cwd (never environment), Worker
name and CDP target state under bounded reads. A responsive realm after close
would prove physical liveness; an unresponsive read alone proves neither
retirement nor a leak. Current owner/trigger and green-HEAD delivery gate stand.

Exact local lifecycle replay passed before/after failure diagnostics (27.3/27.9 s;
Chromium 148.0.7778.96), with unchanged zero-Worker/7-event assertions and
five-second polls. Isolated PASS is not a runtime repair.
