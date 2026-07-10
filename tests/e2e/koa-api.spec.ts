/**
 * Koa API template — node-server runtime consumer for ctx cookies, router
 * params, JSON body parsing, and iframe preview traffic.
 */
import { expect, test } from '@playwright/test';
import {
  capturePageProblems,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLineSettled,
  selectPreset,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 3332;

test.describe('Koa API template through the SW preview bridge', () => {
  test('preset boots Koa; cookies, JSON POST, router params, and client round-trip', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = capturePageProblems(page);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    await selectPreset(page, 'koa-api');

    await expectTerminalContains(
      page,
      '[real-vite/worker] starting nodemon for /scratch/src/main.js on port 3332',
      150_000,
    );
    await expectTerminalContains(page, 'npm: + koa@', 120_000);
    await expectTerminalContains(page, 'npm: + @koa/router@', 120_000);

    const fetchState = async () =>
      page.evaluate(async (port: number) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch(`/preview/${port}/api/state`, {
            cache: 'no-store',
            signal: ac.signal,
          });
          const body = await r.text();
          let parsed: { visits?: number; cookieHeader?: string; notes?: unknown[] } | null = null;
          try {
            parsed = JSON.parse(body) as {
              visits?: number;
              cookieHeader?: string;
              notes?: unknown[];
            };
          } catch {
            parsed = null;
          }
          return {
            ok: r.ok,
            status: r.status,
            visits: parsed?.visits ?? -1,
            cookieHeader: parsed?.cookieHeader ?? '',
            notes: Array.isArray(parsed?.notes) ? parsed.notes.length : -1,
            body,
          };
        } catch (err) {
          return {
            ok: false,
            status: 0,
            visits: -1,
            cookieHeader: '',
            notes: -1,
            body: String(err),
          };
        } finally {
          clearTimeout(timer);
        }
      }, PORT);

    await expect
      .poll(
        async () => {
          const probe = await fetchState();
          if (
            probe.ok &&
            probe.status === 200 &&
            probe.visits >= 1 &&
            probe.cookieHeader.includes('koa-visits=') &&
            probe.notes >= 2
          ) {
            return 'ready';
          }
          return JSON.stringify({
            ok: probe.ok,
            status: probe.status,
            visits: probe.visits,
            cookieHeader: probe.cookieHeader,
            notes: probe.notes,
            body: probe.body.slice(0, 200),
          });
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
      )
      .toBe('ready');

    await expectTerminalContains(page, 'koa api listening on port 3332', 10_000);
    await expectTerminalContains(page, '[koa] GET /api/state', 10_000);

    const routed = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/api/notes/1`, { cache: 'no-store' });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(routed.status).toBe(200);
    expect(JSON.parse(routed.body)).toMatchObject({ id: 1, topic: 'cookies' });

    const created = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/api/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'e2e', text: 'created through koa body parsing' }),
      });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toMatchObject({
      topic: 'e2e',
      text: 'created through koa body parsing',
    });

    const afterPost = await fetchState();
    expect(afterPost.cookieHeader).toContain('koa-visits=');
    expect(afterPost.notes).toBeGreaterThanOrEqual(3);

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('li').first()).toBeVisible({ timeout: 60_000 });
    await expect(frame.locator('#visits')).toContainText('visits:', { timeout: 15_000 });

    await frame.locator('#topic').fill('iframe');
    await frame.locator('#text').fill('typed through koa preview');
    await frame.locator('button[type="submit"]').click();
    await expect(frame.locator('li', { hasText: 'typed through koa preview' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(frame.locator('li', { hasText: 'created through koa body parsing' })).toBeVisible({
      timeout: 15_000,
    });

    await expectTerminalContains(page, '[koa] INSERT note #', 10_000);

    const restartMarker = `koa-nodemon-${Date.now()}`;
    await openShellTerminal(page);
    await runTerminalLineSettled(
      page,
      `echo "console.log('${restartMarker}')" >> /scratch/src/main.js`,
    );
    await expect
      .poll(() => terminalBuffer(page, 0), { timeout: 45_000 })
      .toContain('[nodemon] restarting due to changes');
    await expect.poll(() => terminalBuffer(page, 0), { timeout: 45_000 }).toContain(restartMarker);
    await expect
      .poll(async () => (await fetchState()).notes, {
        timeout: 45_000,
        intervals: [250, 500, 1_000],
      })
      .toBe(2);
    expect(await terminalBuffer(page, 0)).not.toContain('EADDRINUSE');
    problems.assertNoViteImportErrors();
  });
});
