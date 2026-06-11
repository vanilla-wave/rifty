/**
 * M7 — HTTP request rounds through the Service Worker preview path.
 *
 * The playground now starts a real Vite terminal on load. This spec probes the
 * same-origin `/preview/<port>/` URL through the Service Worker and waits for
 * the worker-owned Vite route to become reachable.
 */
import { expect, test } from '@playwright/test';

test.describe('M7 — HTTP through the Service Worker preview bridge', () => {
  test('GET /preview/5174/ returns worker-owned Vite HTML round-tripped through the SW', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    const fetchPreview = async () =>
      page.evaluate(async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch('/preview/5174/', {
            cache: 'no-store',
            signal: ac.signal,
          });
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

    await expect
      .poll(fetchPreview, { timeout: 90_000, intervals: [500, 1_000, 2_000] })
      .toMatchObject({ ok: true, status: 200 });
    const probe = await fetchPreview();

    expect(probe.contentType).toContain('text/html');
    expect(probe.body).toContain('rifty + real Vite (worker)');
    expect(probe.body).toContain('src/main.js');
    expect(probe.body).toContain('data-rifty-hmr-bridge');
  });
});
