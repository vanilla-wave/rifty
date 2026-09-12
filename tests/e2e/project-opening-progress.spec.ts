import { expect, test } from '@playwright/test';

test('first Vite starter displays real saving operations in the preparing UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.goto('/');
  const launcher = page.getByTestId('launcher');
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.rf-app')).toHaveAttribute('data-project-index', 'ready');
  await page.locator('[data-preset="project-files"]').click();
  const progress = page.getByTestId('project-persistence-progress');
  await expect(progress).toBeVisible({ timeout: 120_000 });
  await expect(progress).toContainText(/Saving \d+\/\d+ operations/);
  const geometry = await progress.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      right: bounds.right,
      viewport: innerWidth,
      persisted: Number(element.getAttribute('data-persisted')),
      total: Number(element.getAttribute('data-total')),
    };
  });
  expect(geometry.width).toBeGreaterThan(40);
  expect(geometry.height).toBeGreaterThan(8);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.persisted).toBeGreaterThanOrEqual(0);
  expect(geometry.total).toBeGreaterThanOrEqual(geometry.persisted);
  await page.screenshot({ path: testInfo.outputPath('project-opening-progress.png') });
  await expect(launcher).toHaveCount(0, { timeout: 180_000 });
  await expect(progress).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 60_000 });
});
