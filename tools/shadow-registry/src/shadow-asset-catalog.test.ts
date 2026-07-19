import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  builtinShadowAssetCatalog,
  createBuiltinShadowAssetCatalog,
} from './shadow-asset-catalog.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('builtin shadow-asset catalog', () => {
  it('publishes exact generated esbuild provenance as deeply frozen clone-safe data', () => {
    const catalog = builtinShadowAssetCatalog;
    expect(catalog.schema).toBe(1);
    expect(catalog.id).toBe('rifty.shadow-assets.builtin.v1');
    expect(catalog.substitutions).toEqual([
      {
        id: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
        publicName: 'esbuild',
        builtin: true,
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
        versions: { '0.28.0': ['esbuild-wasm@0.28.0/package/esbuild.wasm'] },
      },
    ]);
    expect(catalog.assets).toEqual([
      {
        id: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        source: {
          name: 'esbuild-wasm',
          version: '0.28.0',
          integrity:
            'sha512-5TRVKExcEmeMkccIZMzUq+Az6X2RoMAJyfl6SMMO1dMVhmvt0I2mx7gAb6zYi42n4d1ETcatFXazGKzA+aW7fg==',
        },
        member: 'package/esbuild.wasm',
        memberSha256: '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
        memberSize: 13_918_738,
        maxTarballBytes: 3_845_798,
        maxUnpackedBytes: 14_483_968,
      },
    ]);
    const { digest: _digest, ...payload } = catalog;
    expect(catalog.digest).toBe(createHash('sha256').update(canonical(payload)).digest('hex'));
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.assets)).toBe(true);
    expect(Object.isFrozen(catalog.assets[0]?.source)).toBe(true);
    expect(structuredClone(catalog)).toEqual(catalog);
  });

  it('rejects malformed descriptors and source packages colliding with builtin substitution names', () => {
    let thrown: unknown;
    try {
      createBuiltinShadowAssetCatalog({
        schema: 1,
        id: 'test.catalog',
        substitutions: structuredClone(builtinShadowAssetCatalog.substitutions),
        assets: [
          {
            id: 'bad',
            source: { name: 'esbuild', version: '0.28.0', integrity: 'sha512-not-base64' },
            member: '../esbuild.wasm',
            memberSha256: 'x',
            memberSize: 0,
            maxTarballBytes: 0,
            maxUnpackedBytes: 0,
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'ESHADOWASSETSOURCE' });

    const malformed = {
      ...structuredClone(builtinShadowAssetCatalog),
      assets: builtinShadowAssetCatalog.assets.map((asset, index) =>
        index === 0
          ? { ...asset, source: { ...asset.source, name: 'safe-source', integrity: 'sha512-AAAA' } }
          : asset,
      ),
    };
    expect(() => createBuiltinShadowAssetCatalog(malformed)).toThrow(/integrity/);
  });
});
