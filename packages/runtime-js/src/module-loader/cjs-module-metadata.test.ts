import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  globals.__riftyFlakyModuleCalls = undefined;
});

describe('CJS Module metadata graph', () => {
  it('links cycles before evaluation and flips loaded only after each body returns', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/a.js': `
        exports.loadedDuring = module.loaded;
        exports.info = () => ({
          loaded: module.loaded,
          children: module.children.map((child) => child.filename),
          parent: module.parent && module.parent.filename,
        });
        const b = require('./b.js');
        exports.b = b;
      `,
      '/b.js': `
        const a = require('./a.js');
        module.exports = {
          aLoadedDuring: a.loadedDuring,
          loadedDuring: module.loaded,
          parentHadChildDuring: module.parent.children.includes(module),
          info: () => ({
            loaded: module.loaded,
            children: module.children.map((child) => child.filename),
            parent: module.parent.filename,
          }),
        };
      `,
    });
    const loader = createModuleLoader(vfs);

    const a = loader.require('/a.js', '/entry.js') as {
      loadedDuring: boolean;
      info(): { loaded: boolean; children: string[]; parent: string | undefined };
      b: {
        aLoadedDuring: boolean;
        loadedDuring: boolean;
        parentHadChildDuring: boolean;
        info(): { loaded: boolean; children: string[]; parent: string };
      };
    };

    expect(a.loadedDuring).toBe(false);
    expect(a.b).toMatchObject({
      aLoadedDuring: false,
      loadedDuring: false,
      parentHadChildDuring: true,
    });
    expect(a.info()).toEqual({ loaded: true, children: ['/b.js'], parent: undefined });
    expect(a.b.info()).toEqual({ loaded: true, children: ['/a.js'], parent: '/a.js' });
  });

  it('removes a failed child edge and cache record before a same-parent retry', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/parent.js': `
        try { require('./flaky.js'); } catch {}
        exports.childrenAfterFailure = module.children.map((child) => child.filename);
        exports.child = require('./flaky.js');
        exports.info = () => ({
          children: module.children.map((child) => child.filename),
          loaded: module.loaded,
        });
      `,
      '/flaky.js': `
        globalThis.__riftyFlakyModuleCalls = (globalThis.__riftyFlakyModuleCalls || 0) + 1;
        if (globalThis.__riftyFlakyModuleCalls === 1) throw new Error('first load fails');
        module.exports = { parent: module.parent.filename, loadedDuring: module.loaded };
      `,
    });
    const loader = createModuleLoader(vfs);

    const parent = loader.require('/parent.js', '/entry.js') as {
      childrenAfterFailure: string[];
      child: { parent: string; loadedDuring: boolean };
      info(): { children: string[]; loaded: boolean };
    };

    expect(parent.childrenAfterFailure).toEqual([]);
    expect(parent.child).toEqual({ parent: '/parent.js', loadedDuring: false });
    expect(parent.info()).toEqual({ children: ['/flaky.js'], loaded: true });
    expect(globals.__riftyFlakyModuleCalls).toBe(2);
  });
});
