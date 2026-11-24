/**
 * The runtime's default `requireModule` (unit `runtime-js/isolate-require-esm-syntax-gaps`,
 * Acceptance 5): the four behaviours the isolate guest switches off stay Node 24's on every
 * other host. The switched-off side is proven in the isolate against live Node
 * (`packages/isolate-host/tests/require-esm.test.ts`).
 */
import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

const FILES = {
  '/work/m.mjs': 'export const a = 1;',
  '/work/s.js': 'export const a = 1;',
  '/work/b.js': 'let require = 1;',
  '/work/node_modules/dual/package.json': JSON.stringify({
    name: 'dual',
    exports: { '.': { 'module-sync': './r.mjs', default: './i.js' } },
  }),
  '/work/node_modules/dual/r.mjs': 'export default "esm";',
  '/work/node_modules/dual/i.js': 'module.exports = "cjs";',
};

function loader(): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(FILES);
  return createModuleLoader(vfs, { cwd: '/work' });
}

describe('require(esm) by default, as Node 24', () => {
  it('process.features.require_module is true', () => {
    expect(riftyProcess.features.require_module).toBe(true);
  });

  it('require and import take the module-sync condition', async () => {
    const l = loader();
    expect(l.require('dual', '/work/entry.cjs')).toMatchObject({ default: 'esm' });
    expect(l.resolver.resolve('dual', { fromFile: '/work/entry.cjs', esm: false }).id).toBe(
      '/work/node_modules/dual/r.mjs',
    );
    expect((await l.import('dual', '/work/entry.mjs')).default).toBe('esm');
  });

  it('require detects ESM syntax in a typeless .js', () => {
    const l = loader();
    expect(l.require('./s.js', '/work/entry.cjs')).toMatchObject({ a: 1 });
    const ns = l.require('./b.js', '/work/entry.cjs') as object;
    expect([Object.prototype.toString.call(ns), Object.keys(ns)]).toEqual(['[object Module]', []]);
  });

  it('require of an .mjs returns its namespace', () => {
    expect(loader().require('./m.mjs', '/work/entry.cjs')).toMatchObject({ a: 1 });
  });
});
