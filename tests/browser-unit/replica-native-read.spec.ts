import { type Page, expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

async function probe(page: Page, kind: string, mode = 'replica'): Promise<Record<string, unknown>> {
  await gotoHarness(page);
  return page.evaluate(
    async ({ url, kind, mode }) => {
      const module = await import(/* @vite-ignore */ url);
      const worker = new Worker(module.default, { type: 'module' });
      try {
        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(new Error(data.error)) : resolve(data.result);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({ kind, mode });
        });
      } finally {
        worker.terminate();
      }
    },
    {
      url: `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-native-read-worker.ts?worker&url`,
      kind,
      mode,
    },
  );
}

for (const mode of ['files', 'replica']) {
  test(`${mode}: stable native read/stat/readdir survive concurrent writes`, async ({ page }) => {
    const result = await probe(page, 'concurrent', mode);
    expect(result.reads).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });
  test(`${mode}: native backend controls preserve their declared support`, async ({ page }) => {
    expect(await probe(page, 'controls', mode)).toEqual({
      errors:
        mode === 'files'
          ? []
          : ['preloadContent', 'refreshIndex', 'openSync'].map((method) => ({
              method,
              name: 'NotImplementedError',
              feature: `OpfsFsSync.${method}.replica`,
            })),
      created: false,
      content: 'stable',
    });
  });
}
for (const kind of ['read', 'stat', 'dir', 'content']) {
  test(`compaction retains a native ${kind} until its admitted I/O settles`, async ({ page }) => {
    const result = await probe(page, kind);
    expect(result.read).toMatchObject({ ok: true });
    expect(result.reclaimedEarly).toBe(false);
    expect(result.reported).toBeGreaterThan(0);
    expect(result.clean).toBe(0);
    expect(result.oldRemoved).toBe(true);
  });
}

test('closeAll retains native ownership until an already-admitted read settles', async ({
  page,
}) => {
  const result = await probe(page, 'close');
  expect(result.acquiredBeforeRead).toBe(false);
  expect(result.read).toMatchObject({ ok: true, value: 'stable' });
  expect(result.reacquired).toBe(true);
});
