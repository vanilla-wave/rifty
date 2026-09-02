/**
 * React + Vite template production build/preview (backlog:
 * playground/react-vite-starter): `npm run build` of the "Real npm project"
 * tile exits 0 inside the browser runtime — the registry esbuild runtime
 * bundles the user `vite.config.ts` (`@vitejs/plugin-react`), rollup-wasm
 * builds, esbuild minifies — and `npm run preview` serves the built dist
 * through the routed preview. Split from react-vite-preset.spec.ts so the
 * dev-boot spec stays inside its wall-clock budget; both run in the
 * chromium-heavy lane.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 5174;
const PREVIEW_PORT = 4173;

async function fetchPreview(
  page: Page,
  port: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: string }> {
  return page.evaluate(async (targetPort) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4_000);
    try {
      const r = await fetch(`/preview/${targetPort}/`, { cache: 'no-store', signal: ac.signal });
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (err) {
      return { ok: false, status: 0, body: String((err as Error).message ?? err) };
    } finally {
      clearTimeout(timer);
    }
  }, port);
}

test.describe('React + Vite template production build', () => {
  test('`npm run build` exits 0, writes a hashed dist, `npm run preview` serves it', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
    await pickStarter(page, 'real-vite');
    await expectViteDevServerReady(page, PORT, 180_000);

    await openShellTerminal(page);
    // `&& echo` pins the REAL exit code — the marker only prints on exit 0.
    await runTerminalLineSettled(page, 'npm run build && echo RIFTY_REACT_BUILD_OK', 240_000);
    await expectTerminalContains(page, 'RIFTY_REACT_BUILD_OK', 20_000);
    expect(await terminalBuffer(page)).not.toContain('NotImplementedError');

    await runTerminalLine(page, 'cat dist/index.html');
    await expectTerminalContains(page, /assets\/index-[^"]+\.js/u, 20_000);

    await runTerminalLine(page, 'npm run preview');
    await expect
      .poll(async () => fetchPreview(page, PREVIEW_PORT), {
        timeout: 90_000,
        intervals: [1_000, 2_000, 4_000],
      })
      .toMatchObject({ ok: true, status: 200 });
    const html = await fetchPreview(page, PREVIEW_PORT);
    expect(html.body).toMatch(/assets\/index-[^"]+\.js/u);
    expect(html.body).not.toContain('/src/main.tsx');
  });
});
