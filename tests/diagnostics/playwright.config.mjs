import { defineConfig, devices } from '@playwright/test';

const targetUrl = process.env.RIFTY_SAB_DIAGNOSTIC_URL;
if (targetUrl === undefined || targetUrl.length === 0) {
  throw new Error('RIFTY_SAB_DIAGNOSTIC_URL must name the deployed playground origin');
}
const target = new URL(targetUrl);
if (target.protocol !== 'https:' && target.protocol !== 'http:') {
  throw new Error('RIFTY_SAB_DIAGNOSTIC_URL must use http: or https:');
}

// Opt-in forensic carrier. No root script or CI matrix references this config.
export default defineConfig({
  testDir: '.',
  testMatch: 'sab-ring-chromium-lifecycle-wake.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  reporter: 'list',
  use: {
    baseURL: target.origin,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium-sab-lifecycle', use: { ...devices['Desktop Chrome'] } }],
});
