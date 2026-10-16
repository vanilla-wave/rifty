import { describe, expect, it } from 'vitest';
import { buildInstallArtifactRecipe } from '../shadow-registry/tools/generate-install-artifact-identity.ts';

describe('install artifact identity generator', () => {
  it('carries no Vite CLI transform: installed cli.js is upstream bytes', async () => {
    const recipe = await buildInstallArtifactRecipe();

    expect(Object.keys(recipe).filter((key) => /cli/i.test(key))).toEqual([]);
    expect(JSON.stringify(recipe)).not.toContain('__riftyTrackCliPromise');
  });

  it('carries no Vite root policy: installed chunks are upstream bytes at every root (ADR-0533)', async () => {
    const recipe = await buildInstallArtifactRecipe();

    expect(Object.keys(recipe).filter((key) => /vite/i.test(key))).toEqual([]);
    const text = JSON.stringify(recipe);
    expect(text).not.toContain('EMPTY_STR');
    expect(text).not.toContain('root.length');
  });
});
