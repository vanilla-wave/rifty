import { describe, expect, it } from 'vitest';
import {
  ShadowAssetSourceCollisionError,
  assertShadowAssetEddySourceCompatibility,
  eddyRequestForShadowAssetSources,
} from './eddy-shadow-asset-request.ts';
import type { ShadowAssetSourceRequest } from './shadow-assets.ts';

function source(
  name: string,
  version: string,
  overrides: Partial<ShadowAssetSourceRequest> = {},
): ShadowAssetSourceRequest {
  return {
    name,
    version,
    integrity: `sha512-${name}-${version}`,
    maxTarballBytes: 1_000_000,
    ...overrides,
  };
}

describe('Eddy exact shadow-asset missing-set request', () => {
  it('uses the ordinary canonical body shape with sorted, deduplicated exact dependencies', () => {
    const requests = [
      source('z-runtime', '2.0.0'),
      source('esbuild-wasm', '0.28.0'),
      source('esbuild-wasm', '0.28.0'),
      source('@scope/runtime', '1.4.0'),
    ];

    const body = eddyRequestForShadowAssetSources(requests);

    expect(body).toEqual({
      dependencies: {
        '@scope/runtime': '1.4.0',
        'esbuild-wasm': '0.28.0',
        'z-runtime': '2.0.0',
      },
      optionalDependencies: {},
    });
    expect(JSON.stringify(body)).toBe(
      '{"dependencies":{"@scope/runtime":"1.4.0","esbuild-wasm":"0.28.0","z-runtime":"2.0.0"},"optionalDependencies":{}}',
    );
    expect(body).not.toHaveProperty('overrides');
  });

  it('returns null for zero misses so an empty set cannot issue POST or GET', () => {
    expect(eddyRequestForShadowAssetSources([])).toBeNull();
  });

  it('rejects one package name at two source versions before a lossy body exists', () => {
    expect(() =>
      eddyRequestForShadowAssetSources([
        source('esbuild-wasm', '0.28.0'),
        source('esbuild-wasm', '0.27.0'),
      ]),
    ).toThrowError(
      expect.objectContaining({
        name: 'ShadowAssetSourceCollisionError',
        code: 'ESHADOWASSETSOURCE',
        sourceName: 'esbuild-wasm',
      }),
    );
  });

  it.each([
    ['baked override trigger', source('lightningcss', '1.32.0')],
    ['builtin shadow trigger', source('esbuild', '0.28.0')],
  ])('rejects a %s at composition validation', (_label, request) => {
    let thrown: unknown;
    try {
      assertShadowAssetEddySourceCompatibility([request]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShadowAssetSourceCollisionError);
    expect(thrown).toMatchObject({
      code: 'ESHADOWASSETSOURCE',
      sourceName: request.name,
      sourceVersion: request.version,
    });
    expect(String(thrown)).toContain(`${request.name}@${request.version}`);
  });

  it('accepts the canonical esbuild-wasm source because it is neither override nor trigger', () => {
    const request = source('esbuild-wasm', '0.28.0');
    expect(assertShadowAssetEddySourceCompatibility([request])).toBeUndefined();
    expect(eddyRequestForShadowAssetSources([request])).toEqual({
      dependencies: { 'esbuild-wasm': '0.28.0' },
      optionalDependencies: {},
    });
  });

  it('rejects malformed source identities before canonicalization', () => {
    for (const request of [
      source('', '1.0.0'),
      source('runtime', ''),
      { ...source('runtime', '1.0.0'), name: 1 },
    ]) {
      expect(() =>
        eddyRequestForShadowAssetSources([request as unknown as ShadowAssetSourceRequest]),
      ).toThrow(/source name|source version/i);
    }
  });
});
