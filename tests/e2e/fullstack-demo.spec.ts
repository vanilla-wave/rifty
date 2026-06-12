/**
 * Fullstack demo — the Express + SQLite node-server template end-to-end in a
 * real cross-origin-isolated browser (see the node-server template ADR).
 *
 * Covers the full chain the demo exists to prove: preset selection boots the
 * worker (live express install + sql.js WASM engine), the SW routes
 * `/preview/3210/*` to the worker's Express app, the static client renders in
 * the preview iframe, and a POST from the page round-trips into SQLite.
 *
 * Like m7-preview-sw, installs from the live registry through the dev proxy —
 * generous polls, network required.
 */
import { expect, test } from '@playwright/test';
import { expectTerminalContains } from './helpers/playground.ts';

const PORT = 3210;

test.describe('Fullstack demo — Express + node:sqlite through the SW preview bridge', () => {
  test('preset boots the server; API and client both round-trip', async ({ page }) => {
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[console.error]', msg.text());
    });
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    // Let the app settle (terminal wired, initial boot command issued) before
    // interacting — clicks during the mount storm can land on replaced nodes.
    await expectTerminalContains(page, 'vite: starting dev server', 15_000);

    // Select the demo preset from the gallery and confirm it actually took.
    await page.click('[data-action="view-templates"]');
    await page.click('[data-preset="express-sqlite"]');
    await expect(page.locator('[data-preset="express-sqlite"]')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 5_000 },
    );
    // The node-server boot line surfaces in the dev-server terminal.
    await expectTerminalContains(page, 'dev: starting Express + SQLite server', 30_000);

    // Express + engine boot behind a live npm install — poll the API route.
    // The predicate demands PARSEABLE JSON: a transient 200 from a non-SW
    // fallback (host SPA HTML) must keep the poll going, not end it.
    const fetchTodos = async () =>
      page.evaluate(async (port: number) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch(`/preview/${port}/api/todos`, {
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
          const probe = await fetchTodos();
          return probe.ok && probe.status === 200 && probe.count >= 3;
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
      )
      .toBe(true);

    const seeded = JSON.parse((await fetchTodos()).body) as { id: number; title: string }[];
    expect(seeded.length).toBeGreaterThanOrEqual(3);

    // Static client served by express.static through the same SW route.
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

    // POST through the SW lands in SQLite (WASM) and reads back.
    const created = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/api/todos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'added from the e2e test' }),
      });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toMatchObject({ title: 'added from the e2e test', done: 0 });

    // The preview iframe rendered the client with the seeded rows.
    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('.row').first()).toBeVisible({ timeout: 60_000 });

    // Add a todo through the IFRAME UI: browser client -> SW -> worker ->
    // express -> sqlite.wasm -> back into the DOM. The client re-fetches the
    // list after the POST, so the API-added row surfaces too.
    await frame.locator('#add-input').fill('typed inside the preview');
    await frame.locator('.add__btn').click();
    await expect(frame.locator('.row__title', { hasText: 'typed inside the preview' })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect(frame.locator('.row__title', { hasText: 'added from the e2e test' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
