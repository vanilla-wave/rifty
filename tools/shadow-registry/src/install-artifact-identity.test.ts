import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  identityForRecipe,
  identityPolicyProjection,
} from './install-artifact-recipe.ts';

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
    ['generated output', { output: null }, { output: { sha256: 'a'.repeat(64) } }],
  ])('changes when %s changes', (_label, before, after) => {
    expect(identityForRecipe(before)).not.toBe(identityForRecipe(after));
  });

  it('ignores doc-only policy edits but flips on behavior-bearing ones', async () => {
    const policy = JSON.parse(
      await readFile(new URL('../esbuild-runtime-policy.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const identity = identityForRecipe(identityPolicyProjection(policy));

    const docEdited = {
      ...policy,
      state: 'reworded',
      currentSurfaces: [{ surface: 'reworded', status: 'implemented', notes: 'reworded' }],
      patchDescriptions: {},
      validationSource: { package: 'reworded' },
      tests: [],
      limitations: [],
      gaps: [],
      unsupportedSurfaces: [],
    };
    expect(identityForRecipe(identityPolicyProjection(docEdited))).toBe(identity);

    const wasm = policy.wasm as Record<string, unknown>;
    const wasmEdited = { ...policy, wasm: { ...wasm, sha256: 'f'.repeat(64) } };
    expect(identityForRecipe(identityPolicyProjection(wasmEdited))).not.toBe(identity);
  });

  it('refuses a policy missing an identity-bearing field', () => {
    expect(() => identityPolicyProjection({ schema: 1 })).toThrow(/missing identity field/);
    expect(() => identityPolicyProjection(null)).toThrow(/must be an object/);
  });
});
