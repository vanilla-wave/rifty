import { defineConfig, devices } from '@playwright/test';

/**
 * PRODUCTION-build smoke config. The default `playwright.config.ts` runs every
 * spec against `pnpm dev` (the Vite DEV server) — so a regression that only
 * surfaces in the PRODUCTION bundle + the deploy's COI headers ships green
 * (the green-checks-but-broken-deploy gap). This config builds the app and
 * serves it with `pnpm preview` (which mirrors the Netlify COOP/COEP headers,
 * see apps/playground/vite.config.ts `preview.headers`), then runs the
 * `tests/e2e-prod/` smoke specs against that real artifact.
 */
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5273);

export default defineConfig({
  testDir: './tests/e2e-prod',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Fail-fast on CI: the prod smoke is 3 serial specs against a fresh build —
  // stop after 2 failures rather than re-booting the heavy preview artifact.
  maxFailures: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @riftydev/playground build && pnpm --filter @riftydev/playground preview',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
