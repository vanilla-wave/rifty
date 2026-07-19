import { describe, expect, it } from 'vitest';
import { shadowAssetColdPackageAcquisition } from './shadow-asset-cold-options';

describe('packed shadow-asset cold acquisition options', () => {
  it('keeps standard mode registry-only', () => {
    expect(
      shadowAssetColdPackageAcquisition({
        mode: 'standard',
        registryUrl: 'https://registry.example/npm-registry',
      }),
    ).toEqual({ registryUrl: 'https://registry.example/npm-registry' });
  });

  it('configures the public Workbench Eddy composition with exact endpoints', () => {
    expect(
      shadowAssetColdPackageAcquisition({
        mode: 'eddy',
        registryUrl: 'https://registry.example/npm-registry',
        resolverUrl: 'https://eddy.example/resolve',
        bundleBaseUrl: 'https://bundles.example/assets',
      }),
    ).toEqual({
      registryUrl: 'https://registry.example/npm-registry',
      eddy: {
        resolverUrl: 'https://eddy.example/resolve',
        bundleBaseUrl: 'https://bundles.example/assets',
      },
    });
  });

  it.each([
    ['relative registry', { mode: 'standard', registryUrl: '/npm' }],
    [
      'relative resolver',
      {
        mode: 'eddy',
        registryUrl: 'https://registry.example/npm',
        resolverUrl: '/resolve',
        bundleBaseUrl: 'https://eddy.example',
      },
    ],
    [
      'relative bundle base',
      {
        mode: 'eddy',
        registryUrl: 'https://registry.example/npm',
        resolverUrl: 'https://eddy.example/resolve',
        bundleBaseUrl: '/bundle',
      },
    ],
  ])('rejects %s before opening Workbench', (_label, options) => {
    expect(() => shadowAssetColdPackageAcquisition(options)).toThrow(/absolute http\(s\)/i);
  });
});
