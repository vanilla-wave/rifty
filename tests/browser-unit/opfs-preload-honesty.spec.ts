import { type Page, expect, test } from '@playwright/test';
import type { PreloadRequest } from './fixtures/opfs-preload-honesty-worker.ts';

const workerUrl = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/opfs-preload-honesty-worker.ts`;
const source = [0, 1, 2, 127, 128, 254, 255, 13, 10];
const value = (bytes: number[]) => ({ ok: true, value: bytes });
const unavailable = (path = '/tree/z-user.bin') => ({ ok: false, error: { code: 'EIO', path } });

async function seed(page: Page) {
  await page.goto('/unit-harness.html');
  await page.evaluate(async (source) => {
    const root = await navigator.storage.getDirectory();
    const entries: [string, number[]][] = [
      ['/preload-A/tree/z-user.bin', source],
      ['/preload-A/tree/a-healthy.bin', [11, 22]],
      ['/preload-A/tree/empty.bin', []],
      ['/preload-A/existing.bin', [77, 88]],
      ['/outside-sentinel.bin', [88, 0, 255]],
      ['/preload-B/z-user.bin', [99, 128, 0]],
    ];
    for (const [path, bytes] of entries) {
      let dir = root;
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop();
      if (name === undefined) throw new Error('Expected seed file path');
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    }
  }, source);
}

function run(page: Page, request: PreloadRequest): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ workerUrl, request }) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker(workerUrl, { type: 'module' });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('Native preload Worker timed out'));
        }, 30_000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage(request);
      }),
    { workerUrl, request },
  );
}

function controls(result: Record<string, unknown>) {
  expect(result.error).toBeUndefined();
  expect(result.constructed).toBe(true);
  expect(result.initial).toMatchObject({ healthy: value([11, 22]), empty: value([]) });
  expect(result.native).toMatchObject({
    '/outside-sentinel.bin': [88, 0, 255],
    '/preload-B/z-user.bin': [99, 128, 0],
  });
}

test('genuine empty and binary content remain readable and copyable in a selected native pair', async ({
  page,
}) => {
  await seed(page);
  const result = await run(page, { fault: 'none', operation: 'copy' });
  controls(result);
  expect(result.initial).toMatchObject({ source: value(source) });
  expect(result.native).toMatchObject({
    '/preload-A/existing.bin': source,
    '/preload-A/missing.bin': source,
    '/preload-A/copy-tree/z-user.bin': source,
    '/preload-A/healthy-copy.bin': [11, 22],
    '/preload-A/empty-copy.bin': [],
  });
  expect(result.flush).toEqual({ total: 0, failures: [] });
});

for (const fault of ['getFile', 'arrayBuffer'] as const) {
  test(`${fault}: rejected explicit preload leaves cold source unavailable to read/copy/cp and preserves native bytes`, async ({
    page,
  }) => {
    await seed(page);
    const result = await run(page, { fault, operation: 'copy' });
    console.log('[preload-honesty]', JSON.stringify({ fault, result }));
    controls(result);
    expect(result.preload).toMatchObject({ ok: false, error: { name: 'OpfsPreloadError' } });
    expect(result.sourceSize).toBe(source.length);
    expect(result.denials).toBe(1);
    expect.soft(result.initial).toMatchObject({ source: unavailable() });
    for (const operation of ['copyExisting', 'copyMissing', 'cp'])
      expect.soft(result[operation]).toMatchObject(unavailable());
    expect(result.directoryTarget).toMatchObject({
      ok: false,
      error: { code: 'EISDIR', path: '/tree' },
    });
    expect(result.absentParent).toMatchObject({
      ok: false,
      error: { code: 'ENOENT', path: '/absent/file.bin' },
    });
    expect.soft(result.native).toMatchObject({
      '/preload-A/tree/z-user.bin': source,
      '/preload-A/existing.bin': [77, 88],
      '/preload-A/missing.bin': null,
      '/preload-A/copy-tree/a-healthy.bin': [11, 22],
      '/preload-A/copy-tree/empty.bin': [],
      '/preload-A/copy-tree/z-user.bin': null,
      '/preload-A/healthy-copy.bin': [11, 22],
      '/preload-A/empty-copy.bin': [],
    });
    // Flush reports persistence failures, not whether source content was acquired.
    expect(result.flush).toEqual({ total: 0, failures: [] });
    const fresh = await run(page, { fault: 'none', operation: 'retry' });
    controls(fresh);
    expect(fresh.initial).toMatchObject({ source: value(source) });
    expect(fresh.native).toMatchObject({
      '/preload-A/tree/z-user.bin': source,
      '/preload-A/retry-copy.bin': source,
    });
  });

  test(`${fault}: successful explicit preload retry restores the original nine bytes`, async ({
    page,
  }) => {
    await seed(page);
    const result = await run(page, { fault, operation: 'retry' });
    controls(result);
    expect(result.preload).toMatchObject({ ok: false, error: { name: 'OpfsPreloadError' } });
    expect.soft(result.initial).toMatchObject({ source: unavailable() });
    expect(result.afterRetry).toEqual(value(source));
    expect(result.native).toMatchObject({
      '/preload-A/tree/z-user.bin': source,
      '/preload-A/retry-copy.bin': source,
      '/preload-A/existing.bin': [77, 88],
    });
    expect(result.flush).toEqual({ total: 0, failures: [] });
  });
}

test('uncached rename persists actual native bytes before removal while moved synchronous content remains unavailable', async ({
  page,
}) => {
  await seed(page);
  const result = await run(page, { fault: 'getFile', operation: 'rename' });
  console.log('[preload-honesty-rename]', JSON.stringify(result));
  controls(result);
  expect(result.preload).toMatchObject({ ok: false, error: { name: 'OpfsPreloadError' } });
  expect(result.rename).toEqual({ ok: true, value: null });
  expect.soft(result.movedBeforeFlush).toMatchObject(unavailable('/moved-tree/z-user.bin'));
  expect.soft(result.movedAfterFlush).toMatchObject(unavailable('/moved-tree/z-user.bin'));
  expect.soft(result.copyAfterRename).toMatchObject(unavailable('/moved-tree/z-user.bin'));
  expect.soft(result.native).toMatchObject({
    '/preload-A/tree/z-user.bin': null,
    '/preload-A/moved-tree/z-user.bin': source,
    '/preload-A/existing.bin': [77, 88],
  });
  expect(result.flush).toEqual({ total: 0, failures: [] });
  expect(result.copyFlush).toEqual({ total: 0, failures: [] });
});

test('native read refusal during uncached rename keeps original bytes and reports failed persistence', async ({
  page,
}) => {
  await seed(page);
  const result = await run(page, { fault: 'getFile', operation: 'rename-denied' });
  console.log('[preload-honesty-rename-denied]', JSON.stringify(result));
  controls(result);
  expect(result.preload).toMatchObject({ ok: false, error: { name: 'OpfsPreloadError' } });
  expect(result.rename).toEqual({ ok: true, value: null });
  expect(result.native).toMatchObject({
    '/preload-A/tree/z-user.bin': source,
    '/preload-A/moved-tree/z-user.bin': null,
    '/preload-A/existing.bin': [77, 88],
  });
  expect(result.flush).toMatchObject({ total: expect.any(Number) });
  const flush = result.flush as { total: number };
  expect(flush.total).toBeGreaterThan(0);
  const fresh = await run(page, { fault: 'none', operation: 'retry' });
  controls(fresh);
  expect(fresh.initial).toMatchObject({ source: value(source) });
});
