---
area: kernel
status: draft
title: Explain retained Worker observations after Workbench Vite close in CI
created: 2026-10-20
why: Intermittent Chromium Worker retention after Workbench close now reproduces locally; root cause remains undiagnosed.
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


## Follow-up — 2026-10-23, compact snapshots PR #388

Same `:1054` symptom on HEAD `234baef0b0aa07cd7f11ee71e22f88763f1da512`:
[CI job](https://github.com/vanilla-wave/rifty/actions/runs/39880590890/job/120177259917)
finished 384 passed / one skipped / one failed. Functional Vite A→B→A
assertions passed; two kernel Worker observations remained after the unchanged
five-second close poll. Other PR checks passed, including compact no-COI
acceptance. This PR changes no kernel/owner teardown implementation.

Unlike the initial isolated PASS, the unchanged spec reproduced locally:

```sh
RIFTY_PLAYGROUND_PORT=55381 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts \
  tests/browser-unit/workbench-vite-lifecycle.spec.ts
```

RED, 34.7 s: expected zero Workers, observed two at `:1054`.
Node 24.16.0 / Chromium 148.0.7778.96 / macOS arm64.
Raw: `/tmp/compact-browser-isolated.log`, `/tmp/compact-browser-ci-red.log`.

Diagnostic copies retained every original assertion/deadline; no product fix:

- Creation/close events identified the retained pair as the owner and last Vite
  Worker; its esbuild child had emitted Worker.close. Earlier A/B Workers closed.
  Three repeats: two PASS / one RED (`/tmp/compact-worker-probe-repeat.log`).
- Native terminate instrumentation recorded before/after calls returning for
  both retained Workers. Two of three repeats showed two CDP targets at failure; two
  page.workers() observations remained after 30 additional seconds. Evaluate
  requests in both timed out. Those extra
  observations are not proof of a native root cause and do not replace the
  original assertion (`/tmp/compact-terminate-probe.log`).
- A passive post-failure sampler, with no pre-failure route/observer changes,
  caught the original RED in repeat 9 of 10; nine passed. One owned renderer
  was sampled before a subsequent `ps` raced an exited child process. The
  diagnostic then failed at `ps`; the failure path after the original assertion
  had already logged two Workers.
  `/tmp/compact-passive-stack-series.log`, `/tmp/compact-native-sample-84719.txt`:
  three DedicatedWorker threads stayed in idle `mach_msg` stacks during the
  sample. Symbols are stripped; threads are not mapped to target identities.
- Native controls passed: two-level blocked-child termination, waitAsync arms,
  startup cuts, and 20 three-level cycles matching
  owner→Vite→WASM depth. Logs: `/tmp/compact-native-worker-probe.log`,
  `/tmp/compact-native-async-worker-probe.log`,
  `/tmp/compact-native-startup-cut-probe.log`,
  `/tmp/compact-native-three-level-probe.log`. These do not reproduce Rifty's
  full native lifecycle and establish neither a kernel nor a Chromium cause.

Cause remains undiagnosed. No raised timeout, weaker assertion, retry policy or
speculative runtime change. Next discriminating probe: correlate passive CDP
`Target.attachedToTarget` / `Runtime.runIfWaitingForDebugger` /
`Target.detachedFromTarget` with these instances; if complete, minimize the
async nested shutdown and obtain symbolized native state. Owner unchanged.
The caller follows rifty-fix §1: one gate repeat after recording evidence;
a repeated RED still blocks delivery. A later GREEN is not a repair claim.

Written-result check: 2026-10-23 — independent RDY-6 PASS; factual bounds and
rifty-fix §1 routing verified against the logs and retained diagnostic sources.
