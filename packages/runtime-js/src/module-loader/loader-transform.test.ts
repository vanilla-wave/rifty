/**
 * Unit tests for the public TS-on-import option surface on
 * {@link ModuleLoaderOptions} (feature 02-ts-on-import-graph, T2).
 *
 * Locks the load-bearing {@link TransformSourceHook} request shape
 * (`{ source, id, loader, workspace }` -> `Promise<string>`, ADR-0052 D1):
 *  - `transformSource` is threaded into the ESM execute path and invoked for
 *    EVERY `.ts` module across an import graph (not just the entry).
 *  - the loader passes `loader:'ts'` (extension-derived) and the resolved
 *    `workspace` to each call.
 *  - the hook's return value is what reaches the AST ESM rewriter (the
 *    sentinel-strip round-trips into the executed module).
 */
import { NotImplementedError } from '@rifty/io';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('ModuleLoaderOptions transform surface', () => {
  it('passes workspace and transformSource through to the esm execute path', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      // type:module so .ts classifies ESM (ADR-0053 D2).
      '/work/package.json': JSON.stringify({ type: 'module' }),
      // Entry imports the dep; both carry a `/*X*/` sentinel the spy strips.
      '/work/main.ts': "/*X*/import { dep } from './dep.ts';\nexport const main = dep + 1;\n",
      '/work/dep.ts': '/*X*/export const dep = 41;\n',
    });

    const seen: { id: string; loader: string; workspace: string }[] = [];
    const spy = vi.fn(
      async (req: { source: string; id: string; loader: string; workspace: string }) => {
        seen.push({ id: req.id, loader: req.loader, workspace: req.workspace });
        // Strip the sentinel so the remaining source is plain ESM that acorn
        // (transformEsm) can parse — proves the hook output is what is parsed.
        return req.source.replaceAll('/*X*/', '');
      },
    );

    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      workspace: '/work',
      transformSource: spy,
    });

    const ns = await loader.import('./main.ts', '/work/__entry__.ts');

    // Hook invoked for BOTH the entry and its dependency.
    expect(spy).toHaveBeenCalledTimes(2);
    const ids = seen.map((s) => s.id).sort();
    expect(ids).toEqual(['/work/dep.ts', '/work/main.ts']);
    for (const s of seen) {
      expect(s.loader).toBe('ts');
      expect(s.workspace).toBe('/work');
    }

    // The stripped source is what executed: dep=41, main=dep+1=42.
    expect(ns.main).toBe(42);
  });

  it('defaults workspace to cwd when workspace is not given', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/package.json': JSON.stringify({ type: 'module' }),
      '/proj/only.ts': '/*X*/export const only = 7;\n',
    });

    let observedWorkspace = '';
    const spy = vi.fn(
      async (req: { source: string; id: string; loader: string; workspace: string }) => {
        observedWorkspace = req.workspace;
        return req.source.replaceAll('/*X*/', '');
      },
    );

    const loader = createModuleLoader(vfs, { cwd: '/proj', transformSource: spy });
    const ns = await loader.import('./only.ts', '/proj/__entry__.ts');

    expect(observedWorkspace).toBe('/proj');
    expect(ns.only).toBe(7);
  });
});

describe('require() of a .ts module (CJS-scope honesty, feature 02 T4)', () => {
  it('require() of a .ts module throws a directed NotImplementedError, never silently new-Functions TS', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      // NO `type:module` => detectKind classifies the `.ts` as CJS, the very
      // path that would otherwise feed raw TS to executeCjs/new Function.
      '/work/package.json': JSON.stringify({ name: 'legacy-scope' }),
      // TS-only syntax (a type annotation) that would die with an opaque
      // SyntaxError inside `new Function` if it ever reached executeCjs.
      '/work/legacy.ts': 'export const x: number = 1;\n',
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });

    // The strip hook is async (esbuild via runWasi) and require() cannot await
    // it (ADR-0052 D1 alt-C), so a `.ts` reached via require() must throw a
    // directed, honest error — not an opaque acorn/new-Function SyntaxError.
    expect(() => loader.require('./legacy.ts', '/work/e.js')).toThrow(NotImplementedError);
    expect(() => loader.require('./legacy.ts', '/work/e.js')).toThrow(/require\(\) of .*\.ts/);
  });
});
