import { describe, expect, it } from 'vitest';
import { identityForRecipe } from '../../tools/shadow-registry/src/install-artifact-recipe.ts';
import { buildInstallArtifactRecipe } from '../../tools/shadow-registry/tools/generate-install-artifact-identity.ts';

describe('install artifact identity — ADR-0298 + ADR-0302 Contract+RED', () => {
  it('includes the materialization protocol and full generated recipe, with the alias removed', async () => {
    const recipe = (await buildInstallArtifactRecipe()) as Record<string, unknown>;
    expect(recipe.schema).toBe(5);
    expect(recipe.bakedOverrides).not.toHaveProperty('esbuild');
    expect(recipe.internalsShims).not.toHaveProperty('@esbuild/wasi-preview1');
    expect(recipe.packageMaterialization).toEqual({
      protocol: 'rifty.lockfile-package-materialization/v1',
      kinds: ['synthesized-shadow-delegate'],
    });
    expect(recipe.viteConfigTempPatch).toEqual(
      expect.objectContaining({ schema: 1, feature: 'playground.vite-config-temp-cache' }),
    );
    expect(recipe.builtinSyntheticPackageRecipes).toEqual([
      expect.objectContaining({
        substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
        recipeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        files: {
          'lib/main.cjs': expect.stringContaining('globalThis.__rifty?.esbuild'),
          'package.json': expect.stringContaining('"name": "esbuild"'),
        },
      }),
    ]);

    const rows = recipe.builtinSyntheticPackageRecipes as Array<Record<string, unknown>>;
    const changedRows = rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            files: { ...(row.files as Record<string, string>), 'lib/main.cjs': 'drifted' },
          }
        : row,
    );
    expect(identityForRecipe({ ...recipe, builtinSyntheticPackageRecipes: changedRows })).not.toBe(
      identityForRecipe(recipe),
    );
  });
});
