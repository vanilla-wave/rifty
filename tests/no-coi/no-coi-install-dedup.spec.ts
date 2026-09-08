import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');

test('explicit cached install skips durable package writes and repairs changed bytes', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      while (!sandbox.runtime.isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
      await sandbox.fs.writeFile(
        '/dedup/package.json',
        JSON.stringify({ name: 'dedup', dependencies: { nanoid: '3.3.18' } }),
      );
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const original = await sandbox.fs.readFile('/dedup/node_modules/nanoid/index.js', 'utf8');
      const injected = await sandbox.runtime.eval(`
        globalThis.__installCounts = { writes: 0, mkdir: 0 };
        const write = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          if (this.name === 'index.js') globalThis.__installCounts.writes++;
          return Reflect.apply(write, this, args);
        };
        const mkdir = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
        FileSystemDirectoryHandle.prototype.getDirectoryHandle = function (...args) {
          if (args[0] === 'nanoid' && args[1]?.create) globalThis.__installCounts.mkdir++;
          return Reflect.apply(mkdir, this, args);
        };
      `);
      if (!injected.ok) throw new Error('counter injection failed');
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const output: string[] = [];
      const off = sandbox.runtime.on((event: { type: string; chunk?: string }) => {
        if (event.type === 'stdout' && event.chunk) output.push(event.chunk);
      });
      await sandbox.runtime.eval('console.log(JSON.stringify(globalThis.__installCounts))');
      off();
      const counts = JSON.parse(output.join('').trim());
      await sandbox.fs.writeFile('/dedup/node_modules/nanoid/index.js', original.replace(/./, '!'));
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const repaired = await sandbox.fs.readFile('/dedup/node_modules/nanoid/index.js', 'utf8');
      await sandbox.fs.writeFile('/dedup/node_modules/nanoid/index.js', 'damaged');
      await sandbox.runtime.eval(`
        globalThis.__quota = true;
        const nativeWrite = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          if (globalThis.__quota && this.name === 'index.js') return Promise.reject(new DOMException('dedup quota', 'QuotaExceededError'));
          return Reflect.apply(nativeWrite, this, args);
        };
      `);
      let rejected = false;
      try {
        await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      } catch {
        rejected = true;
      }
      await sandbox.runtime.eval('globalThis.__quota = false');
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const healed = await sandbox.fs.readFile('/dedup/node_modules/nanoid/index.js', 'utf8');
      return { counts, repaired: repaired === original, rejected, healed: healed === original };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(result.repaired).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.healed).toBe(true);
  expect(result.counts).toEqual({ writes: 0, mkdir: 0 });
});
