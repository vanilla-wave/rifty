import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.RIFTY_LANDING_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/landing',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port}`,
    cwd: './apps/landing',
    env: {
      VITE_RIFTY_PLAYGROUND_URL: 'https://play.example.test/',
      VITE_RIFTY_REPOSITORY_URL: 'https://forge.example.test/org/rifty',
      VITE_RIFTY_SDK_DOCS_URL: 'https://docs.example.test/rifty-sdk',
      VITE_RIFTY_SITE_URL: 'https://site.example.test/',
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
