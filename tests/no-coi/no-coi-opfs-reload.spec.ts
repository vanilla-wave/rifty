import { type Browser, type Page, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-no-coi-policy-worker.ts`;
const exactBytes = [0, 1, 2, 127, 128, 254, 255, 13, 10];

interface WorkerRequest {
  readonly mode: 'selected';
  readonly operation: 'write' | 'read';
  readonly path: string;
  readonly bytes: number[];
}

async function assertNoCoiNavigation(page: Page, navigate: 'goto' | 'reload'): Promise<void> {
  const response =
    navigate === 'goto' ? await page.goto('/unit-harness.html?no-coi-opfs=1') : await page.reload();
  expect(response).not.toBeNull();
  if (response === null) throw new Error('no-COI harness navigation returned no response');
  const headers = await response.allHeaders();
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  expect(
    await page.evaluate(() => ({
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sharedArrayBufferType: typeof globalThis.SharedArrayBuffer,
    })),
  ).toEqual({ crossOriginIsolated: false, sharedArrayBufferType: 'undefined' });
}

async function runWorker(page: Page, request: WorkerRequest): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ url, request }) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('OPFS policy worker timeout'));
        }, 20_000);
        worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage(request);
      }),
    { url: workerUrl, request },
  );
}

function logArtifact(browser: Browser, result: unknown): void {
  console.log(
    `[opfs-no-coi] selected-no-coi-reload Chrome/${browser.version()} ${JSON.stringify(result)}`,
  );
}

test('no-COI capable dedicated Worker selects OPFS and survives exact-byte reload', async ({
  page,
  browser,
}) => {
  await assertNoCoiNavigation(page, 'goto');
  const path = `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`;
  const write = await runWorker(page, {
    mode: 'selected',
    operation: 'write',
    path,
    bytes: exactBytes,
  });
  await assertNoCoiNavigation(page, 'reload');
  const read = await runWorker(page, {
    mode: 'selected',
    operation: 'read',
    path,
    bytes: exactBytes,
  });
  logArtifact(browser, { write, read });

  expect(write).toEqual({
    ok: true,
    workerId: expect.any(String),
    backend: 'opfs',
    facts: {
      crossOriginIsolated: false,
      sharedArrayBufferType: 'undefined',
      opfsSyncSupported: true,
      opfsAsyncSupported: true,
      detected: 'opfs',
    },
    initChoice: 'opfs',
    flushResult: { total: 0, failures: [] },
    syncHandlesClosed: true,
    publicAsyncBackend: 'opfs',
    crossSurfaceActual: exactBytes,
  });
  expect(read).toEqual({
    ok: true,
    workerId: expect.any(String),
    backend: 'opfs',
    facts: {
      crossOriginIsolated: false,
      sharedArrayBufferType: 'undefined',
      opfsSyncSupported: true,
      opfsAsyncSupported: true,
      detected: 'opfs',
    },
    initChoice: 'opfs',
    actual: exactBytes,
    syncHandlesClosed: true,
  });
  expect(read.workerId).not.toBe(write.workerId);
});
