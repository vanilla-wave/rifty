/**
 * Hono API template — node-server runtime consumer for middleware-style ctx
 * handlers and JSON body parsing through the SW preview bridge.
 */
import { expect, test } from '@playwright/test';
import { capturePageProblems, expectTerminalContains, selectPreset } from './helpers/playground.ts';

const PORT = 3321;

test.describe('Hono API template through the SW preview bridge', () => {
  test('preset boots Hono; API and client both round-trip', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = capturePageProblems(page);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    await selectPreset(page, 'hono-api');

    await expectTerminalContains(
      page,
      '[real-vite/worker] starting server /scratch/src/main.js on port 3321',
      150_000,
    );
    await expectTerminalContains(page, 'npm: + hono@', 120_000);
    await expectTerminalContains(page, 'npm: + @hono/node-server@', 120_000);

    const fetchMessages = async () =>
      page.evaluate(async (port: number) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch(`/preview/${port}/api/messages`, {
            cache: 'no-store',
            signal: ac.signal,
          });
          const body = await r.text();
          let rows: unknown;
          try {
            rows = JSON.parse(body);
          } catch {
            rows = null;
          }
          const count = Array.isArray(rows) ? rows.length : -1;
          return { ok: r.ok, status: r.status, count, body };
        } catch (err) {
          return { ok: false, status: 0, count: -1, body: String((err as Error).message ?? err) };
        } finally {
          clearTimeout(timer);
        }
      }, PORT);

    await expect
      .poll(
        async () => {
          const probe = await fetchMessages();
          if (probe.ok && probe.status === 200 && probe.count >= 2) return 'ready';
          return JSON.stringify({
            ok: probe.ok,
            status: probe.status,
            count: probe.count,
            body: probe.body.slice(0, 200),
          });
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
      )
      .toBe('ready');

    await expectTerminalContains(page, 'hono api listening on port 3321', 10_000);
    await expectTerminalContains(page, '[hono] GET /api/messages', 10_000);

    const home = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/`, { cache: 'no-store' });
      return {
        status: r.status,
        contentType: r.headers.get('content-type') ?? '',
        body: await r.text(),
      };
    }, PORT);
    expect(home.status).toBe(200);
    expect(home.contentType).toContain('text/html');
    expect(home.body).toContain('client.js');

    const created = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/api/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: 'e2e', text: 'added from the e2e test' }),
      });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toMatchObject({
      author: 'e2e',
      text: 'added from the e2e test',
    });

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('li').first()).toBeVisible({ timeout: 60_000 });

    await frame.locator('#author').fill('iframe');
    await frame.locator('#text').fill('typed inside the preview');
    await frame.locator('button[type="submit"]').click();
    await expect(frame.locator('li', { hasText: 'typed inside the preview' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(frame.locator('li', { hasText: 'added from the e2e test' })).toBeVisible({
      timeout: 15_000,
    });

    await expectTerminalContains(page, '[hono] INSERT message #', 10_000);
    problems.assertNoViteImportErrors();
  });
});
