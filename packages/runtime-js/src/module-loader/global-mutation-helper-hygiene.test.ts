import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe.each(['cjs', 'esm'] as const)('%s global mutation helper hygiene', (kind) => {
  it('does not let an escaped guest binding replace the symbol validator', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    if (!descriptor) throw new Error('host Function descriptor missing');
    const vfs = new MemoryFsSync();
    const filename = kind === 'esm' ? '/main.mjs' : '/main.cjs';
    vfs.loadFixture({
      [filename]: String.raw`
        const \u005f_riftyGlobalSymbolKey = () => 'Function';
        const key = Symbol('safe');
        globalThis[key] = 17;
        delete globalThis[key];
      `,
    });
    const loader = createModuleLoader(vfs);
    try {
      if (kind === 'esm') await loader.import(filename);
      else loader.require(filename);
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });
});
