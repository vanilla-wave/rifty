# Hosted webpack reload observation — 2026-09-28

CI: https://github.com/vanilla-wave/rifty/actions/runs/36441519067/job/108994290327
HEAD0228d6e5d44494e68b6c102c1dea936809bb4d30. Playwright1.60.0; the lane
log does not print the observed browser build. Exact failed assertion:

```text
tests/e2e/helpers/webpack-dev-server-scenario.ts:312
await page.reload();
expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible
Timeout: 90000ms; element(s) not found
1 failed, 1 passed (2.7m)
```

The helper reached its reload after JS/CSS HMR assertions. CI log reported
screenshot/trace under test-results; upload-artifact said no files at
playwright-report. No browser failure-state artifact is available.

One isolated real Chromium hosted test on the same product tree:

```sh
RIFTY_PLAYGROUND_PORT=5476 pnpm exec playwright test --config playwright.hosted.config.ts --project=chromium-hosted tests/e2e-hosted/webpack-dev-server.spec.ts --workers=1 --output=/tmp/pr362-hosted-isolated-results
```

Output: `1 passed (1.3m)`, exit0. Log: `/tmp/pr362-hosted-isolated.log`.
No tracked edits. Not reproduced; no speculative fix. A request to repeat the
completed CI job was refused while its enclosing workflow was still running;
no repeat executed by that request. The next CI gate will run on the diagnostic-upload repair, so recurrence retains its real failure state; no redundant retry of the obsolete head.
