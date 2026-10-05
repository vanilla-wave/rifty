# Local series preparation — 2026-10-05

BASE `a28b37da31ca3ef128bbdcb6aa55d6109c5f7d16`; Node v24.16.0, Pi 0.85.1, Chromium 148.0.7778.96.

- `pnpm test:run tools/agent-bench/src/series.fault.test.ts`: plan RED `Unknown command plan`; partial report RED no interrupted/missing rows; write-failure check passes. Initial collision probe used live endpoint and timed out; replaced with scripted native execution, same occupied-directory obligation. Initial 5s test timeout corrected to 60s; not a product repair.
- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts`: real native START/SIGTERM RED, missing unfinished trial rows. Direct CLI subprocess avoids Playwright Babel loading runtime TS declarations.
- `pnpm agent-bench run --mock-model --lane local-reference --task fix-date-sort --runs 1 --output /tmp/rifty-pr341-native-baseline`: done/fail; 1 tool, 20 input/6 output tokens; native judge dates actual [18,16,25,24,23], expected [25,24,23,22,21]. Scripted model proves plumbing only.
- Class sweep `rg` under tools/agent-bench, tools/review, tools/checks, packages/agent, packages/rifty: no series persistence mechanism; runner is sole writer, report direct JSON writes, proc owns process teardown. No separate ledger or coordinator.
- Corrected collision RED, same isolated file: scripted native runner exits 0 on occupied directory (expected refusal), no timeout. Three expected REDs, one persistence-failure check green.
- Selected unsupported RED: `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts -g 'selected unsupported'`, CLI exits 0 but report absent (ENOENT); 1.3 min packed preparation, selected trial silently skipped.

## GREEN

- `pnpm test:run tools/agent-bench/src/series.fault.test.ts tools/agent-bench/src/comparison.test.ts tools/agent-bench/src/redaction.test.ts tools/agent-bench/src/metrics-privacy.test.ts`: 36/36. Plan assertions now exact task/lane/index/order, config override and source/prompt/judge hashes. A new assertion initially compared --runs2 to config's3; corrected oracle to explicit CLI override, isolated rerun green.
- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts`: native interruption/fresh-series and unsupported-trial journeys 2/2,21.7s.
- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts contract.spec.ts -g 'all three real mock-model lanes'`: 1/1,5.1min;14 actual supported runs/28 external requests,15 selected records (one explicit no-COI Node setup failure), real tracing/common judges unchanged. Fixtures now use absent output paths; historical42-run measurements unchanged.
- `pnpm pr:check`:27/27; lint/typecheck/builds/architecture/docs gates, test:run210.0s, test:parity114.7s. No isolated failures; required full lanes green.
- `pnpm --filter @riftydev/agent-bench typecheck`: pass, including added cleanup-fault acceptance.
- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts series-interruption.spec.ts -g 'trace cleanup failure'`:1/1,9.6s; physical directory-at-browser.zip fault after START. Completed record persisted before failed tracing cleanup; next selected trial remains missing, series failed. Added after full gate; lint/typecheck + its real fault run green, production bytes unchanged.

## Final review repair

Independent Final+GREEN at9519a0b77 blocked only `reference-host.spec.ts`: direct services() needs existing output, while runner/CLI exclusively create output. Existing real test RED: ENOENT series/playground.log before boot. Class sibling-drift; sweep tools/tests found only runner and this direct-services caller. Restored this fixture's original mkdtemp; no weakening of checks.

- `pnpm exec playwright test -c tools/agent-bench/playwright.config.ts reference-host.spec.ts`:1/1,1.3min; genuine packed host,167 installed dependency versions, both unrestricted/restricted policies/text-only and real Vite preview.
- Advisory Markdown metadata moved before table header; `pnpm test:run tools/agent-bench/src/series.fault.test.ts tools/agent-bench/src/comparison.test.ts`:20/20. No result/score criterion changed.
- Post-fix `pnpm pr:check`:27/27; test:run202.2s, test:parity114.2s. Independent verify pending on committed repair.
