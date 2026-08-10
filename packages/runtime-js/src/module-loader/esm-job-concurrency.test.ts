import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('ESM job concurrency', () => {
  it('merges concurrently imported roots in the same ESM cycle', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        globalThis.__concurrentCycleA = (globalThis.__concurrentCycleA || 0) + 1;
        import { b } from './b.mjs';
        export const a = 'A';
        export const seenB = () => b;
      `,
      '/work/b.mjs': `
        globalThis.__concurrentCycleB = (globalThis.__concurrentCycleB || 0) + 1;
        import { a } from './a.mjs';
        export const b = 'B';
        export const seenA = () => a;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const [a, b] = await Promise.all([
      loader.import('./a.mjs', '/work/entry.cjs'),
      loader.import('./b.mjs', '/work/entry.cjs'),
    ]);

    expect([a.a, (a.seenB as () => unknown)()]).toEqual(['A', 'B']);
    expect([b.b, (b.seenA as () => unknown)()]).toEqual(['B', 'A']);
    expect(Reflect.get(globalThis, '__concurrentCycleA')).toBe(1);
    expect(Reflect.get(globalThis, '__concurrentCycleB')).toBe(1);
  });
});
