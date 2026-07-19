import { expect, test } from '@playwright/test';
import { startCdpResponseRecorder } from '../../tools/perf/src/shadow-asset-cold-cdp.mjs';

test('cold response recorder captures a real owner-class Worker fetch', async ({ page }) => {
  await page.goto('/unit-harness.html');
  const assetUrl = new URL(`/unit-harness.html?shadow-asset-cdp=${crypto.randomUUID()}`, page.url())
    .href;
  const recorder = await startCdpResponseRecorder(page, {
    captureUrl: (url: string) => url === assetUrl,
  });

  await page.evaluate(async (url) => {
    const source = `
      globalThis.onmessage = async () => {
        const response = await fetch(${JSON.stringify(url)}, { cache: 'no-store' })
        const bytes = await response.arrayBuffer()
        globalThis.postMessage(bytes.byteLength)
      }
    `;
    const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    Reflect.set(globalThis, '__riftyShadowAssetCdpWorker', { worker, workerUrl });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = () => resolve();
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(undefined);
    });
  }, assetUrl);

  try {
    const captured = await recorder.stop();
    expect(captured).toEqual([
      expect.objectContaining({
        url: assetUrl,
        status: 200,
        bodyBytes: expect.any(Number),
        complete: true,
        fromDiskCache: false,
        fromServiceWorker: false,
      }),
    ]);
    expect(captured[0]?.bodyBytes).toBeGreaterThan(0);
  } finally {
    await page.evaluate(() => {
      const state = Reflect.get(globalThis, '__riftyShadowAssetCdpWorker') as
        | { readonly worker: Worker; readonly workerUrl: string }
        | undefined;
      state?.worker.terminate();
      if (state !== undefined) URL.revokeObjectURL(state.workerUrl);
      Reflect.deleteProperty(globalThis, '__riftyShadowAssetCdpWorker');
    });
  }
});
