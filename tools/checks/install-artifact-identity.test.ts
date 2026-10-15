import { describe, expect, it } from 'vitest';
import { buildInstallArtifactRecipe } from '../shadow-registry/tools/generate-install-artifact-identity.ts';

describe('install artifact identity generator', () => {
  it('carries no Vite CLI transform: installed cli.js is upstream bytes', async () => {
    const recipe = await buildInstallArtifactRecipe();

    expect(Object.keys(recipe).filter((key) => /cli/i.test(key))).toEqual([]);
    expect(JSON.stringify(recipe)).not.toContain('__riftyTrackCliPromise');
  });
});
