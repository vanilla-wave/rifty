---
area: kernel
status: draft
title: Explain Vite startup readiness timeouts in CI
created: 2026-10-20
why: Chromium CI Vite readiness deadlines expire since PR #379; browser-unit red on every CI run at or after the merge so far
sources: [tests/e2e/project-switch.spec.ts, tests/e2e/m1-terminal-shell.spec.ts, tests/e2e/helpers/playground.ts, tests/browser-unit/vite-at-root.spec.ts, tests/browser-unit/esbuild-vite-contract.spec.ts, tests/browser-unit/workbench-vite-lifecycle.spec.ts]
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

## Follow-up — 2026-10-21 (main red, browser-unit)

Observed, undiagnosed; recorded from branch `t3/fetch-uncloneable-clone`
(PR #382, diff touches no Vite/esbuild path) because its CI cannot go green.

`main` push CI is red since `5e7da8be1` (= PR #379 merge, 2026-10-20T17:20Z):
[run 39465239157](https://github.com/vanilla-wave/rifty/actions/runs/39465239157)
browser-unit-chromium fails 4 tests; the previous main run
[39375394764](https://github.com/vanilla-wave/rifty/actions/runs/39375394764)
(`40837803b`, PR #381) passed them. Same 4 on PR #382 merged head `646a6c494`,
[run 39513945622](https://github.com/vanilla-wave/rifty/actions/runs/39513945622).
Two cited red runs (one `main`, one PR merge-head) against a green
predecessor, same 4 tests: not a one-off flake; the isolated-PASS caveat
above no longer holds for this lane.

| test | CI result | green-main baseline |
|---|---|---|
| `tests/browser-unit/esbuild-vite-contract.spec.ts:1010` "Vite 7 config graph and dependency optimizer use real esbuild over owner VFS" | 4.0 m = `test.setTimeout(240_000)` exhausted | passed |
| `tests/browser-unit/vite-at-root.spec.ts:192` "watched dev server at root / \| at default matches real Node + Vite 7.3.6" | 29.0 s / 28.8 s; `:225` `expect(out).toMatch(/VITE v7\.3\.6 {2}ready/u)` received `""` — `runOwnerCommand(page, 'vite --debug hmr', 20_000)` saw no output within its 20 s deadline | 28.3 s / 28.3 s total test time; passed |
| `tests/browser-unit/workbench-vite-lifecycle.spec.ts:9` "public Workbench keeps one ephemeral owner across exact Vite A to B to A lifecycle" | 28.2 s; every functional and zero-Worker assertion passed, then `:1055` `expect.poll(() => ownerLifecycle.length, {timeout: 5_000}).toBe(7)` received 2 | 24.8 s |

Local, macOS arm64 / Chromium 148, `6482d8c7a` (main `5e7da8be1` merged):
`RIFTY_PLAYGROUND_PORT=5433 pnpm test:browser-unit tests/browser-unit/vite-at-root.spec.ts`
→ 6/6 PASS, watched dev server 36.3 s / 37.3 s total;
`esbuild-vite-contract.spec.ts --grep "dependency optimizer"` → PASS 47.6 s.
Local passes: the `vite` ready line lands inside its 20 s window there. Local
vs CI-runner durations are not a causal comparison (same caveat as
2026-10-20); no pre-#379 local baseline was measured.

Hypothesis, unverified: ADR-0543 runs the unmodified upstream `esbuild-wasm`
Node entry in COI — WASM compile/instantiate per esbuild service start, no
generated-runtime fast path — so dev-server `ready` and the dependency
optimizer take longer and CI runners cross fixed waits. Not established: where
the time goes (install, CLI spawn, esbuild service start, optimizer, port
listen, output transport). The lifecycle row is post-close observation
(2 of 7 owner lifecycle events recorded), sibling of
`docs/backlog/kernel/workbench-vite-worker-retirement-ci.md`; it may share a
cause or not — do not merge the two until timestamps say so.

Routing: `rifty-fix` unit on `main`, not inside PR #382. A repair names the
measured delayed stage (timestamps across install, CLI spawn, esbuild service
start, optimizer, port listen, output transport — the probe already listed
above) and carries that evidence; a raised wait budget without a measured
cause is not a repair (`AGENTS.md` §Fidelity; the PR-4 budget correction above
was already spent once). Whether a Node-timing reference belongs in acceptance
is an open fork, not decided here. Owner/trigger unchanged.

