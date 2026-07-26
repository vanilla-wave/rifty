import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { assertShadowRecipeAdmission } from './admission.ts';

const semverRecipe = {
  trigger: { version: '0.28.0' },
  admission: {
    kind: 'semver-admits',
    unsupportedFeature: 'esbuild.version',
  },
} as const;

const exactRecipe = {
  trigger: { version: '1.100.0' },
  admission: {
    kind: 'exact-only',
    unsupportedFeature: 'sass-embedded.version',
  },
} as const;

function rejectionFeature(
  recipe: typeof semverRecipe | typeof exactRecipe,
  request: string | null,
) {
  try {
    assertShadowRecipeAdmission(recipe, request);
  } catch (error) {
    expect(error).toBeInstanceOf(NotImplementedError);
    return (error as NotImplementedError).feature;
  }
  throw new Error(`expected ${String(request)} to be rejected`);
}

describe('shadow recipe admission', () => {
  it.each([
    null,
    '',
    '*',
    'latest',
    '0.28.0',
    'v0.28.0',
    '^0.28.0',
    '~0.28.0',
    '0.28.x',
    '>=0.27.0 <0.29.0',
  ])('keeps current semver admission for %s', (request) => {
    expect(() => assertShadowRecipeAdmission(semverRecipe, request)).not.toThrow();
  });

  it.each(['0.27.0', '^0.29.0', 'next'])(
    'rejects semver requests outside the trigger version with the recipe feature: %s',
    (request) => {
      expect(rejectionFeature(semverRecipe, request)).toBe('esbuild.version');
    },
  );

  it('admits only the byte-identical trigger version for exact-only policy', () => {
    expect(() => assertShadowRecipeAdmission(exactRecipe, '1.100.0')).not.toThrow();
  });

  it.each([
    ['null request', null],
    ['tag', 'latest'],
    ['wildcard', '*'],
    ['range', '^1.100.0'],
    ['v-prefixed equivalent', 'v1.100.0'],
  ] as const)(
    'rejects exact-only $0 with one recipe-declared stable feature',
    (_label, request) => {
      expect(rejectionFeature(exactRecipe, request)).toBe('sass-embedded.version');
    },
  );
});
