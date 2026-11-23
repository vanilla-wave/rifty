import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

test('[fault: false-fallback] traced HTTP denial of a Service Worker leaves Chromium alive', async ({
  browser,
}) => {
  const server = createServer((request, response) => {
    if (request.url === '/page') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Service Worker denial</title>');
    } else {
      response.writeHead(403, { 'Content-Type': 'text/javascript' });
      response.end('Forbidden');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    // Fresh targets expose the stopped-SW/trace-body race (crbug 573662744).
    for (let attempt = 0; attempt < 500; attempt++) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${address.port}/page`);
        const failures = await page.evaluate(async () =>
          Promise.all(
            (['classic', 'module'] as const).map(async (type) => {
              try {
                await navigator.serviceWorker.register('/denied.js', {
                  scope: `/probe-${crypto.randomUUID()}/${type}/`,
                  type,
                  updateViaCache: 'none',
                });
                return 'registered';
              } catch (error) {
                if (!(error instanceof TypeError) || !error.message.includes('403')) throw error;
                return 'HTTP 403';
              }
            }),
          ),
        );
        expect(failures).toEqual(['HTTP 403', 'HTTP 403']);
        expect(await page.evaluate(() => document.title)).toBe('Service Worker denial');
      } finally {
        await context.close();
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
