import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  const source = req.url.startsWith('/worker')
    ? "const early = { name: self.name, href: self.location.href }; void import('./late.js').then(({late}) => self.postMessage({ early, late }));"
    : req.url.startsWith('/late')
      ? 'export const late = { name: self.name, href: self.location.href };'
      : '<!doctype html>';
  res.setHeader(
    'Content-Type',
    req.url.startsWith('/worker') || req.url.startsWith('/late') ? 'text/javascript' : 'text/html',
  );
  res.end(source);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const results = await page.evaluate(async (base) => {
    const blobUrl = URL.createObjectURL(
      new Blob(
        [
          `const early = { name: self.name, href: self.location.href }; void import(${JSON.stringify(`${base}/late.js`)}).then(({late}) => self.postMessage({ early, late }));`,
        ],
        { type: 'text/javascript' },
      ),
    );
    const rows = [];
    try {
      for (const [kind, url] of [
        ['http', `${base}/worker.js?existing=1#preserved`],
        ['blob', blobUrl],
      ]) {
        for (const name of [
          undefined,
          'custom-worker-label',
          'rifty-vm-engine=quickjs',
          'rifty-vm-engine=rewrite',
        ]) {
          rows.push(
            await new Promise((resolve) => {
              const worker = new Worker(url, {
                type: 'module',
                ...(name === undefined ? {} : { name }),
              });
              const timer = setTimeout(() => {
                worker.terminate();
                resolve({ kind, name: name ?? null, timeout: true });
              }, 2500);
              worker.onmessage = (event) => {
                clearTimeout(timer);
                worker.terminate();
                resolve({ kind, name: name ?? null, ...event.data });
              };
              worker.onerror = (event) => {
                clearTimeout(timer);
                event.preventDefault();
                worker.terminate();
                resolve({ kind, name: name ?? null, error: event.message ?? 'error' });
              };
            }),
          );
        }
      }
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    return rows;
  }, base);
  console.log(
    JSON.stringify({ node: process.version, chromium: browser.version(), results, requests }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
