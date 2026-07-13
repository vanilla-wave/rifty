import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-unit lane (ADR-0196): thin Playwright harness that serves
 * `apps/playground/unit-harness.html` via the REAL playground vite dev server
 * (COI headers ship in apps/playground/vite.config.ts) and behaviorally tests
 * worker-side playground modules under real cross-origin isolation + real
 * Workers — WITHOUT booting the App.
 *
 * Isolated port (5299 default) so a sibling worktree's dev server on 5273 is
 * never reused; `reuseExistingServer: false` makes every run cold + hermetic.
 *
 * Run: RIFTY_PLAYGROUND_PORT=5299 npx playwright test --config playwright.browser-unit.config.ts
 */
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5299);

// Cold-start clock: config module eval happens BEFORE playwright launches the
// webServer; globalSetup runs AFTER the URL is reachable. The delta ≈ vite dev
// cold start (plus a small playwright launch overhead).
process.env.RIFTY_BROWSER_UNIT_T0 ??= String(Date.now());

export default defineConfig({
  testDir: './tests/browser-unit',
  globalSetup: './tests/browser-unit/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/browser-unit', open: 'never' }]],
  timeout: 120_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Cold optimizer makes worker-only dependency drift fail locally and in CI.
    command: 'npx vite --force',
    cwd: './apps/playground',
    // Poll the harness page itself: proves the file is served, not just index.
    url: `http://localhost:${port}/unit-harness.html`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      RIFTY_PLAYGROUND_PORT: String(port),
    },
  },
});
