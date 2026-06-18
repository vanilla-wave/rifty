/**
 * Verifies the event-loop keepalive refs a dynamic import while in flight and
 * unrefs once settled (resolve or reject) — Task 6 of child-realm-async-lifecycle.
 *
 * Two refed paths must both hold a ref:
 *  - `loader.import()` — the public entry (e.g. the worker's first `import(url)`).
 *  - the ROUTED path real user code hits: a `import()` IN a module body is
 *    rewritten to `__import` → `esm.ts dynamicImport`. A detached
 *    `import('./x').then(run)` whose load spans a macrotask (esbuild strip) would
 *    let the realm reap before `run` arms its work — the exact silent-drop class
 *    the keepalive exists to prevent (review M2).
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { createModuleLoader } from './loader.ts';

afterEach(() => resetKeepalive());

describe('loader keeps the loop alive while a dynamic import is in flight', () => {
  it('refs during import() and unrefs once it settles', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/m.mjs': 'export const x = 1;\n',
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const p = loader.import('/work/m.mjs', '/work/m.mjs');
    expect(activeRefs()).toBeGreaterThanOrEqual(1);
    await p;
    expect(activeRefs()).toBe(0);
  });

  it('unrefs even when the import rejects', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });
    await expect(loader.import('/work/missing.mjs', '/work/missing.mjs')).rejects.toBeDefined();
    expect(activeRefs()).toBe(0);
  });
});

describe('routed user-code import() keeps the loop alive (esm.ts dynamicImport)', () => {
  // A controllable async gap inside transformSource models esbuild's strip being
  // a real macrotask: without it a plain import settles within the first
  // microtask window and the bug is invisible. `loadById` is used (NOT
  // `loader.import`) so NO outer ref is held — this isolates the routed path's
  // own ref.
  function gatedLoader(vfs: MemoryFsSync): {
    loader: ReturnType<typeof createModuleLoader>;
    release: () => void;
  } {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      transformSource: async (req) => {
        await gate;
        return req.source;
      },
    });
    return { loader, release };
  }

  it('refs while a detached routed import() is in flight, unrefs once it settles', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      // Detached (NOT awaited) → a.mjs top-level resolves while b.ts is mid-strip.
      '/work/a.mjs': "import('./b.ts');\n",
      '/work/b.ts': 'export const x = 1;\n',
    });
    const { loader, release } = gatedLoader(vfs);

    await loader.loadById('/work/a.mjs', true);
    // a.mjs resolved; the routed import('./b.ts') is parked on the strip gate.
    // RED without the fix: the routed dynamicImport holds no ref → 0.
    expect(activeRefs()).toBeGreaterThanOrEqual(1);

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(activeRefs()).toBe(0);
  });

  it('unrefs even when a routed import() rejects', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/a.mjs': "await import('./missing.ts').catch(() => {});\n",
    });
    const { loader, release } = gatedLoader(vfs);

    const p = loader.loadById('/work/a.mjs', true);
    release();
    await p;
    expect(activeRefs()).toBe(0);
  });
});
