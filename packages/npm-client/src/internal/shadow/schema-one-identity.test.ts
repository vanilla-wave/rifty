import { describe, expect, it } from 'vitest';
import { isSchemaOneBuiltinShadowSubstitutionIdentity } from './schema-one-identity.ts';

describe('schema-one builtin shadow identity edge', () => {
  it.each(['rifty.shadow-substitution.esbuild.v1', 'rifty.shadow-substitution.lightningcss.v1'])(
    'recognizes the exact historical recipe identity %s',
    (recipeId) => {
      expect(
        isSchemaOneBuiltinShadowSubstitutionIdentity(
          'rifty.shadow-substitutions.builtin.v1',
          recipeId,
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['rifty.shadow-substitutions.builtin.v2', 'rifty.shadow-substitution.esbuild.v1'],
    ['rifty.shadow-substitutions.builtin.v1', 'rifty.shadow-substitution.esbuild.v2'],
    ['rifty.shadow-substitutions.builtin.v1', 'rifty.shadow-substitution.foreign.v1'],
  ])('rejects non-historical identity %s / %s', (catalogId, recipeId) => {
    expect(isSchemaOneBuiltinShadowSubstitutionIdentity(catalogId, recipeId)).toBe(false);
  });
});
