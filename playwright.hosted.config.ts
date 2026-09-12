import { defineConfig, devices } from '@playwright/test';

const hostname = 'hosted.rifty.test';
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5376);
const origin = `https://${hostname}:${String(port)}`;

// The spawned Vite process inherits this value. Keep one exact port authority
// for parallel worktrees.
process.env.RIFTY_PLAYGROUND_PORT = String(port);

export default defineConfig({
  testDir: './tests/e2e-hosted',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github']] : 'list',
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @riftydev/playground exec vite --config ../../tests/e2e-hosted/vite.config.ts',
    port,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-hosted',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP ${hostname} 127.0.0.1`,
            // Exact SPKI of the committed test certificate; service workers do
            // not inherit the page context's ignoreHTTPSErrors setting.
            '--ignore-certificate-errors-spki-list=7a5DqfLu9ZDxRlxqTovJZ78NkdfWoh+huXjXazm62Uk=',
          ],
        },
      },
    },
  ],
});
