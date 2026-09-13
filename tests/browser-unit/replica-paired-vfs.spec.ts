import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test('paired replica Vfs awaits its own native result through failure, repair and timeout', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const worker = new Worker(module.default, { type: 'module' });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.error ? reject(new Error(data.error)) : resolve(data.result);
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({});
      });
    } finally {
      worker.terminate();
    }
  }, `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-paired-vfs-worker.ts?worker&url`);
  expect(result).toEqual({
    streamed: [255, 128],
    mtime: 34000,
    failed: expect.stringContaining('paired-write-quota'),
    dirty: 1,
    absentNative: true,
    liveFailed: true,
    timeoutTotal: 1,
    settledAtReport: false,
    clean: 0,
    entries: ['a', 'failed'],
    repaired: 'repaired-write',
    late: 'late-write',
  });
});
