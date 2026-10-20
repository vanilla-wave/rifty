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
