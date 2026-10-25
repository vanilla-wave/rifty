import { expect, test } from '@playwright/test';

const workerUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/opfs-preload-handles-worker.ts`;

for (const mode of [
  'preload',
  'unreadable',
  'unreadable-bytes',
  'concurrent',
  'native',
  'empty',
] as const) {
  test(`OPFS preload and handles: ${mode}`, async ({ page, browser }) => {
    await page.route(/\/unit-harness\.html\?preload=1$/, async (route) => {
      const response = await route.fetch();
      const headers = Object.fromEntries(
        Object.entries(response.headers()).filter(
          ([key]) => key !== 'cross-origin-opener-policy' && key !== 'cross-origin-embedder-policy',
        ),
      );
      await route.fulfill({ response, headers });
    });
    await page.goto('/unit-harness.html?preload=1');
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
    const result = await page.evaluate(
      ({ workerUrl, mode }) =>
        new Promise<{ ok: boolean; result: Record<string, unknown> }>((resolve, reject) => {
          const worker = new Worker(workerUrl, { type: 'module' });
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('preload worker timeout'));
          }, 30_000);
          worker.onmessage = (event) => {
            clearTimeout(timer);
            worker.terminate();
            resolve(event.data);
          };
          worker.onerror = (event) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(event.message));
          };
          worker.postMessage({ mode });
        }),
      { workerUrl, mode },
    );
    console.log(`[opfs-preload] Chrome/${browser.version()} ${mode} ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    const actual = result.result;
    if (mode === 'preload') {
      expect(actual.actual).toEqual(Array.from({ length: 8 }, (_, index) => `file-${index}.txt`));
      expect(actual.calls).toEqual({ root: 1, directory: 0, fileHandle: 0, getFile: 8 });
    } else if (mode === 'unreadable' || mode === 'unreadable-bytes') {
      expect(actual.boot).toMatchObject({ ok: false });
      expect(actual.preload).toMatchObject({ ok: false });
      expect(actual.read).toMatchObject({ ok: false });
      expect(actual.copy).toMatchObject({ ok: false });
      expect(actual.copied).toBe(false);
    } else if (mode === 'empty') {
      expect(actual).toEqual({ read: [], copied: [], failures: 0 });
    } else if (mode === 'concurrent') {
      expect(actual.initialCalls).toBe(1);
      expect(actual.rejected).toMatchObject({ ok: false });
      expect(actual.recovered).toMatchObject({ ok: true });
    } else {
      expect(actual).toEqual({
        before: 'file-0.txt',
        fresh: 'changed',
        current: 'recreated',
        oldView: { ok: false, error: 'NotFoundError' },
        missing: { ok: false, error: 'VfsError' },
        invalidReceiver: { ok: false, error: 'TypeError' },
        invalidArgument: { ok: false, error: 'TypeError' },
      });
    }
  });
}
