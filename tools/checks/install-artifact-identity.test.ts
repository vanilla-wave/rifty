import { describe, expect, it } from 'vitest';
import { buildInstallArtifactRecipe } from '../shadow-registry/tools/generate-install-artifact-identity.ts';

describe('install artifact identity generator', () => {
  it('includes the exact pre-promotion Vite CLI patch policy', async () => {
    const recipe = await buildInstallArtifactRecipe();

    expect(recipe.viteCliActionPatch).toEqual({
      needle: 'this.runMatchedCommand();',
      replacement: `var __riftyAction = this.runMatchedCommand();
      if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.__riftyTrackCliPromise) {
        globalThis.__riftyTrackCliPromise(__riftyAction);
      }`,
    });
  });

  it('includes both exact Vite config-temp source paths and backing-only rewrites', async () => {
    const recipe = await buildInstallArtifactRecipe();

    expect(
      recipe.viteConfigTempPatch.sources.map(({ version, relativeSourcePath }) => ({
        version,
        relativeSourcePath,
      })),
    ).toEqual([
      { version: '7.3.6', relativeSourcePath: 'dist/node/chunks/config.js' },
      { version: '8.0.16', relativeSourcePath: 'dist/node/chunks/node.js' },
    ]);
    expect(recipe.viteConfigTempPatch.backingRewrites).toEqual([
      expect.objectContaining({ replacement: expect.stringContaining('.mkdir(') }),
      expect.objectContaining({ replacement: expect.stringContaining('.writeFile(') }),
      expect.objectContaining({ replacement: expect.stringContaining('.unlink(') }),
    ]);
  });
});
