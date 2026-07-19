import { describe, expect, it } from 'vitest';
import {
  parseShadowAssetColdOptions,
  shadowAssetColdHostEnv,
} from './shadow-asset-cold-cli.mjs';

describe('shadow-asset-cold CLI contract', () => {
  it('defaults to off without changing existing benchmark phases', () => {
    expect(
      parseShadowAssetColdOptions({ args: [], env: {}, runs: 5, transport: 'auto' }),
    ).toEqual({ mode: 'off' });
  });

  it.each(['', 'registry', 'eddy', 'STANDARD'])(
    'rejects invalid --shadow-asset-cold value %j',
    (mode) => {
      expect(() =>
        parseShadowAssetColdOptions({
          args: ['--shadow-asset-cold', mode],
          env: { VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry' },
          runs: 5,
          transport: 'auto',
        }),
      ).toThrow(/--shadow-asset-cold must be off\|standard/i);
    },
  );

  it.each([
    ['missing registry', {}, 5, 'auto', /VITE_RIFTY_REGISTRY_URL/],
    [
      'wrong run count',
      { VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry' },
      4,
      'auto',
      /exactly 5/i,
    ],
    [
      'non-auto transport',
      { VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry' },
      5,
      'h2',
      /--transport auto/i,
    ],
  ])('rejects standard mode before Chromium: %s', (_name, env, runs, transport, error) => {
    expect(() =>
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', 'standard'],
        env,
        runs,
        transport,
      }),
    ).toThrow(error);
  });

  it('accepts only the exact reproducible standard shape and records the env URL', () => {
    expect(
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', 'standard'],
        env: { VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry' },
        runs: 5,
        transport: 'auto',
      }),
    ).toEqual({
      mode: 'standard',
      registryUrl: 'https://registry.example/npm-registry',
    });
  });

  it('deletes inherited Eddy resolver and bundle settings from the standard host', () => {
    expect(
      shadowAssetColdHostEnv({
        KEEP: 'yes',
        VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry',
        VITE_RIFTY_RESOLVER_URL: 'https://eddy.example',
        VITE_RIFTY_EDDY_BUNDLE_URL: 'https://bundle.example',
      }),
    ).toEqual({
      KEEP: 'yes',
      VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry',
    });
  });
});
