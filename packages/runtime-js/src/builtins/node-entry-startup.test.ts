import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import type { ModuleLoader } from '../module-loader/loader.ts';
import { runNodeEntry } from './node-entry.ts';

const resultKey = '__riftyStartupResult';
afterEach(() => {
  for (const key of [resultKey, '__riftyPreloadCount', '__riftyPreloadObject'])
    Reflect.deleteProperty(globalThis, key);
});
function files(): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.loadFixture({
    '/work/package.json': JSON.stringify({
      type: 'module',
      imports: { '#choice': { custom: './custom.mjs', default: './base.mjs' } },
    }),
    '/work/node_modules/pick/package.json': JSON.stringify({
      exports: { custom: './custom.mjs', default: './base.mjs' },
    }),
    '/work/node_modules/pick/base.mjs': "export default 'base';",
    '/work/node_modules/pick/custom.mjs': "export default 'custom';",
    '/work/base.mjs': "export default 'base';",
    '/work/custom.mjs': "export default 'custom';",
    '/work/pre.cjs':
      'globalThis.__riftyPreloadCount = (globalThis.__riftyPreloadCount || 0) + 1; module.exports = globalThis.__riftyPreloadObject = {count:globalThis.__riftyPreloadCount};',
    '/work/entry.mjs': `import selected from 'pick'; import alias from '#choice'; import pre from './pre.cjs'; globalThis.${resultKey} = [selected, alias, globalThis.__riftyPreloadCount, pre === globalThis.__riftyPreloadObject];`,
    '/work/meta.mjs': `globalThis.${resultKey} = [import.meta.resolve('./missing.js', 'file:///other/parent.mjs'), import.meta.resolve('pick', 'file:///other/parent.mjs')];`,
    '/other/node_modules/pick/package.json': JSON.stringify({
      exports: { custom: './custom.mjs', default: './base.mjs' },
    }),
    '/other/node_modules/pick/custom.mjs': "export default 'other';",
    '/other/node_modules/pick/base.mjs': "export default 'other-base';",
  });
  return fs;
}

it('require preloads share the entry cache; conditions affect exports and imports', async () => {
  await runNodeEntry({
    vfs: files(),
    cwd: '/work',
    entryPath: '/work/entry.mjs',
    execArgv: ['--require', './pre.cjs', '--require=./pre.cjs', '--conditions=custom'],
  });
  expect(Reflect.get(globalThis, resultKey)).toEqual(['custom', 'custom', 1, true]);
});
it('experimental import-meta-resolve uses the second parent URL', async () => {
  await runNodeEntry({
    vfs: files(),
    cwd: '/work',
    entryPath: '/work/meta.mjs',
    execArgv: ['--experimental-import-meta-resolve', '--conditions', 'custom'],
  });
  expect(Reflect.get(globalThis, resultKey)).toEqual([
    'file:///other/missing.js',
    'file:///other/node_modules/pick/custom.mjs',
  ]);
});

it('entry admission follows preloads and shares their real loader/cache', async () => {
  const fs = files();
  const order: string[] = [];
  fs.loadFixture({ '/work/entry.cjs': 'module.exports = require("./pre.cjs");' });
  const options = {
    vfs: fs,
    cwd: '/work',
    entryPath: '/work/entry.cjs',
    execArgv: ['--require', './pre.cjs'],
    beforeEntry: async (loader: ModuleLoader) => {
      order.push('admitted');
      const pre = loader.require('./pre.cjs', '/work/entry.cjs');
      expect(pre).toBe(Reflect.get(globalThis, '__riftyPreloadObject'));
      expect(Reflect.get(globalThis, '__riftyPreloadCount')).toBe(1);
    },
  };
  await runNodeEntry(options);
  expect(order).toEqual(['admitted']);
  expect(Reflect.get(globalThis, '__riftyPreloadCount')).toBe(1);
});

it('handled native entry completion shares the preload cache without running the entry again', async () => {
  const fs = files();
  fs.loadFixture({ '/work/never.cjs': 'throw new Error("second-entry");' });
  const options = {
    vfs: fs,
    cwd: '/work',
    entryPath: '/work/never.cjs',
    execArgv: ['--require', './pre.cjs'],
    beforeEntry: async () => 'handled' as const,
  };
  await expect(runNodeEntry(options)).resolves.toBeUndefined();
  expect(Reflect.get(globalThis, '__riftyPreloadCount')).toBe(1);
});
