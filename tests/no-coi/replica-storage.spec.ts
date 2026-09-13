import { expect, test } from '@playwright/test';

const moduleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-persistence-worker.ts?worker&url`;

test('configured no-COI runtime uses the owner replica format and the same OpfsFsSync', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const worker = new Worker(module.default, { type: 'module' });
    try {
      return await new Promise<{
        backend: string;
        segmented: boolean;
        isolated: boolean;
        text: string;
      }>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.ok ? resolve(data.result) : reject(new Error(data.error));
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ kind: 'configured', namespace: crypto.randomUUID() });
      });
    } finally {
      worker.terminate();
    }
  }, moduleUrl);
  expect(result).toEqual({ backend: 'opfs', segmented: true, isolated: false, text: 'old-a' });
});
