import { expect, test } from '@playwright/test';

test('first Vite starter displays real saving operations in the preparing UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  await page.route('**/project-save-barrier', async (route) => {
    entered = true;
    await gate;
    await route.fulfill({ body: 'released' });
  });
  await page.goto('/unit-harness.html');
  const ownerUrl = await page.evaluate(async () => {
    const url = '/src/browser-unit/workbench-vite-host-assets.ts';
    const { workbenchViteHostAssets } = await import(/* @vite-ignore */ url);
    return new URL(workbenchViteHostAssets.workers.owner, location.href).href;
  });
  const observer = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/native-replica-observer.ts`;
  await page.route(ownerUrl, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `
      import { observeNativeReplicaWrites } from ${JSON.stringify(observer)};
      let held = false;
      observeNativeReplicaWrites(async records => {
        if (!held && records.some(record => record.kind === 'file' && record.path.includes('/node_modules/vite/'))) {
          held = true;
          await fetch('/project-save-barrier');
        }
      });
      ${await response.text()}
    `,
    });
  });
  try {
    await page.goto('/');
    const launcher = page.getByTestId('launcher');
    await expect(launcher).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.rf-app')).toHaveAttribute('data-project-index', 'ready');
    await page.locator('[data-preset="project-files"]').click();
    await expect.poll(() => entered, { timeout: 120_000 }).toBe(true);
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
    release();
    await expect(launcher).toHaveCount(0, { timeout: 180_000 });
    await expect(progress).toHaveCount(0);
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 60_000 });
  } finally {
    release();
  }
});
