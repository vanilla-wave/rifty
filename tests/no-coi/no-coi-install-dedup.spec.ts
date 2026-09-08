import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');

test('explicit cached install skips durable package writes and repairs changed bytes', async ({
  page,
  browser,
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
      const coldStart = performance.now();
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const coldInstallMs = performance.now() - coldStart;
      const original = await sandbox.fs.readFile('/dedup/node_modules/nanoid/index.js', 'utf8');
      const injected = await sandbox.runtime.eval(`
        globalThis.__installCounts = { writes: 0, mkdir: 0 };
        globalThis.__nativeInstallCounts = { writable: 0, directory: 0, fileHandle: 0, getFile: 0 };
        const write = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          globalThis.__nativeInstallCounts.writable++;
          if (this.name === 'index.js') globalThis.__installCounts.writes++;
          return Reflect.apply(write, this, args);
        };
        const mkdir = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
        FileSystemDirectoryHandle.prototype.getDirectoryHandle = function (...args) {
          globalThis.__nativeInstallCounts.directory++;
          if (args[0] === 'nanoid' && args[1]?.create) globalThis.__installCounts.mkdir++;
          return Reflect.apply(mkdir, this, args);
        };
        for (const [prototype, method, counter] of [[FileSystemDirectoryHandle.prototype, 'getFileHandle', 'fileHandle'], [FileSystemFileHandle.prototype, 'getFile', 'getFile']]) {
          const native = prototype[method];
          prototype[method] = function (...args) {
            globalThis.__nativeInstallCounts[counter]++;
            return Reflect.apply(native, this, args);
          };
        }
      `);
      if (!injected.ok) throw new Error('counter injection failed');
      const repeatStart = performance.now();
      await sandbox.toolchain.install({ cwd: '/dedup', registryUrl: '/npm-registry' });
      const repeatInstallMs = performance.now() - repeatStart;
      const output: string[] = [];
      const off = sandbox.runtime.on((event: { type: string; chunk?: string }) => {
        if (event.type === 'stdout' && event.chunk) output.push(event.chunk);
      });
      await sandbox.runtime.eval(
        'console.log(JSON.stringify({ counts: globalThis.__installCounts, native: globalThis.__nativeInstallCounts }))',
      );
      off();
      const { counts, native } = JSON.parse(output.join('').trim()) as {
        counts: { writes: number; mkdir: number };
        native: Record<string, number>;
      };
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
      return {
        counts,
        measurements: { coldInstallMs, repeatInstallMs, native },
        repaired: repaired === original,
        rejected,
        healed: healed === original,
      };
    } finally {
      sandbox.dispose();
    }
  }, root);
  console.log(`[install-dedup] Chrome/${browser.version()} ${JSON.stringify(result.measurements)}`);
  expect(result.repaired).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.healed).toBe(true);
  expect(result.counts).toEqual({ writes: 0, mkdir: 0 });
});
