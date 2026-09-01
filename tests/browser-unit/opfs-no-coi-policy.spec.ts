import { type Browser, type Page, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/opfs-no-coi-policy-worker.ts`;
const vfsModuleUrl = `/@fs${workspacePath}/packages/vfs/src/index.ts`;
const exactBytes = [0, 1, 2, 127, 128, 254, 255, 13, 10];

interface WorkerRequest {
  readonly mode: 'direct' | 'selected';
  readonly operation: 'write' | 'read';
  readonly path: string;
  readonly bytes: number[];
  readonly denyStorage?: boolean;
}

async function installNoCoiRoute(page: Page): Promise<void> {
  await page.route(/\/unit-harness\.html\?no-coi-opfs=1$/, async (route) => {
    const upstream = await route.fetch();
    const headers = Object.fromEntries(
      Object.entries(upstream.headers()).filter(
        ([name]) =>
          name !== 'cross-origin-opener-policy' && name !== 'cross-origin-embedder-policy',
      ),
    );
    await route.fulfill({ response: upstream, headers });
  });
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
        const timer = setTimeout(() => reject(new Error('OPFS policy worker timeout')), 20_000);
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

function logArtifact(browser: Browser, label: string, result: unknown): void {
  console.log(`[opfs-no-coi] ${label} Chrome/${browser.version()} ${JSON.stringify(result)}`);
}

test('preservation: no-COI main window stays memory when only async OPFS is available', async ({
  page,
  browser,
}) => {
  await installNoCoiRoute(page);
  await assertNoCoiNavigation(page, 'goto');
  const result = await page.evaluate(async (moduleUrl) => {
    const vfs = await import(/* @vite-ignore */ moduleUrl);
    return {
      opfsAsyncSupported: vfs.OpfsVfs.isSupported(),
      opfsSyncSupported: vfs.OpfsFsSync.isSupported(),
      detected: vfs.detectVfsBackend(),
    };
  }, vfsModuleUrl);
  logArtifact(browser, 'main-window', result);
  expect(result).toEqual({
    opfsAsyncSupported: true,
    opfsSyncSupported: false,
    detected: 'memory',
  });
});

test('preservation: direct sync OPFS works without COI and survives a page reload', async ({
  page,
  browser,
}) => {
  await installNoCoiRoute(page);
  await assertNoCoiNavigation(page, 'goto');
  const path = `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`;
  const write = await runWorker(page, {
    mode: 'direct',
    operation: 'write',
    path,
    bytes: exactBytes,
  });
  await assertNoCoiNavigation(page, 'reload');
  const read = await runWorker(page, {
    mode: 'direct',
    operation: 'read',
    path,
    bytes: exactBytes,
  });
  logArtifact(browser, 'direct-capability-reload', { write, read });
  expect(write).toMatchObject({
    ok: true,
    backend: 'opfs',
    facts: {
      crossOriginIsolated: false,
      sharedArrayBufferType: 'undefined',
      opfsSyncSupported: true,
      opfsAsyncSupported: true,
    },
    flushResult: { total: 0, failures: [] },
  });
  expect(read).toMatchObject({ ok: true, backend: 'opfs', actual: exactBytes });
});

test('preservation: COI dedicated Worker keeps OPFS selection and exact reload durability', async ({
  page,
  browser,
}) => {
  const response = await page.goto('/unit-harness.html');
  expect(response).not.toBeNull();
  expect(
    await page.evaluate(() => ({
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sharedArrayBufferType: typeof globalThis.SharedArrayBuffer,
    })),
  ).toEqual({ crossOriginIsolated: true, sharedArrayBufferType: 'function' });
  const path = `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`;
  const write = await runWorker(page, {
    mode: 'selected',
    operation: 'write',
    path,
    bytes: exactBytes,
  });
  await page.reload();
  const read = await runWorker(page, {
    mode: 'selected',
    operation: 'read',
    path,
    bytes: exactBytes,
  });
  logArtifact(browser, 'coi-selection-reload', { write, read });
  expect(write).toMatchObject({
    ok: true,
    backend: 'opfs',
    facts: { opfsSyncSupported: true, detected: 'opfs' },
    flushResult: { total: 0, failures: [] },
  });
  expect(read).toMatchObject({ ok: true, backend: 'opfs', actual: exactBytes });
});

test('preservation: selected OPFS init reports a storage permission failure loudly', async ({
  page,
  browser,
}) => {
  await page.goto('/unit-harness.html');
  const path = `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`;
  const result = await runWorker(page, {
    mode: 'selected',
    operation: 'write',
    path,
    bytes: exactBytes,
    denyStorage: true,
  });
  logArtifact(browser, 'permission-failure', result);
  expect(result).toMatchObject({
    ok: false,
    facts: { opfsSyncSupported: true, detected: 'opfs' },
    error: 'NotAllowedError: pickup denied',
  });
});

test('no-COI capable dedicated Worker selects OPFS and survives exact-byte reload', async ({
  page,
  browser,
}) => {
  await installNoCoiRoute(page);
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
  logArtifact(browser, 'selected-no-coi-reload', { write, read });

  expect(write).toMatchObject({
    ok: true,
    backend: 'opfs',
    facts: {
      crossOriginIsolated: false,
      sharedArrayBufferType: 'undefined',
      opfsSyncSupported: true,
      opfsAsyncSupported: true,
      detected: 'opfs',
    },
    flushResult: { total: 0, failures: [] },
  });
  expect(read).toMatchObject({ ok: true, backend: 'opfs', actual: exactBytes });
});
