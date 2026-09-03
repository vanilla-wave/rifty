import { defineConfig, devices } from '@playwright/test';

const noCoiPort = Number(process.env.RIFTY_NO_COI_PORT ?? 5411);
const coiPort = Number(process.env.RIFTY_NO_COI_ORACLE_PORT ?? 5412);
const resourcePort = Number(process.env.RIFTY_NO_COI_RESOURCE_PORT ?? 5413);

export default defineConfig({
  testDir: './tests/no-coi',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/no-coi', open: 'never' }]],
  timeout: 900_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${noCoiPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev:no-coi',
      cwd: './apps/playground',
      url: `http://127.0.0.1:${noCoiPort}/no-coi-harness.html`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        RIFTY_NO_COI_PORT: String(noCoiPort),
      },
    },
    {
      command: 'pnpm dev:no-coi',
      cwd: './apps/playground',
      url: `http://127.0.0.1:${resourcePort}/favicon.svg`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        RIFTY_NO_COI_PORT: String(resourcePort),
      },
    },
    {
      command: 'pnpm exec vite --force',
      cwd: './apps/playground',
      url: `http://localhost:${coiPort}/unit-harness.html`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        RIFTY_PLAYGROUND_PORT: String(coiPort),
      },
    },
  ],
});
