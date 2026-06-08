/**
 * M10 — Dev-mode HMR through the cross-realm bridge (ADR-0095).
 *
 * Unlike `m10-hmr.spec.ts` (real-Vite, skip-by-default because it installs Vite
 * from npm, ~20s), dev mode boots an in-page mini dev server instantly — so
 * this roundtrip runs by default and guards the dev-vs-real-Vite HMR asymmetry
 * fix: a file edit must reach the preview iframe and reload it WITHOUT a manual
 * page refresh.
 *
 * Pipeline asserted end-to-end:
 *   editor edit → `setSource`/`updateEntry` → VFS write → dev server `fs.watch`
 *   → `BroadcastChannel` HMR bridge → iframe client → `location.reload()` →
 *   iframe `#app` shows the new content.
 */
import { expect, test } from '@playwright/test';

test.describe('M10 — dev-mode HMR over cross-realm bridge (ADR-0095)', () => {
  test('editing src/main.js in dev mode live-reloads the preview iframe', async ({
    page,
    browserName,
  }) => {
    // The playground preview stack (service worker + cross-origin-isolated
    // worker boot) is validated in chromium — the default `pnpm test:e2e` gate.
    // firefox/webkit dev-mode boot is out of scope for this regression guard.
    test.skip(browserName !== 'chromium', 'playground preview stack is chromium-validated');
    test.setTimeout(60_000);
    await page.goto('/');

    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 15_000 });

    // Enter dev mode via the Templates gallery (the "Dev server + HMR" tile).
    await page.locator('[data-action="view-templates"]').click();
    await expect(page.locator('[data-testid="gallery"]')).toBeVisible();
    await page.locator('[data-preset="dev-hmr"]').click();
    await expect(term).toContainText('entering dev mode', { timeout: 15_000 });

    // The preview iframe must mount and load the cross-realm bridge HMR client
    // (NOT the example's built-in native-WebSocket client, which can't cross the
    // realm boundary).
    const previewFrame = page.frameLocator('iframe').first();
    await expect(previewFrame.locator('script[data-rifty-hmr-bridge]')).toHaveCount(1, {
      timeout: 20_000,
    });

    // Seeded content renders first.
    await expect(previewFrame.locator('#app')).not.toBeEmpty({ timeout: 20_000 });

    // Edit the program: replace the editor content so #app renders a unique
    // marker. Drive Monaco through a real focus + select-all + fill so its model
    // change fires `onProgramChange` (a bare textarea `.value` set does not).
    const marker = `dev-hmr-${Date.now()}`;
    const editor = page.locator('[data-testid="editor"]');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page
      .locator('[data-testid="editor"] textarea')
      .fill(`document.getElementById('app').textContent = ${JSON.stringify(marker)};\n`);

    // The watcher picks up the write, the bridge broadcasts `{type:'update'}`,
    // and the injected client reloads the iframe — so #app becomes the marker
    // with no manual refresh.
    await expect(previewFrame.locator('#app')).toHaveText(marker, { timeout: 20_000 });
  });
});
