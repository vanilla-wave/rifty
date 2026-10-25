import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test('native acquisition deadline refuses preferred fallback and closes a late handle before reacquisition', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const worker = new Worker(module.default, { type: 'module' });
    const once = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error('Native guard acquisition did not report or close its late handle')),
          1000,
        );
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message));
        };
      });
    try {
      const reported = once();
      worker.postMessage({ namespace: crypto.randomUUID() });
      const refusal = await reported;
      const reacquired = once();
      worker.postMessage({ release: true });
      return { refusal, recovered: await reacquired };
    } finally {
      worker.terminate();
    }
  }, `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-guard-deadline-worker.ts?worker&url`);
  expect(result.refusal).toMatchObject({ phase: 'reported', name: 'OpfsPreloadError' });
  expect(result.recovered).toEqual({
    phase: 'reacquired',
    storage: { policy: 'required', backend: 'opfs', durability: 'durable' },
  });
});
