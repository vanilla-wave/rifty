import { defineConfig, devices } from '@playwright/test';

/**
 * no-COI substrate lane (ADR-0369): fixtures served WITHOUT COOP/COEP — the
 * load-bearing property (every other browser lane is cross-origin isolated).
 * Reused by later `no-coi-sandbox-tier` slices. Run: `pnpm test:no-coi`.
 */
const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5307);

export default defineConfig({
  testDir: './tests/no-coi',
  globalSetup: './tests/no-coi/global-setup.ts',
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
