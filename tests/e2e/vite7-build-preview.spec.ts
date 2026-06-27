import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

async function fetchPreview(page: Page): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}> {
  return page.evaluate(async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4_000);
    try {
      const r = await fetch('/preview/4173/', { cache: 'no-store', signal: ac.signal });
      return {
        ok: r.ok,
        status: r.status,
        contentType: r.headers.get('content-type') ?? '',
        body: await r.text(),
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        contentType: '',
        body: String((err as Error).message ?? err),
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

test.describe('Vite 7 production build/preview', () => {
  test('`vite build` writes a hashed prod dist and `vite preview` serves it', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(240_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectTerminalContains(page, '[vite] dev server ready on port 5174', 90_000);

    await openShellTerminal(page);
    await runTerminalLineSettled(page, 'vite build', 120_000);

    await runTerminalLine(page, 'cat dist/index.html');
    await expectTerminalContains(page, /assets\/index-[^"]+\.js/, 20_000);
    const afterBuild = await terminalBuffer(page);
    expect(afterBuild).not.toContain('/src/main.js');

    await runTerminalLine(page, 'vite preview');
    await expectTerminalContains(page, '[vite] preview ready on port 4173', 90_000);

    await expect
      .poll(async () => fetchPreview(page), {
        timeout: 90_000,
        intervals: [1_000, 2_000, 4_000],
      })
      .toMatchObject({ ok: true, status: 200 });
    const html = await fetchPreview(page);
    expect(html.contentType).toContain('text/html');
    expect(html.body).toMatch(/assets\/index-[^"]+\.js/);
    expect(html.body).not.toContain('/src/main.js');

    const frame = page.frameLocator('iframe[title="Preview port 4173"]');
    await expect(frame.locator('.workspace-shell h1')).toHaveText('Workspace anatomy', {
      timeout: 60_000,
    });
    await expect(frame.locator('.file-list li').first()).toBeVisible();
    expect(pageErrors.join('\n')).not.toMatch(/Unexpected token|SyntaxError/);
  });
});
