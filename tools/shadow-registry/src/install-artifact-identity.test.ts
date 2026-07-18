import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  identityForRecipe,
  installArtifactTreePolicy,
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
    ['runtime source', { policy: { sourceSha256: 'a' } }, { policy: { sourceSha256: 'b' } }],
    ['generated output', { output: null }, { output: { sha256: 'a'.repeat(64) } }],
  ])('changes when %s changes', (_label, before, after) => {
    expect(identityForRecipe(before)).not.toBe(identityForRecipe(after));
  });

  it('excludes asset-only source/member pins and caps from tree identity projection', () => {
    const policy = {
      schema: 1,
      api: 'esbuild-js-api',
      state: 'final-green',
      version: '0.28.0',
      source: {
        package: 'esbuild-wasm',
        version: '0.28.0',
        integrity: 'sha512-before',
        maxTarballBytes: 10,
        maxUnpackedBytes: 20,
        member: 'package/lib/browser.js',
        sha256: 'browser-source',
      },
      wasm: {
        member: 'package/esbuild.wasm',
        sha256: 'asset-before',
        bytes: 10,
      },
      validationSource: { sha256: 'oracle' },
      patches: ['one'],
      patchDescriptions: { one: 'description' },
      currentSurfaces: [{ notes: 'documentation only' }],
    };
    const changedAsset = {
      ...policy,
      source: {
        ...policy.source,
        integrity: 'sha512-after',
        maxTarballBytes: 11,
        maxUnpackedBytes: 21,
      },
      wasm: { ...policy.wasm, sha256: 'asset-after', bytes: 11 },
    };
    expect(installArtifactTreePolicy(changedAsset)).toEqual(installArtifactTreePolicy(policy));
    expect(
      installArtifactTreePolicy({
        ...policy,
        source: { ...policy.source, sha256: 'browser-source-after' },
      }),
    ).not.toEqual(installArtifactTreePolicy(policy));
  });
});
