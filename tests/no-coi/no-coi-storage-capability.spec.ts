import { expect, test } from './fixtures/test.ts';

const root = process.cwd().replaceAll('\\', '/');

for (const fault of ['createWritable', 'root'] as const) {
  for (const persistence of ['required', 'preferred', 'default', 'ephemeral'] as const) {
    test(`storage admission ${fault}: ${persistence}`, async ({ page }) => {
      await page.goto('/no-coi-harness.html');
      const result = await page.evaluate(
        async ({ root, fault, persistence }) => {
          const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          let phase = 'boot';
          try {
            const sandbox = await createSandbox({
              requireCrossOriginIsolation: false,
              skipServiceWorker: true,
              ...(persistence === 'default' ? {} : { storage: { persistence } }),
              toolchain: {
                workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-storage-capability-worker.ts?fault=${fault}`,
              },
            });
            phase = 'write';
            try {
              await sandbox.fs.writeFile('/saved.txt', 'memory survives writes');
              return {
                vfs: sandbox.vfs,
                contents: await sandbox.fs.readFile('/saved.txt', 'utf8'),
              };
            } finally {
              sandbox.dispose();
            }
          } catch (error) {
            const failure = error as Error & {
              code?: string;
              cause?: { name: string; message: string };
            };
            return {
              phase,
              error: {
                name: failure.name,
                message: failure.message,
                code: failure.code,
                cause: failure.cause,
              },
            };
          }
        },
        { root, fault, persistence },
      );
      if (persistence === 'required') {
        expect(result.phase).toBe('boot');
        expect(result.error).toMatchObject({
          name: fault === 'root' ? 'StorageUnavailableError' : 'StorageCapabilityError',
          code: fault === 'root' ? 'ERR_STORAGE_UNAVAILABLE' : 'ERR_STORAGE_CAPABILITY',
          message: expect.stringContaining(
            fault === 'root'
              ? 'UnknownError: Storage root denied by the browser'
              : 'FileSystemFileHandle.createWritable',
          ),
          ...(fault === 'root'
            ? { cause: { name: 'UnknownError', message: 'Storage root denied by the browser' } }
            : {}),
        });
        expect(result.error?.message).not.toMatch(/Worker crashed|Not implemented/);
      } else {
        expect(result.vfs).toEqual({
          backend: 'memory',
          ...(persistence === 'ephemeral'
            ? {}
            : {
                reason: expect.stringContaining(
                  fault === 'root'
                    ? 'UnknownError: Storage root denied by the browser'
                    : 'FileSystemFileHandle.createWritable',
                ),
              }),
        });
        expect(result.contents).toBe('memory survives writes');
      }
    });
  }
}
