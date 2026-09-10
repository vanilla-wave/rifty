import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');

test('omitted storage reports the same unavailable-OPFS fallback as preferred', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const observations = [];
    for (const persistence of [undefined, 'preferred', 'required', 'ephemeral']) {
      try {
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          ...(persistence === undefined ? {} : { storage: { persistence } }),
          toolchain: {
            workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-unavailable-storage-worker.ts`,
          },
        });
        observations.push(sandbox.vfs);
        sandbox.dispose();
      } catch (error) {
        observations.push({ error: (error as Error).message });
      }
    }
    return observations;
  }, root);
  const fallback = { backend: 'memory', reason: 'OPFS is unavailable in this realm' };
  expect(result).toEqual([
    fallback,
    fallback,
    { error: expect.stringContaining('OPFS is unavailable') },
    { backend: 'memory' },
  ]);
});

test('SDK namespace scopes native preload, writes and restart; omission keeps origin root', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const origin = await navigator.storage.getDirectory();
    const writer = await (
      await origin.getFileHandle('outside.txt', { create: true })
    ).createWritable();
    await writer.write('unrelated');
    await writer.close();
    const boot = (namespace?: string) =>
      createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'required', namespace },
        startupTimeoutMs: 30_000,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
    const a = await boot('sdk-A');
    await a.fs.writeFile('/saved.txt', 'A');
    const aOutside = await a.fs.readFile('/outside.txt', 'utf8').catch(() => null);
    await a.restart({ preview: { src: '' } });
    const restarted = await a.fs.readFile('/saved.txt', 'utf8');
    a.dispose();
    const b = await boot('sdk-B');
    const bBefore = await b.fs.readFile('/saved.txt', 'utf8').catch(() => null);
    await b.fs.writeFile('/saved.txt', 'B');
    b.dispose();
    const aAgain = await boot('sdk-A');
    const reopened = await aAgain.fs.readFile('/saved.txt', 'utf8');
    aAgain.dispose();
    const defaultSandbox = await boot();
    const defaultFile = await defaultSandbox.fs.readFile('/outside.txt', 'utf8');
    defaultSandbox.dispose();
    const native = async (namespace: string) =>
      (
        await (
          await (await origin.getDirectoryHandle(namespace)).getFileHandle('saved.txt')
        ).getFile()
      ).text();
    return {
      aOutside,
      restarted,
      bBefore,
      reopened,
      defaultFile,
      nativeA: await native('sdk-A'),
      nativeB: await native('sdk-B'),
    };
  }, root);
  expect(result).toEqual({
    aOutside: null,
    restarted: 'A',
    bBefore: null,
    reopened: 'A',
    defaultFile: 'unrelated',
    nativeA: 'A',
    nativeB: 'B',
  });
});

test('required OPFS rejects; preferred reports native fallback reason', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const boot = (persistence: string) =>
      createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence },
        toolchain: {
          workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-toolchain-memory-worker.ts`,
        },
      });
    const required = await boot('required').then(
      (sandbox) => {
        sandbox.dispose();
        return 'resolved';
      },
      (error) => error.message,
    );
    const preferred = await boot('preferred');
    const vfs = preferred.vfs;
    preferred.dispose();
    return { required, vfs };
  }, root);
  expect(result.required).toContain('forced memory backend');
  expect(result.vfs).toEqual({
    backend: 'memory',
    reason: expect.stringContaining('forced memory backend'),
  });
});

test('configured deadline covers real native preload beyond 10 seconds, including restart', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const origin = await navigator.storage.getDirectory();
    const writer = await (
      await origin.getFileHandle('delayed.txt', { create: true })
    ).createWritable();
    await writer.write('persisted');
    await writer.close();
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      startupTimeoutMs: 30_000,
      toolchain: {
        workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-configured-startup-worker.ts?delay=11000`,
      },
    });
    await sandbox.restart({ preview: { src: '' } });
    const bytes = await sandbox.fs.readFile('/delayed.txt', 'utf8');
    sandbox.dispose();
    return bytes;
  }, root);
  expect(result).toBe('persisted');
});

for (const fault of ['timeout', 'close'] as const) {
  test(`native preload ${fault} rejects and tears down its Worker`, async ({ page }) => {
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, fault }) => {
        const origin = await navigator.storage.getDirectory();
        const writer = await (
          await origin.getFileHandle('delayed.txt', { create: true })
        ).createWritable();
        await writer.write('persisted');
        await writer.close();
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        let terminated = 0;
        const terminate = Worker.prototype.terminate;
        Worker.prototype.terminate = function () {
          terminated++;
          return Reflect.apply(terminate, this, []);
        };
        try {
          const failure = await createSandbox({
            requireCrossOriginIsolation: false,
            skipServiceWorker: true,
            startupTimeoutMs: 5000,
            toolchain: {
              workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-configured-startup-worker.ts?delay=${fault === 'close' ? 10 : 60000}${fault === 'close' ? '&close' : ''}`,
            },
          }).then(
            (sandbox) => {
              sandbox.dispose();
              return 'resolved';
            },
            (error) => error.message,
          );
          return { failure, terminated };
        } finally {
          Worker.prototype.terminate = terminate;
        }
      },
      { root, fault },
    );
    expect(result.failure).toMatch(fault === 'close' ? /closed/ : /5000ms/);
    expect(result.terminated).toBe(1);
  });
}
