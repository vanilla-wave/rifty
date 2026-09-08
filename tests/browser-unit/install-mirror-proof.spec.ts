import { expect, test } from '@playwright/test';

test('install dedup proves durable bytes across empty, aliased, dirty and pending mirrors', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');
  const result = await page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        worker.onmessage = (event) => {
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage({});
      }),
    `/@fs${process.cwd()}/tests/browser-unit/fixtures/install-mirror-proof-worker.ts`,
  );
  expect(result).toEqual({
    result: {
      cleanWrites: 0,
      genericWrites: 1,
      emptyWrites: 1,
      alias: 'edit',
      failed: 1,
      healed: 0,
      dirtyBytes: 'heal',
      pending: 'heal',
      duringRead: 'heal',
      directoryFailed: 1,
      directoryHealed: 0,
    },
  });
});
