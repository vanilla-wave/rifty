import { expect, test } from '@playwright/test';

/**
 * PROD-build regression for the dual-copy `Buffer` etag crash (express + sqlite
 * preset: `res.json` → `TypeError: argument entity must be string, Buffer, or
 * fs.Stats`). This is PROD-ONLY by nature: under `pnpm dev` a child entry's
 * `import()` shares the realm's single served ESM module instance, while every
 * production `?worker&url` node-entry chunk carries its own `Buffer` copy.
 *
 * The dependency-free execSync harness already drives that exact production
 * node-entry bootstrap + module-loader boundary. Its recursive
 * `node buffer-identity.mjs` asks the same question etag asks: does the GLOBAL
 * Buffer recognise a buffer built by this realm's `node:buffer` module? This
 * avoids coupling the proof to an unrelated live Vite tree: Vite's config
 * loader correctly revokes that tree's package attestation when it writes
 * `node_modules/.vite-temp`.
 *
 * RED before the fix: `global-isBuffer=false`. GREEN after: `global-isBuffer=true`.
 * Requires cross-origin isolation for the real SAB execSync path — chromium only.
 */
test.describe('production build — child-realm global Buffer matches its module loader', () => {
  test('a node script: globalThis.Buffer recognises a node:buffer-built buffer (etag check)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'execSync over SAB needs a COI Worker — chromium only');
    await page.goto('/#test=execsync');

    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    const harness = page.locator('[data-testid="execsync-harness"]');
    await expect(harness).toBeVisible({ timeout: 20_000 });

    const detail = (await page.locator('[data-testid="execsync-detail"]').textContent()) ?? '';
    const buffer = page.locator('[data-testid="execsync-buffer"]');
    await expect(buffer, `harness detail: ${detail}`).toContainText(
      'BUF-CHECK global-isBuffer=true same=true',
    );
    await expect(harness).toHaveAttribute('data-status', 'pass');
  });
});
