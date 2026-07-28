import { defineConfig, devices } from '@playwright/test';

// Overridable so parallel checkouts (git worktrees) can run e2e side by side
// without fighting over the strict default port; `pnpm dev` honours the same
// env (see apps/playground/vite.config.ts).
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5273);

// Heavy specs cold-boot the TS language-service grandchild (or a fullstack
// server) + fetch large bundles. At CI workers=3 they starved each other ACROSS
// files even with in-file `describe.serial` (d992669b "Serialize CI e2e for TS
// LS stability"), so the whole suite was globally serialized (workers=1) — which
// also serialized ~29 isolated specs that never needed it. Instead we split two
// chromium lanes: `chromium-heavy` runs these serially (run with --workers=1,
// never overlapping), `chromium-light` runs the rest in parallel. CI runs the
// two lanes as separate steps so a heavy cold-boot never contends with the light
// lane (no shared state, no overlap → fidelity preserved). firefox/webkit keep
// the full spec set for the weekly cross-browser run.
const HEAVY_SPECS = [
  '**/ts-language-service.spec.ts',
  '**/project-management.spec.ts',
  '**/project-switch.spec.ts',
  '**/fullstack-demo.spec.ts',
  '**/vite8-instant-switch.spec.ts',
];

export default defineConfig({
  testDir: './tests/e2e',
  // One throwaway page load after the webServer is up: absorbs the cold dev
  // server's dep-optimize page RELOAD (dev-only), which otherwise lands on the
  // suite's FIRST spec mid-starter-pick and silently drops the pick.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  // Lane parallelism is set per invocation, not globally: `chromium-heavy` runs
  // with --workers=1 (package.json `test:e2e:heavy`); `chromium-light` uses
  // Playwright's default worker count (`test:e2e:light`).
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Fail-fast budget on CI: stop a broadly-broken run before it burns every
  // cold-boot cycle. Tolerates a handful of retried flakes without finishing the
  // whole suite when something is fundamentally broken.
  maxFailures: process.env.CI ? 12 : undefined,
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
    { name: 'chromium-heavy', testMatch: HEAVY_SPECS, use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-light', testIgnore: HEAVY_SPECS, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
