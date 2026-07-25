import { describe, expect, it } from 'vitest';
import {
  assertShadowRecipeAdmission,
  shadowRecipeAdmitsRequest,
} from './admission.ts';

const RECIPE_BASE = {
  schema: 2,
  id: 'rifty.shadow-substitution.contract.v2',
  digest: '0'.repeat(64),
  trigger: { name: 'contract-package', version: '1.100.0' },
  acquisition: { kind: 'synthetic' },
  materialization: {
    name: 'contract-package',
    version: '1.100.0',
    bin: {},
    files: [],
  },
} as const;

function recipe(kind: 'exact-only' | 'semver-admits') {
  return {
    ...RECIPE_BASE,
    admission: {
      kind,
      unsupportedFeature: `contract-package.${kind}`,
    },
  } as const;
}

describe('shadow recipe admission policy', () => {
  it('admits only the byte-exact trigger for exact-only recipes', () => {
    const exact = recipe('exact-only');

    expect(shadowRecipeAdmitsRequest(exact, '1.100.0')).toBe(true);
    for (const range of [null, 'latest', '*', '^1.100.0', '~1.100.0', '>=1.100.0']) {
      expect(shadowRecipeAdmitsRequest(exact, range), String(range)).toBe(false);
      expect(() => assertShadowRecipeAdmission(exact, range)).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'contract-package.exact-only',
        }),
      );
    }
  });

  it('preserves npm-style range admission for semver-admits recipes', () => {
    const semver = recipe('semver-admits');

    for (const range of [null, 'latest', '*', '1.100.0', '^1.100.0', '~1.100.0']) {
      expect(shadowRecipeAdmitsRequest(semver, range), String(range)).toBe(true);
      expect(() => assertShadowRecipeAdmission(semver, range)).not.toThrow();
    }
    expect(shadowRecipeAdmitsRequest(semver, '^2.0.0')).toBe(false);
    expect(() => assertShadowRecipeAdmission(semver, '^2.0.0')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'contract-package.semver-admits',
      }),
    );
  });
});
