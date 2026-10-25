import { defineConfig } from '@playwright/test';

/** On-demand diagnostic acceptance; real-model runs are never a CI lane. */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_200_000,
  reporter: 'list',
});
