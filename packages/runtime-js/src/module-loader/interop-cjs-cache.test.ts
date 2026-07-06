/**
 * ESM-import-of-CJS across cache hits (Node parity). A CJS module's ESM
 * namespace (`default` = `module.exports` + reflected named keys) must be the
 * SAME for every importer — first load, registry cache hit, and
 * require()-then-import. Regression: the loader wrapped CJS exports only on
 * first load; a cache hit returned the RAW exports object, so the second
 * importer's `default` binding was `undefined`. Real-world shape: vite 7's
 * `tinyglobby` — `fdir` require()s `picomatch` first, then tinyglobby's
 * `import picomatch from 'picomatch'` got `undefined` and the react-vite dev
 * boot died in `addManuallyIncludedOptimizeDeps` (`picomatch.scan` on
 * undefined).
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

function fixture(): MemoryFsSync {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    '/work/package.json': JSON.stringify({ type: 'module' }),
    '/work/node_modules/pico/package.json': JSON.stringify({
      name: 'pico',
      version: '1.0.0',
      main: 'index.js',
    }),
    // picomatch shape: module.exports is a function with attached named props.
    '/work/node_modules/pico/index.js': [
      'function pico(glob) { return () => true; }',
      'pico.scan = (pattern) => ({ isGlob: false, negated: false });',
      'module.exports = pico;',
    ].join('\n'),
    '/work/first.mjs': [
      "import pico from 'pico';",
      'export const firstDefault = typeof pico;',
    ].join('\n'),
    '/work/second.mjs': [
      "import pico from 'pico';",
      'export const secondDefault = typeof pico;',
      'export const secondScan = typeof (pico === undefined ? undefined : pico.scan);',
    ].join('\n'),
    '/work/main.mjs': [
      "import { firstDefault } from './first.mjs';",
      "import { secondDefault, secondScan } from './second.mjs';",
      'export { firstDefault, secondDefault, secondScan };',
    ].join('\n'),
  });
  return vfs;
}

describe('ESM namespace of a CJS module across cache hits', () => {
  it('every ESM importer sees the default binding, not just the first', async () => {
    const loader = createModuleLoader(fixture(), { cwd: '/work' });
    const main = (await loader.import('./main.mjs', '/work/__entry__.mjs')) as {
      firstDefault: string;
      secondDefault: string;
      secondScan: string;
    };
    expect(main.firstDefault).toBe('function');
    expect(main.secondDefault).toBe('function'); // was 'undefined' (raw exports leak)
    expect(main.secondScan).toBe('function');
  });

  it('require()-then-import keeps the default binding (fdir→picomatch, then tinyglobby)', async () => {
    const loader = createModuleLoader(fixture(), { cwd: '/work' });
    const required = loader.require('pico', '/work/tool.cjs') as { scan?: unknown };
    expect(typeof required.scan).toBe('function');
    const ns = (await loader.import('pico', '/work/__entry__.mjs')) as { default?: unknown };
    expect(typeof ns.default).toBe('function');
  });

  it('all importers share ONE namespace object (Node parity), dropped on invalidate', async () => {
    const loader = createModuleLoader(fixture(), { cwd: '/work' });
    const a = await loader.import('pico', '/work/__a__.mjs');
    const b = await loader.import('pico', '/work/__b__.mjs');
    expect(b).toBe(a);
    loader.invalidate('/work/node_modules/pico/index.js');
    const c = await loader.import('pico', '/work/__c__.mjs');
    expect(c).not.toBe(a);
    expect(typeof (c as { default?: unknown }).default).toBe('function');
  });
});
