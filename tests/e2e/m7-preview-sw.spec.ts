/**
 * M7 — HTTP request rounds through the Service Worker preview path.
 *
 * The playground now starts a real Vite terminal on load. This spec probes the
 * same-origin `/preview/<port>/` URL through the Service Worker and waits for
 * the worker-owned Vite route to become reachable. ADR-0161 disables HMR in
 * the Vite 8 template, so this is a serve/preview smoke, not HMR coverage.
 */
import { expect, test } from '@playwright/test';
import { expectTerminalContains } from './helpers/playground.ts';

test.describe('M7 — HTTP through the Service Worker preview bridge', () => {
  test('GET /preview/5174/ returns worker-owned Vite HTML round-tripped through the SW', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectTerminalContains(page, 'starting dev server on port', 30_000);

    await page.click('[data-action="view-templates"]');
    await page.click('[data-preset="real-vite"]');
    await expect(page.locator('[data-action="view-templates"]')).toContainText('real-vite', {
      timeout: 5_000,
    });
    await expectTerminalContains(page, 'npm: + vite@8.0.16', 120_000);
    await expectTerminalContains(page, '[vite] dev server ready on port 5174', 60_000);

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
    expect(probe.body).not.toContain('data-rifty-hmr-bridge');
  });

  // Regression: the test above proves the dev server SERVES the shell HTML, but a
  // black-screen preview (the entry module fails to transform/execute) serves the
  // exact same shell and would pass it. This test drives the real preview iframe and
  // asserts the module graph actually RENDERED — Vite/Rolldown transformed main.js +
  // its JS+JSON imports and the app wrote DOM. Guards the project-files black screen
  // (a `?t=`-busted JSON import served raw → "Unexpected token ':'" → empty #app).
  test('default project-files preview iframe RENDERS the JS+JSON module graph', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    // The default preset (project-files) boots a Vite dev server on load.
    await expectTerminalContains(page, '[vite] dev server ready on port 5174', 60_000);

    const frame = page.frameLocator('iframe[title="Preview port 5174"]');
    // `<h1>Workspace anatomy</h1>` is produced by main.js after it imports the
    // transformed JSON (`project.json`) + the JS summary module — proof the graph ran.
    await expect(frame.locator('.workspace-shell h1')).toHaveText('Workspace anatomy', {
      timeout: 60_000,
    });
    await expect(frame.locator('.file-list li').first()).toBeVisible();

    // A raw-JSON-as-ESM regression surfaces as a SyntaxError inside the iframe.
    expect(pageErrors.join('\n')).not.toMatch(/Unexpected token|SyntaxError/);
  });
});
