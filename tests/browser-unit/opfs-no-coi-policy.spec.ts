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
  readonly disableSyncHandle?: boolean;
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

test('preservation: COI main window stays memory without sync-handle capability', async ({
  page,
  browser,
}) => {
  await page.goto('/unit-harness.html');
  const result = await page.evaluate(async (moduleUrl) => {
    const vfs = await import(/* @vite-ignore */ moduleUrl);
    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      opfsAsyncSupported: vfs.OpfsVfs.isSupported(),
      opfsSyncSupported: vfs.OpfsFsSync.isSupported(),
      detected: vfs.detectVfsBackend(),
    };
  }, vfsModuleUrl);
  logArtifact(browser, 'coi-main-window', result);
  expect(result).toEqual({
    crossOriginIsolated: true,
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
    initChoice: null,
    flushResult: { total: 0, failures: [] },
    syncHandlesClosed: true,
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
    initChoice: null,
    actual: exactBytes,
    syncHandlesClosed: true,
  });
  expect(read.workerId).not.toBe(write.workerId);
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
  expect(write).toEqual({
    ok: true,
    workerId: expect.any(String),
    backend: 'opfs',
    facts: {
      crossOriginIsolated: true,
      sharedArrayBufferType: 'function',
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
      crossOriginIsolated: true,
      sharedArrayBufferType: 'function',
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

test('fault quota-perm-fail: selected OPFS init reports storage permission failure loudly', async ({
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
  expect(result).toEqual({
    ok: false,
    workerId: expect.any(String),
    facts: {
      crossOriginIsolated: true,
      sharedArrayBufferType: 'function',
      opfsSyncSupported: true,
      opfsAsyncSupported: true,
      detected: 'opfs',
    },
    initChoice: null,
    error: 'NotAllowedError: pickup denied',
    syncHandlesClosed: false,
  });
});

test('preservation: dedicated Worker without sync-handle capability selects memory', async ({
  page,
  browser,
}) => {
  await installNoCoiRoute(page);
  await assertNoCoiNavigation(page, 'goto');
  const result = await runWorker(page, {
    mode: 'selected',
    operation: 'write',
    path: `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`,
    bytes: exactBytes,
    disableSyncHandle: true,
  });
  logArtifact(browser, 'missing-sync-handle', result);
  expect(result).toEqual({
    ok: true,
    workerId: expect.any(String),
    facts: {
      crossOriginIsolated: false,
      sharedArrayBufferType: 'undefined',
      opfsSyncSupported: false,
      opfsAsyncSupported: true,
      detected: 'memory',
    },
    initChoice: 'memory',
    backend: 'memory',
    flushResult: null,
    syncHandlesClosed: false,
    publicAsyncBackend: 'memory',
    crossSurfaceActual: exactBytes,
  });
});

test('preservation: COI dedicated Worker without sync-handle capability selects memory', async ({
  page,
  browser,
}) => {
  await page.goto('/unit-harness.html');
  const result = await runWorker(page, {
    mode: 'selected',
    operation: 'write',
    path: `/__rifty_no_coi_opfs__/${crypto.randomUUID()}.bin`,
    bytes: exactBytes,
    disableSyncHandle: true,
  });
  logArtifact(browser, 'coi-missing-sync-handle', result);
  expect(result).toEqual({
    ok: true,
    workerId: expect.any(String),
    facts: {
      crossOriginIsolated: true,
      sharedArrayBufferType: 'function',
      opfsSyncSupported: false,
      opfsAsyncSupported: true,
      detected: 'memory',
    },
    initChoice: 'memory',
    backend: 'memory',
    flushResult: null,
    syncHandlesClosed: false,
    publicAsyncBackend: 'memory',
    crossSurfaceActual: exactBytes,
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
