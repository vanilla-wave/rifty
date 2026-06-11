import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
} from './helpers/playground.ts';

test.describe('M0 — Foundation', () => {
  test('playground loads, terminal + editor are visible, and shell terminals can be opened', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('strong').filter({ hasText: 'rifty' })).toBeVisible();
    await expect(page.locator('[data-testid="terminal"]')).toBeVisible();
    await expect(page.locator('[data-testid="editor"]')).toBeVisible();
    await expect(page.locator('.rf-tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /src\/main\.js/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: /project-summary\.js/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /project\.json/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible();
  });

  test('crossOriginIsolated is enabled', async ({ page }) => {
    await page.goto('/');
    const coi = await page.evaluate(
      () => (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
    );
    expect(coi).toBe(true);
  });

  test('runtime guard does not paint the COI fatal banner when isolation is on', async ({
    page,
  }) => {
    // Regression net: `assertCrossOriginIsolated()` in main.tsx must be a no-op
    // when COOP/COEP headers are configured correctly (ADR-0002 / D-001). If
    // the Vite headers regress, the bootstrap pipeline aborts and paints the
    // `[data-banner="coi-fatal"]` element instead of rendering the App. The
    // assertion below catches that — and the positive assertion catches the
    // opposite regression (guard accidentally removed and App renders without
    // SAB available, downstream code blows up silently).
    await page.goto('/');
    await expect(page.locator('[data-banner="coi-fatal"]')).toHaveCount(0);
    // The App must have rendered — the storage badge proves `bootstrapPlayground`
    // resolved (it only paints after `initBackend()` returns).
    await expect(page.locator('[data-storage-badge]')).toBeVisible();
  });

  test('shell file commands round-trip through the workspace VFS', async ({ page }) => {
    await page.goto('/');
    await openShellTerminal(page);

    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await runTerminalLine(
      page,
      `mkdir -p /workspace && echo ${marker} > /workspace/persist.txt && cat /workspace/persist.txt`,
    );
    await expectTerminalContains(page, marker);
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
