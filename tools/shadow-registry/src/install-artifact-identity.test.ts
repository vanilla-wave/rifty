import { describe, expect, it } from 'vitest';
import { canonicalJson, identityForRecipe } from './install-artifact-recipe.ts';

describe('install artifact identity', () => {
  it('canonicalizes object key order but preserves array order', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: 3 }, rows: ['b', 'a'] })).toBe(
      '{"a":{"c":3,"d":2},"rows":["b","a"],"z":1}',
    );
    expect(identityForRecipe({ b: 2, a: 1 })).toBe(identityForRecipe({ a: 1, b: 2 }));
  });

  it.each([
    ['override', { overrides: { esbuild: '0.28.0' } }, { overrides: { esbuild: '0.29.0' } }],
    ['shim bytes', { files: { main: 'before' } }, { files: { main: 'after' } }],
    ['policy', { policy: { state: 'contract-red' } }, { policy: { state: 'final-green' } }],
    ['generated output', { output: null }, { output: { sha256: 'a'.repeat(64) } }],
  ])('changes when %s changes', (_label, before, after) => {
    expect(identityForRecipe(before)).not.toBe(identityForRecipe(after));
  });
});
