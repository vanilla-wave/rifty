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
  terminalHistoryExitCode,
} from './helpers/playground.ts';

const PORT = 5174;
const PREVIEW_PORT = 4173;
const BUILD_LINE = 'npm run build';
const ASSET_LISTING_LINE =
  "node -e \"for (const f of require('node:fs').readdirSync('dist/assets')) console.log('ASSET '+f)\"";

async function fetchPreviewPath(
  page: Page,
  port: number,
  path: string,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: string }> {
  return page.evaluate(
    async ({ targetPort, targetPath }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4_000);
      try {
        const r = await fetch(`/preview/${targetPort}${targetPath}`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        return { ok: r.ok, status: r.status, body: await r.text() };
      } catch (err) {
        return { ok: false, status: 0, body: String((err as Error).message ?? err) };
      } finally {
        clearTimeout(timer);
      }
    },
    { targetPort: port, targetPath: path },
  );
}

async function fetchPreview(
  page: Page,
  port: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: string }> {
  return fetchPreviewPath(page, port, '/');
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
    // The exit code comes from the terminal's own history record, not from an
    // echoed marker: an `&& echo MARKER` line puts MARKER in the buffer as part
    // of the command echo, so it passes even when the build fails.
    await runTerminalLineSettled(page, BUILD_LINE, 240_000);
    expect(await terminalHistoryExitCode(page, BUILD_LINE)).toBe(0);
    expect(await terminalBuffer(page)).not.toContain('NotImplementedError');

    // Same file set as a local `vite build`: hashed JS + hashed CSS, no source
    // entry reference left in the emitted HTML.
    await runTerminalLine(page, 'cat dist/index.html');
    await expectTerminalContains(page, /assets\/index-[^"]+\.js/u, 20_000);
    await expectTerminalContains(page, /assets\/index-[^"]+\.css/u, 20_000);
    expect(await terminalBuffer(page)).not.toContain('/src/main.tsx');
    // The referenced files really exist on disk (rollup-wasm wrote them), not
    // only their names in the HTML.
    // Printed as `ASSET <name>` lines from a real readdir: the echoed command
    // carries the expression, never a concatenated result, and Vite's own
    // build report / the cat above never print this prefix.
    // Polled, not read once after "settled": the idle-prompt fallback in
    // runTerminalLineSettled can return before a command's output lands under
    // in-suite contention (traps.md), so wait for the lines themselves.
    await runTerminalLine(page, ASSET_LISTING_LINE);
    await expectTerminalContains(page, /^ASSET index-[\w-]+\.js$/mu, 30_000);
    await expectTerminalContains(page, /^ASSET index-[\w-]+\.css$/mu, 30_000);

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
    // `vite preview` serves the hashed bundle + stylesheet the HTML references —
    // the built app, not just its shell.
    const jsPath = /(\/assets\/index-[^"]+\.js)/u.exec(html.body)?.[1];
    const cssPath = /(\/assets\/index-[^"]+\.css)/u.exec(html.body)?.[1];
    if (!jsPath || !cssPath) throw new Error('built index.html references no hashed js/css');
    const js = await fetchPreviewPath(page, PREVIEW_PORT, jsPath);
    expect(js).toMatchObject({ ok: true, status: 200 });
    expect(js.body).toContain('Trackline');
    const css = await fetchPreviewPath(page, PREVIEW_PORT, cssPath);
    expect(css).toMatchObject({ ok: true, status: 200 });
    expect(css.body).toContain('.brand');
  });
});
