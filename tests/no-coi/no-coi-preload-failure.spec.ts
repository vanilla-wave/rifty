import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');

test('unreadable saved OPFS rejects toolchain boot instead of activating memory', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const outcome = await page.evaluate(async (root) => {
    const directory = await navigator.storage.getDirectory();
    const file = await directory.getFileHandle('unreadable.txt', { create: true });
    const writer = await file.createWritable();
    await writer.write('saved bytes');
    await writer.close();
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    let result: { resolved: boolean; message?: string };
    try {
      const sandbox = await Promise.race([
        createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-preload-failure-worker.ts`,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('boot settlement timeout')), 20_000),
        ),
      ]);
      sandbox.dispose();
      result = { resolved: true };
    } catch (error) {
      result = { resolved: false, message: (error as Error).message };
    }
    return { ...result, bytes: await (await file.getFile()).text() };
  }, root);
  expect(outcome).toMatchObject({
    resolved: false,
    bytes: 'saved bytes',
    message: expect.stringContaining('native preload failure'),
  });
});

test('unreadable preload settles eval and fs requests queued before runtime readiness', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const directory = await navigator.storage.getDirectory();
    const file = await directory.getFileHandle('unreadable.txt', { create: true });
    const writer = await file.createWritable();
    await writer.write('saved bytes');
    await writer.close();
    const { spawnRuntime } = await import(`/@fs${root}/packages/runtime-js/src/index.ts`);
    let worker: Worker | undefined;
    let listenerReady: (() => void) | undefined;
    let readBlocked: (() => void) | undefined;
    const installed = new Promise<void>((resolve) => {
      listenerReady = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      readBlocked = resolve;
    });
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        worker = Reflect.construct(target, args) as Worker;
        worker.addEventListener('message', (event) => {
          if (event.data.type === 'runtime-listener-installed') listenerReady?.();
          if (event.data.type === 'preload-blocked') readBlocked?.();
        });
        return worker;
      },
    });
    const runtime = spawnRuntime({
      workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-preload-pending-worker.ts`,
    });
    globalThis.Worker = NativeWorker;
    let ready = false;
    runtime.on((event: { type: string }) => {
      if (event.type === 'ready') ready = true;
    });
    try {
      await Promise.all([installed, blocked]);
      const pending = Promise.allSettled([
        runtime.eval('1+1'),
        runtime.fs.readFile('/unreadable.txt', 'utf8'),
      ]);
      worker?.postMessage({ type: 'fail-preload' });
      const outcomes = await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('pending request settlement timeout')), 20_000),
        ),
      ]);
      return {
        ready,
        statuses: outcomes.map((outcome) => outcome.status),
        bytes: await (await file.getFile()).text(),
      };
    } finally {
      runtime.dispose();
    }
  }, root);
  expect(result).toEqual({
    ready: false,
    statuses: ['rejected', 'rejected'],
    bytes: 'saved bytes',
  });
});
