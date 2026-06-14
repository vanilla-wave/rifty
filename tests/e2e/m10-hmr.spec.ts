/**
 * M10 — real Vite HMR through the cross-realm bridge.
 *
 * What this verifies end-to-end (when enabled):
 *   1. The playground enters Real Vite mode.
 *   2. The preview iframe loads.
 *   3. An HMR-able edit to `src/main.js` propagates through Vite's real HMR
 *      channel over the generic `@riftydev/net` WebSocket bridge and patches
 *      the module without a full iframe reload.
 *
 * Why this spec is skipped by default at agent-runtime time:
 *   - Real Vite mode bootstraps by installing Vite from the npm registry
 *     proxy. The install takes ~20s in the playground's local dev env even
 *     on a warm machine, and is wire-bound when the proxy is cold. Running
 *     it as part of every CI invocation would dwarf the rest of the M0..M9
 *     suite. The unit test in
 *     `apps/playground/src/glue/hmr-bridge.test.ts` already exercises
 *     the wiring contract (ordinary WebSocketServer accepts cross-realm
 *     clients, broadcasts reach them, `transformIndexHtml` injects the generic
 *     WebSocket bridge idempotently).
 *   - Set `RIFTY_E2E_HMR=1` to opt-in locally once you've warmed the
 *     install cache and want to validate the full roundtrip against a real
 *     browser. The first run still pays the install cost; subsequent runs
 *     reuse the tarball cache (ADR-0023).
 *
 * Manual verification steps (no env flag needed):
 *   1. `pnpm dev` → open `http://localhost:5273`.
 *   2. Wait for the visible terminal's `vite` command to print
 *      `[vite] dev server ready on port 5174`.
 *   3. Confirm the preview iframe shows the seeded "Hello from real Vite"
 *      message.
 *   4. Open DevTools → `Application` → `Frames` → drill into the preview
 *      iframe; in its Console run
 *         document.querySelector('script[data-rifty-hmr-bridge]') !== null
 *      and confirm it is `true`. That proves
 *      {@link createHmrBridgeVitePlugin} injected the inline WebSocket bridge.
 *   5. Edit the editor pane to change the body text. Save (Cmd/Ctrl-S in
 *      the editor or wait the implicit auto-update).
 *   6. The iframe should update within the file-watcher poll interval without
 *      losing `globalThis` state; the terminal logs no errors.
 */
import { expect, test } from '@playwright/test';

const enabled = process.env.RIFTY_E2E_HMR === '1';
const HMR_EVENT_KEY = '__rifty_e2e_hmr';

test.describe('M10 — real Vite HMR over cross-realm bridge', () => {
  test.skip(!enabled, 'set RIFTY_E2E_HMR=1 to run; bootstraps a real Vite install (~20s)');

  test('preview iframe patches src/main.js without a full reload', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('vite: starting dev server', { timeout: 10_000 });
    await expect(term).toContainText('[vite] dev server ready on port 5174', { timeout: 60_000 });

    // The preview iframe must mount and load the bridge client.
    const previewFrame = page.frameLocator('iframe').first();
    await expect(previewFrame.locator('script[data-rifty-hmr-bridge]')).toHaveCount(1, {
      timeout: 30_000,
    });
    await page.evaluate((key) => localStorage.removeItem(key), HMR_EVENT_KEY);
    await previewFrame.locator('body').evaluate((_, key) => {
      const marker = `survive-${Date.now()}`;
      (globalThis as typeof globalThis & { __riftyHmrSentinel?: string }).__riftyHmrSentinel =
        marker;
      localStorage.setItem(`${key}:sentinel`, marker);
      localStorage.removeItem(`${key}:beforeunload`);
      globalThis.addEventListener('beforeunload', () => {
        localStorage.setItem(`${key}:beforeunload`, '1');
      });
      globalThis.addEventListener('rifty:hmr:message', (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        localStorage.setItem(key, JSON.stringify(detail));
      });
    }, HMR_EVENT_KEY);
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as unknown as { __riftyHmrOpen?: unknown };
            return global.__riftyHmrOpen === true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Snapshot the current body text so we can assert a real change.
    const initialBody = await previewFrame.locator('#app').textContent();
    expect(initialBody).toBeTruthy();

    // Edit the file through Monaco's real input path; no test-only setter.
    // Prepend a stable override instead of relying on platform-specific
    // select-all shortcuts to replace the whole model.
    const marker = `hmr-${Date.now()}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(
      `setInterval(() => { document.getElementById('app').textContent = ${JSON.stringify(
        marker,
      )}; }, 50);\n`,
    );
    await expect(editorLines).toContainText(marker);
    await expect(term).toContainText(
      '[real-vite/worker] editor write applied /workspace/src/main.js',
      {
        timeout: 10_000,
      },
    );
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), HMR_EVENT_KEY), {
        timeout: 30_000,
      })
      .toContain('/src/main.js');
    const hmrPayload = JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), HMR_EVENT_KEY)) ?? 'null',
    ) as { type?: unknown; updates?: Array<{ path?: unknown; acceptedPath?: unknown }> };
    expect(hmrPayload).toMatchObject({
      type: 'update',
      updates: [expect.objectContaining({ path: '/src/main.js', acceptedPath: '/src/main.js' })],
    });

    await expect(previewFrame.locator('#app')).toHaveText(marker, { timeout: 30_000 });
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as typeof globalThis & { __riftyHmrSentinel?: string };
            return global.__riftyHmrSentinel;
          }),
        { timeout: 10_000 },
      )
      .toBe(await page.evaluate((key) => localStorage.getItem(`${key}:sentinel`), HMR_EVENT_KEY));
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(`${key}:beforeunload`), HMR_EVENT_KEY),
      )
      .toBeNull();
  });
});
