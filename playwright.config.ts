import { defineConfig, devices } from '@playwright/test';

// Overridable so parallel checkouts (git worktrees) can run e2e side by side
// without fighting over the strict default port; `pnpm dev` honours the same
// env (see apps/playground/vite.config.ts).
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5273);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // GitHub's ubuntu runner advertises enough cores for parallel Playwright, but
  // TS-LS/fullstack specs cold-boot owner + child workers and fetch large bundles.
  // Serialize CI e2e; local runs keep Playwright's default worker count.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
