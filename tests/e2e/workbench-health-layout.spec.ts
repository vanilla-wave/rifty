import { type Page, expect, test } from '@playwright/test';

const APP_BOOT_TIMEOUT = 120_000;
const WORKSPACE_OWNER_WORKER_URL_MARKER = 'quickjs-kernel-worker-host';

test.describe('Workbench App recovery surfaces', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Workbench targets fresh Chromium');
    test.setTimeout(180_000);
  });

  test('collapsed files panel persists with an always-visible recovery control', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('rf-e2e-layout-reset') !== null) return;
      localStorage.removeItem('rf.layout.v2');
      sessionStorage.setItem('rf-e2e-layout-reset', '1');
    });
    await page.goto('/');
    await openProjectFilesIfNeeded(page);

    const shell = page.locator('.rf-shell');
    const filesTab = page.getByRole('tab', { name: 'Files', exact: true });
    const recovery = page.getByRole('button', { name: 'Show files panel' });
    await expect(shell).toHaveAttribute('data-sidebar', 'open', { timeout: APP_BOOT_TIMEOUT });
    await expect(filesTab).toBeVisible();

    await filesTab.click();
    await expect(shell).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(recovery).toBeVisible();

    await page.reload();
    await expect(shell).toHaveAttribute('data-sidebar', 'collapsed', {
      timeout: APP_BOOT_TIMEOUT,
    });
    await expect(recovery).toBeVisible();

    await recovery.click();
    await expect(shell).toHaveAttribute('data-sidebar', 'open');
    await expect(recovery).toHaveCount(0);
  });

  test('owner crash keeps a persistent reload recovery surface', async ({ page }) => {
    await page.goto('/');
    await openProjectFilesIfNeeded(page);

    const ownerUrl = async (): Promise<string | null> =>
      page
        .workers()
        .map((worker) => worker.url())
        .find((url) => url.includes(WORKSPACE_OWNER_WORKER_URL_MARKER)) ?? null;
    await expect.poll(ownerUrl, { timeout: 30_000 }).not.toBeNull();
    const owner = page
      .workers()
      .find((worker) => worker.url().includes(WORKSPACE_OWNER_WORKER_URL_MARKER));
    if (owner === undefined) {
      throw new Error('kernel-hosted Workbench owner realm was not observable');
    }
    await owner.evaluate(() => {
      setTimeout(() => {
        throw new Error('injected real owner crash after App readiness');
      }, 0);
    });

    const recovery = page.locator(
      '[data-workbench-health="unavailable"], [data-workbench-health="fatal"]',
    );
    await expect(recovery).toBeVisible({ timeout: 30_000 });
    await expect(recovery.getByRole('button', { name: 'Reload' })).toBeVisible();
    await page.waitForTimeout(250);
    await expect(recovery).toBeVisible();
  });

  test('owner boot failure exposes Retry and Reload, then Retry opens a fresh owner', async ({
    page,
  }) => {
    let rejectOwnerBoot = true;
    await page.route('**/*workbench-owner-bootstrap*', async (route) => {
      const isWorkerEntry = new URL(route.request().url()).searchParams.has('worker_file');
      if (rejectOwnerBoot && isWorkerEntry) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    const failure = page.locator('[data-workbench-health="boot-failed"]');
    await expect(failure).toBeVisible({ timeout: APP_BOOT_TIMEOUT });
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(failure.getByRole('button', { name: 'Reload' })).toBeVisible();

    rejectOwnerBoot = false;
    await failure.getByRole('button', { name: 'Retry' }).click();
    await expect(failure).toHaveCount(0, { timeout: APP_BOOT_TIMEOUT });
    await expect(page.locator('.rf-app')).toHaveAttribute('data-project-index', 'ready', {
      timeout: APP_BOOT_TIMEOUT,
    });
  });
});

async function openProjectFilesIfNeeded(page: Page): Promise<void> {
  await expect(page.locator('.rf-app')).toHaveAttribute('data-project-index', 'ready', {
    timeout: APP_BOOT_TIMEOUT,
  });
  const launcher = page.getByRole('dialog', { name: 'Project launcher' });
  if (await launcher.isVisible()) {
    await launcher.getByRole('button', { name: /Project files/ }).click();
    await expect(launcher).toHaveCount(0, { timeout: APP_BOOT_TIMEOUT });
  }
  await expect(page.locator('.rf-app')).toHaveAttribute('data-workspace-owner', 'workspace', {
    timeout: APP_BOOT_TIMEOUT,
  });
}
