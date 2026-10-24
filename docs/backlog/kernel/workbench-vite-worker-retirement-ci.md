---
area: kernel
status: draft
title: Explain retained Worker observations after Workbench Vite close in CI
created: 2026-10-20
why: One Chromium CI run observed two kernel Workers after close; isolated reproduction passed.
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

## Follow-up 2026-10-25 — release v0.11.0 investigation

Baseline `132137bca4a0a706b1a082aa7e63521eaeca4602`. Main CI
[39974798025, attempt 1](https://github.com/vanilla-wave/rifty/actions/runs/39974798025)
again failed only the zero-Worker assertion (385 passed, one failed).
Attempt 2 reruns that failed job; not a repair.
Local Node 24.18.0, Playwright 1.60.0, bundled Chromium 148.0.7778.96.

```sh
RIFTY_PLAYGROUND_PORT=5391 pnpm test:browser-unit \
  tests/browser-unit/workbench-vite-lifecycle.spec.ts --repeat-each=5
```

One unchanged isolated run passed. Repetition with passive Worker create/close
logging reproduced the same assertion (one failed, four passed). Eight Workers
were created; the owner (first) and reopened Vite A (seventh) remained. The
reopened esbuild child (eighth) closed. `Target.getTargets` also retained the two
worker targets. Target presence alone does not prove executing native threads.
Evidence: `/tmp/rifty-workbench-worker-probe.log`.

Temporary shared-memory probes at `spawnKernelWorker` recorded entry and return
from native `worker.terminate()` for the two remaining Workers, without a throw.
Their sync-ring request/reply state was idle at that boundary. This rules out a
missing terminate invocation in those observed runs; it does not prove physical
retirement or exclude waits in other guest-owned buffers. Probes were removed.
Evidence: `/tmp/rifty-workbench-sab-probe.log`,
`/tmp/rifty-workbench-rings-probe.log`.
Ring-probe decoder: each tuple is `[id, event, parentId, a, b]`. A shared
atomic sequence assigns `id` at spawn; `parentId` travels in the init message.
Event 1 records creation (`a=pid`, `b=ppid`). Events 2/3/4 record immediately
before `worker.terminate()`, immediately after return, or its catch;
`a=Atomics.load(new Int32Array(fullSpec.syncRing), 1)` (REQ_STATE),
`b=...2` (REP_STATE), both zero = idle. The earlier SAB-only probe uses
the same five fields but always records `a=pid`, `b=ppid`.

A subsequent run restored all product code and used only passive create/close
logging plus protocol logging. The original five-second assertion was retained;
a failed assertion waited another 15 seconds for observation, then rethrew.
One failed, four passed; the same two Workers remained after the additional
wait. No `worker.evaluate()` was used in this run. Earlier active evaluation
probes timed out but cannot establish physical liveness and are not an oracle.
Command: the above with `DEBUG=pw:protocol`.
Evidence: `/tmp/rifty-workbench-protocol.log`,
`/tmp/rifty-protocol-summary.txt` (partial; raw log is authoritative).
The temporary summary parser keys pending commands only by ID across browser
connections; do not use its aggregate pending count. The oversized output caused
an HTML reporter `RangeError: Invalid string length` after test completion.

The protocol had pending `Network.getResponseBody` commands for imported git
modules in successful and failing runs; no causal claim follows. The same five
repetitions with `--trace=off` passed (`/tmp/rifty-workbench-trace-off.log`). This
small timing-sensitive comparison does not justify disabling trace or weakening
the zero-Worker assertion. Chromium inspector interference remains a hypothesis,
not an established root cause. No product fix or timeout change is supported yet.

During failure teardown the owner produced a close event; reopened Vite A did
not. This lifecycle distinction still does not establish physical liveness.

Next discriminating probe requires a symbolized Chromium build matching the
failing version: log native Worker creation/termination with Worker token,
parent token and OS thread ID, correlate creation order to Workers 1/7, and
capture renderer thread stacks while preserving the failing page before teardown
(e.g. macOS `sample <renderer-pid> 1 -file <output>`). A mapped live thread plus
its shutdown stack localizes physical retention; a recorded thread shutdown
with a surviving target localizes inspector bookkeeping. Target count or timed
out JS evaluation alone cannot substitute. Native token/thread instrumentation
is not yet prepared; no claim that this probe has run.

Required remaining proof: establish that boundary, then a discriminating
regression and root repair. This remains a release residual, not a repaired or
waived failure. `rifty-fix` step 1 applies: red reproduces but resists diagnosis;
no speculative code or test change ships.
