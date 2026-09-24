/**
 * pickStarter waits for the App shell, not a fixed deadline: the shell mounts only
 * after Workbench admission (owner Worker boot), which on a cold dev server or a
 * loaded CI runner lands seconds after `load`.
 */
import { expect, test } from '@playwright/test';
import { pickStarter } from './helpers/playground.ts';

const OWNER_BOOT_DELAY_MS = 4_000;

test('pickStarter picks after a slow owner Worker boot', async ({ page }) => {
  test.setTimeout(120_000);
  let delayed = 0;
  // Network delay on the owner Worker entry: the page loads, the shell does not.
  await page.route(
    (url) => url.pathname.includes('kernel-worker-host'),
    async (route) => {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, OWNER_BOOT_DELAY_MS));
      await route.continue();
    },
  );

  await page.goto('/');
  await expect(page.locator('[data-action="open-launcher"]')).toHaveCount(0);
  await pickStarter(page, 'project-files');

  expect(delayed, 'owner Worker entry request must be the delayed one').toBeGreaterThan(0);
  await expect(page.locator('[data-testid="terminal"]').first()).toBeVisible();
});
