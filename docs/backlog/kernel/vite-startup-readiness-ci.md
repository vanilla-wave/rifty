---
area: kernel
status: draft
title: Explain Vite startup readiness timeouts in CI
created: 2026-10-20
why: Two Chromium CI scenarios exhaust unchanged readiness deadlines but pass isolated on the same HEAD.
sources: [tests/e2e/project-switch.spec.ts, tests/e2e/m1-terminal-shell.spec.ts, tests/e2e/helpers/playground.ts]
code: [packages/kernel/src/process-manager.ts, packages/workbench/src/workers/workbench-owner-runtime.ts]
---

## Context

PR #379 HEAD `431bf9240e8996edccb1622e6f9ac906c0708798`, main
`40837803b656`; Linux Chromium 148.0.7778.96, Playwright 1.60.0.
Two user paths fail `expectViteDevServerReady`'s unchanged 30-second poll:

- Pick Project files: before switching starters, initial port 5174 remains
  STARTING with only the idle shell prompt. `project-switch.spec.ts:233`.
  [Heavy job](https://github.com/vanilla-wave/rifty/actions/runs/39446198603/job/118709470780):
  23 passed, one failed; all three attempts fail (33.583/38.023/34.184 s).
  [Trace artifact](https://github.com/vanilla-wave/rifty/actions/runs/39446198603/artifacts/12277424037).
- After Project files starts port 5174, open another terminal and execute
  `npm run vite`: the port 5173 poll expires with `> npm run vite` / `> vite`.
  `m1-terminal-shell.spec.ts:255`.
  [Light job](https://github.com/vanilla-wave/rifty/actions/runs/39446198603/job/118709470988):
  17 passed, three skipped, one failed; all three attempts fail
  (69.471/78.394/67.636 s, including first-server startup).
  [Trace artifact](https://github.com/vanilla-wave/rifty/actions/runs/39446198603/artifacts/12275888989).

Retry traces show no page error. Last poll sees no matching live pill/switcher
option in either case. Light's final error snapshot later lists port 5173;
this does not prove readiness within the deadline or identify the delayed stage.
No evidence yet distinguishes runtime startup from host load or observation lag.

Exact same-HEAD isolated reproduction, macOS arm64 / Chromium 148:

```sh
RIFTY_PLAYGROUND_PORT=5397 pnpm exec playwright test \
  --project=chromium-heavy --project=chromium-light --workers=1 \
  tests/e2e/project-switch.spec.ts tests/e2e/m1-terminal-shell.spec.ts \
  -g 'a starter pick opens|npm run vite resolves' --trace=on
```

Both PASS: 13.6/12.8 s, 34.5 s including setup. No runtime, test, assertion,
or timeout changes. Raw evidence: `/tmp/pr379-ci-isolated.log`,
`/tmp/pr379-{heavy2,light4}-ci.log`, `/tmp/pr379-ci-{heavy2,light4}`.

Owner: kernel/Workbench startup; trigger: next CI gate or isolated reproduction
misses the readiness deadline. Next probe: correlate spawn/entry, installed CLI,
esbuild service readiness, port listen, and UI observation timestamps in these
same two journeys. Unknown fault axis at Worker startup; do not infer transport
loss/duplication/reordering, a leak, or a performance regression from timeouts.
No new coordination mechanism or timeout increase proposed.

`rifty-fix`: retain this factual draft and run the gate once more. A repeated
red remains a named delivery residual; never merge on red or call isolated PASS
a repair. Final-HEAD green CI remains required.

Dedup: kernel worker-retirement CI finding is post-close, not startup;
server-shaped-worker-process-lifecycle concerns premature exit. No matching
startup-deadline draft or declined concept found in kernel/toolchain/playground
items, goal maps, traps or ADR index. This record changes no support claim.

## Follow-up — 2026-10-20

The one next gate at `f6ce57129` repeated light-4's second-CLI timeout in all
three attempts: [job](https://github.com/vanilla-wave/rifty/actions/runs/39451668584/job/118728578937).
No blind retry followed. Same-HEAD local full file: 11/11 PASS. Linux probes
ran on a diagnostic branch; their instrumentation is not shipped in the PR.

- [Baseline/current isolated](https://github.com/vanilla-wave/rifty/actions/runs/39454287281):
  HEAD `5bd1e4b06` second CLI ready after 28.759 s (Vite reports 27.056 s);
  `f6ce57129` after 15.756 s (14.530 s). Baseline primary readiness was
  36.883 s after `bootProjectFiles` returned. Different runners; not a
  causal performance comparison of the import edit.
- [Exact light-4 workload](https://github.com/vanilla-wave/rifty/actions/runs/39455330408):
  18 passed/three skipped; second CLI 26.147 s (Vite 25.071 s). This diagnostic
  workflow built libraries first, unlike ordinary e2e CI.
- [CI setup without that build](https://github.com/vanilla-wave/rifty/actions/runs/39457215611):
  same failed scenario repeated three times, original 30-second assertion
  preserved: 16.190/16.154/16.132 s; 3/3 PASS. No late-readiness branch ran.
- Both failed runs' retry-1 traces have a last poll with zero `:5173` options,
  followed by an error-context snapshot listing the real `vite :5173` option.
  Context teardown spans 3.8/4.0 s after the failed poll. This establishes
  later readiness in those attempts, not an exact startup duration for all
  failures or their CPU/transport cause.

Artifacts: `/tmp/pr379-linux-{before,current,shard,clean}.log`,
`/tmp/pr379-analyze-startup.py`; diagnostic revisions `5d0f53a95`, `482292778`,
`2969c3e48` on `t3/pr379-linux-probe`. The diagnostic catch retained and rethrew
an original failure after observing later readiness; it did not redefine PASS.

PR-4 decision: the two June/July 30-second Vite-specific overrides predate
upstream-WASM startup. Use the existing helper's 60-second budget; preserve
its exact live-pill/port/output predicate and every functional assertion.
Both journeys start two programs, so their outer test budget is 180 seconds
(the terminal case retains its existing 90-second first-start allowance).
No runtime deadline, support claim, worker count or retry policy changes.
This is a test-budget correction, not a runtime performance repair. Mission
has no production-performance promise; measured runner variation remains honest.

Class: `frozen-assumption` at the UI readiness judge. Sweep: these are the
30-second cold-Vite callers; the TypeScript helper at
`tests/e2e/ts-language-service.spec.ts:605` boots its node-server starter,
not this Vite CLI. Shared helper/default unchanged; no new mechanism.
Owner/next probe above remain if the corrected gate fails. Do not increase
another deadline without new evidence; final-HEAD CI still gates delivery.
