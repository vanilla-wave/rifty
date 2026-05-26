/**
 * M10 — HMR through the cross-realm bridge (ADR-0017 phase 1 acceptance).
 *
 * What this verifies end-to-end (when enabled):
 *   1. The playground enters Real Vite mode.
 *   2. The preview iframe loads.
 *   3. An edit to `src/main.js` propagates through `BridgedWebSocketServer` →
 *      iframe HMR client (via `BroadcastChannel`) → iframe reload signal.
 *
 * Why this spec is skipped by default at agent-runtime time:
 *   - Real Vite mode bootstraps by installing Vite from the npm registry
 *     proxy. The install takes ~20s in the playground's local dev env even
 *     on a warm machine, and is wire-bound when the proxy is cold. Running
 *     it as part of every CI invocation would dwarf the rest of the M0..M9
 *     suite. The unit test in
 *     `apps/playground/src/adapters/hmr-bridge.test.ts` already exercises
 *     the wiring contract (server accepts iframe-shaped clients, broadcasts
 *     reach them, `transformIndexHtml` injects the client script
 *     idempotently).
 *   - Set `RIFTY_E2E_HMR=1` to opt-in locally once you've warmed the
 *     install cache and want to validate the full roundtrip against a real
 *     browser. The first run still pays the install cost; subsequent runs
 *     reuse the tarball cache (ADR-0023).
 *
 * Manual verification steps (no env flag needed):
 *   1. `pnpm dev` → open `http://localhost:5273`.
 *   2. Click "Real Vite" in the header. Wait for `[real-vite] hmr bridge
 *      ready at ws://preview.local:5174/__hmr` in the terminal followed by
 *      `[real-vite] vite is listening`.
 *   3. Confirm the preview iframe shows the seeded "Hello from real Vite"
 *      message.
 *   4. Open DevTools → `Application` → `Frames` → drill into the preview
 *      iframe; in its Console run
 *         document.querySelector('script[data-rifty-hmr-bridge]') !== null
 *      and confirm it is `true`. That proves
 *      {@link createHmrBridgeVitePlugin} injected the inline HMR client.
 *   5. Edit the editor pane to change the body text. Save (Cmd/Ctrl-S in
 *      the editor or wait the implicit auto-update).
 *   6. The iframe should reload within the file-watcher poll interval; the
 *      terminal logs no errors.
 */
import { expect, test } from '@playwright/test';

const enabled = process.env.RIFTY_E2E_HMR === '1';

test.describe('M10 — HMR over cross-realm bridge (ADR-0017 phase 1)', () => {
  test.skip(!enabled, 'set RIFTY_E2E_HMR=1 to run; bootstraps a real Vite install (~20s)');

  test('preview iframe receives HMR update when src/main.js changes', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    const term = page.locator('[data-testid="terminal"]');
    await expect(term).toContainText('[worker ready]', { timeout: 10_000 });

    // Enter Real Vite mode.
    await page.locator('[data-action="real-vite"]').click();
    await expect(term).toContainText('[real-vite] hmr bridge ready', { timeout: 60_000 });
    await expect(term).toContainText('[real-vite] vite is listening', { timeout: 60_000 });

    // The preview iframe must mount and load the bridge client.
    const previewFrame = page.frameLocator('iframe').first();
    await expect(previewFrame.locator('script[data-rifty-hmr-bridge]')).toHaveCount(1, {
      timeout: 30_000,
    });

    // Snapshot the current body text so we can assert a real change.
    const initialBody = await previewFrame.locator('#app').textContent();
    expect(initialBody).toBeTruthy();

    // Edit the file; the watcher should pick it up and the bridge should
    // broadcast `{type: 'update'}` which the injected client treats as a
    // reload signal — so the iframe `#app` text changes to whatever we just
    // wrote.
    const marker = `hmr-${Date.now()}`;
    await page.evaluate((m) => {
      const editor = document.querySelector('[data-testid="editor"] textarea');
      if (!(editor instanceof HTMLTextAreaElement)) throw new Error('editor textarea missing');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(editor, `document.getElementById('app').textContent = ${JSON.stringify(m)};\n`);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, marker);

    // The iframe reloads as part of the HMR update path; wait for the new
    // body content.
    await expect(previewFrame.locator('#app')).toHaveText(marker, { timeout: 30_000 });
  });
});
