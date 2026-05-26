import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('ESM cycles', () => {
  it('handles a simple A→B→A cycle (eventual values stable)', async () => {
    const loader = setup({
      '/a.mjs':
        "import { fromB } from './b.mjs'; export let fromA = 'a'; export const observedB = fromB;",
      '/b.mjs':
        "import { fromA } from './a.mjs'; export const fromB = 'b'; export const observedA = fromA;",
    });
    const a = await loader.import('./a.mjs', '/entry.mjs');
    expect(a.fromA).toBe('a');
    expect(a.observedB).toBe('b');
  });
});
