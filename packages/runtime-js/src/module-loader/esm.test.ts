/**
 * Unit tests for the ESM execute path's TS-on-import strip step
 * (feature 02-ts-on-import-graph, T3).
 *
 * The strip hook is injected (ADR-0052): when present, `.ts`/`.tsx`/`.jsx`
 * source is transformed before the AST ESM rewriter parses it. This file locks
 * the NO-HOOK half: a `.ts`/`.tsx`/`.jsx` module reached with NO
 * `transformSource` configured must throw a DIRECTED, honest error
 * (`/TS transform not configured/`) rather than falling through to acorn and
 * dying with an opaque SYNTAX_ERROR (no silent stub, no opaque parse failure).
 */
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('executeEsm TS-on-import strip step', () => {
  it('throws a directed error when a .ts module is executed with no transformSource', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      // type:module so .ts classifies ESM (ADR-0053 D2).
      '/work/package.json': JSON.stringify({ type: 'module' }),
      // Raw TS that acorn cannot parse: a type annotation on a const.
      '/work/main.ts': 'export const x: number = 1;\n',
    });

    // NO transformSource configured.
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    await expect(loader.import('./main.ts', '/work/__entry__.ts')).rejects.toThrow(
      /TS transform not configured/,
    );
  });
});
