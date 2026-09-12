import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');

for (const operation of ['install', 'build'] as const) {
  test(`toolchain ${operation} rejects a reported native persistence failure`, async ({ page }) => {
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, operation }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        try {
          while (!sandbox.runtime.isReady())
            await new Promise((resolve) => setTimeout(resolve, 10));
          await sandbox.fs.writeFile('/fault/package.json', '{"name":"fault","version":"1.0.0"}');
          await sandbox.fs.writeFile(
            '/fault/node_modules/.bin/build',
            "#!/usr/bin/env node\nimport('../build/cli.cjs');\n",
          );
          await sandbox.fs.writeFile(
            '/fault/node_modules/build/cli.cjs',
            "require('node:fs').writeFileSync('/fault/output.txt', 'built');\n",
          );
          const injected = await sandbox.runtime.eval(`
          const original = FileSystemFileHandle.prototype.createWritable;
          FileSystemFileHandle.prototype.createWritable = function (...args) {
            if (this.name === ${JSON.stringify(operation === 'install' ? 'package-lock.json' : 'output.txt')}) {
              return Promise.reject(new DOMException('native quota probe', 'QuotaExceededError'));
            }
            return Reflect.apply(original, this, args);
          };
        `);
          if (!injected.ok) throw new Error('native fault injection failed');
          try {
            if (operation === 'install')
              await sandbox.toolchain.install({ cwd: '/fault', registryUrl: '/npm-registry' });
            else
              await sandbox.toolchain.runBin({
                cwd: '/fault',
                binPath: '/fault/node_modules/.bin/build',
                args: [],
              });
            return { resolved: true, coi: crossOriginIsolated };
          } catch (error) {
            const inspected = error as Error;
            return {
              resolved: false,
              coi: crossOriginIsolated,
              name: inspected.name,
              message: inspected.message,
            };
          }
        } finally {
          sandbox.dispose();
        }
      },
      { root, operation },
    );
    expect(result.coi).toBe(false);
    expect(result).toMatchObject({
      resolved: false,
      message: expect.stringContaining('native quota probe'),
    });
  });
}
