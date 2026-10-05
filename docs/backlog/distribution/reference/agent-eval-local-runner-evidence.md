# Local series preparation — 2026-10-05

BASE `a28b37da31ca3ef128bbdcb6aa55d6109c5f7d16`; Node v24.16.0, Pi 0.85.1, Chromium 148.0.7778.96.

- `pnpm test:run tools/agent-bench/src/series.fault.test.ts`: plan RED `Unknown command plan`; partial report RED no interrupted/missing rows; write-failure check passes. Initial collision probe used live endpoint and timed out; replaced with scripted native execution, same occupied-directory obligation. Initial 5s test timeout corrected to 60s; not a product repair.
- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts`: real native START/SIGTERM RED, missing unfinished trial rows. Direct CLI subprocess avoids Playwright Babel loading runtime TS declarations.
- `pnpm agent-bench run --mock-model --lane local-reference --task fix-date-sort --runs 1 --output /tmp/rifty-pr341-native-baseline`: done/fail; 1 tool, 20 input/6 output tokens; native judge dates actual [18,16,25,24,23], expected [25,24,23,22,21]. Scripted model proves plumbing only.
- Class sweep `rg` under tools/agent-bench, tools/review, tools/checks, packages/agent, packages/rifty: no series persistence mechanism; runner is sole writer, report direct JSON writes, proc owns process teardown. No separate ledger or coordinator.
- Corrected collision RED, same isolated file: scripted native runner exits 0 on occupied directory (expected refusal), no timeout. Three expected REDs, one persistence-failure check green.
- Selected unsupported RED: `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts -g 'selected unsupported'`, CLI exits 0 but report absent (ENOENT); 1.3 min packed preparation, selected trial silently skipped.
