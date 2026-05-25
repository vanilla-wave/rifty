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

  test('write file -> reload -> file persists (OPFS round-trip, A-004)', async ({ page }) => {
    // ADR-0013 acceptance: a file written through the runtime fs must survive
    // a full page reload, proving the OPFS backend is wired end-to-end. The
    // test uses a unique marker per run so reruns can't pass on stale state.
    await page.goto('/');
    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });

    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await term.click();
    await page.keyboard.type(
      `(()=>{const fs=require('fs');fs.mkdirSync('/workspace',{recursive:true});fs.writeFileSync('/workspace/persist.txt','${marker}');return 'wrote:'+fs.readFileSync('/workspace/persist.txt','utf8')})()`,
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText(`wrote:${marker}`, { timeout: 5000 });

    // Hard reload: tears the page realm down, re-runs `bootstrapPlayground`,
    // and re-mounts the runtime Worker against a fresh VFS instance. The OPFS
    // backend should re-attach to the same root and surface the same bytes.
    await page.reload();
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });
    await term.click();
    await page.keyboard.type(
      "(()=>{const fs=require('fs');return 'read:'+fs.readFileSync('/workspace/persist.txt','utf8')})()",
    );
    await page.keyboard.press('Enter');
    await expect(term).toContainText(`read:${marker}`, { timeout: 5000 });
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
