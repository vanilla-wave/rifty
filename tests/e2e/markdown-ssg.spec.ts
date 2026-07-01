/**
 * Markdown SSG template — fs-heavy build + static preview server.
 *
 * Covers read/write/walk of project files before a node:http server starts,
 * then verifies the generated output is what the SW preview bridge serves.
 */
import { expect, test } from '@playwright/test';
import { capturePageProblems, expectTerminalContains, selectPreset } from './helpers/playground.ts';

const PORT = 3333;

test.describe('Markdown SSG template through the SW preview bridge', () => {
  test('preset builds markdown to dist and serves generated HTML', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = capturePageProblems(page);
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectTerminalContains(page, '[vite] dev server ready on port 5174', 15_000);

    await selectPreset(page, 'markdown-ssg');

    await expectTerminalContains(
      page,
      '[real-vite/worker] starting server /scratch/src/main.js on port 3333',
      150_000,
    );
    await expectTerminalContains(page, 'npm: + marked@', 120_000);
    await expectTerminalContains(page, '[ssg] built intro.html from content/intro.md', 60_000);
    await expectTerminalContains(page, 'markdown ssg listening on port 3333', 60_000);

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
    expect(home.body).toContain('Project docs');
    expect(home.body).toContain('intro.html');

    const intro = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/intro.html`, { cache: 'no-store' });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(intro.status).toBe(200);
    expect(intro.body).toContain('Build inside the browser');
    expect(intro.body).toContain('dist/*.html');

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.getByRole('heading', { name: 'Project docs' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(frame.getByRole('link', { name: 'Build inside the browser' })).toBeVisible();

    await expectTerminalContains(page, '[ssg] GET /intro.html -> dist/intro.html', 10_000);
    problems.assertNoViteImportErrors();
  });
});
