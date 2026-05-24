import { expect, test } from '@playwright/test';

test.describe('M0 — Foundation', () => {
  test('playground loads, terminal + editor are visible, Run button works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('strong').filter({ hasText: 'rifty' })).toBeVisible();
    await expect(page.locator('[data-testid="terminal"]')).toBeVisible();
    await expect(page.locator('[data-testid="editor"]')).toBeVisible();
    await expect(page.locator('[data-action="run"]')).toBeVisible();
  });

  test('crossOriginIsolated is enabled', async ({ page }) => {
    await page.goto('/');
    const coi = await page.evaluate(
      () => (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
    );
    expect(coi).toBe(true);
  });

  test('SharedArrayBuffer is available', async ({ page }) => {
    await page.goto('/');
    const ok = await page.evaluate(() => typeof SharedArrayBuffer === 'function');
    expect(ok).toBe(true);
  });

  test('Service Worker registers', async ({ page }) => {
    await page.goto('/');
    const ok = await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      return Boolean(reg?.active);
    });
    expect(ok).toBeTruthy();
  });
});
