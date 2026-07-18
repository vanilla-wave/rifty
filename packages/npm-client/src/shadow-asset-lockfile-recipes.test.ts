import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { describe, expect, it } from 'vitest';
import { lockfileShadowSubstitutionRecipes } from './shadow-asset-lockfile-recipes.ts';

describe('lockfile shadow-substitution recipe ledger', () => {
  it('retains immutable historical materialization facts after active overrides change', () => {
    expect(lockfileShadowSubstitutionRecipes).toContainEqual({
      substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      publicName: 'esbuild',
      materialization: { kind: 'package', name: '@esbuild/wasi-preview1' },
    });
  });

  it('covers every current builtin substitution without deleting historical recipes', () => {
    for (const substitution of builtinShadowAssetCatalog.substitutions) {
      expect(lockfileShadowSubstitutionRecipes).toContainEqual(
        expect.objectContaining({
          substitutionId: substitution.id,
          publicName: substitution.publicName,
        }),
      );
    }
  });
});
