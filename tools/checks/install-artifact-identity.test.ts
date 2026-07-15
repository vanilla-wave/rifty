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
});
