import { defineConfig, devices } from '@playwright/test';

/**
 * no-COI substrate lane — the goal `no-coi-sandbox-tier`'s first browser lane
 * served WITHOUT COOP/COEP (every other lane is cross-origin isolated).
 *
 * Contract (docs/backlog/runtime-js/worker-realm-compat-bare-sab-referenceerror.md):
 * real Chromium on a headerless page + dedicated module Worker, exercising the
 * REAL BUILT shim; every spec asserts `crossOriginIsolated === false` AND
 * `typeof SharedArrayBuffer === 'undefined'` before acting. Reused by later
 * no-COI slices; becomes the tier's CI lane at `distribution/no-coi-sandbox-build-loop`.
 *
 * Run: npx playwright test --config playwright.no-coi.config.ts
 */
const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5307);

export default defineConfig({
  testDir: './tests/no-coi',
  globalSetup: './tests/no-coi/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/no-coi', open: 'never' }]],
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/no-coi/server.mjs',
    url: `http://localhost:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...(process.env as Record<string, string>),
      RIFTY_NO_COI_PORT: String(port),
    },
  },
});
