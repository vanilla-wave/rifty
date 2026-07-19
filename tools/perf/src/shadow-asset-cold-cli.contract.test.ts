import { describe, expect, it } from 'vitest';
import {
  assertPreservedStandardShadowAssetColdOutput,
  parseShadowAssetColdOptions,
  preserveStandardShadowAssetColdInput,
  shadowAssetColdHostEnv,
} from './shadow-asset-cold-cli.mjs';

const REGISTRY_URL = 'https://registry.example/npm-registry';
const RESOLVER_URL = 'https://eddy.example/resolve';

function completeSchemaV3Artifact() {
  const standard = {
    status: 'measured',
    count: 5,
    samples: [501, 502, 503, 504, 505],
    median: 503,
    displayMs: 600,
    registryUrl: REGISTRY_URL,
    runs: [501, 502, 503, 504, 505].map((durationMs) => ({ durationMs })),
  };
  return {
    artifact: {
      schemaVersion: 3,
      runner: { runs: 5, browser: 'chromium', headless: true },
      metrics: { shadowAssetColdFillMs: { standard } },
    },
    standard,
  };
}

describe('shadow-asset-cold CLI contract', () => {
  it('defaults to off without changing existing benchmark phases', () => {
    expect(parseShadowAssetColdOptions({ args: [], env: {}, runs: 5, transport: 'auto' })).toEqual({
      mode: 'off',
    });
  });

  it.each(['', 'registry', 'STANDARD'])('rejects invalid --shadow-asset-cold value %j', (mode) => {
    expect(() =>
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', mode],
        env: { VITE_RIFTY_REGISTRY_URL: 'https://registry.example/npm-registry' },
        runs: 5,
        transport: 'auto',
      }),
    ).toThrow(/--shadow-asset-cold must be off\|standard\|eddy/i);
  });

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

  it('accepts the exact reproducible Eddy shape and defaults its bundle endpoint to resolver', () => {
    expect(
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', 'eddy'],
        env: {
          VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
          VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
        },
        runs: 5,
        transport: 'auto',
      }),
    ).toEqual({
      mode: 'eddy',
      registryUrl: REGISTRY_URL,
      resolverUrl: RESOLVER_URL,
      bundleUrl: RESOLVER_URL,
    });
  });

  it('keeps an explicit absolute Eddy bundle endpoint', () => {
    expect(
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', 'eddy'],
        env: {
          VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
          VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
          VITE_RIFTY_EDDY_BUNDLE_URL: 'https://bundle.example/assets',
        },
        runs: 5,
        transport: 'auto',
      }),
    ).toMatchObject({ bundleUrl: 'https://bundle.example/assets' });
  });

  it.each([
    ['missing registry', { VITE_RIFTY_RESOLVER_URL: RESOLVER_URL }, 5, 'auto', /registry/i],
    ['missing resolver', { VITE_RIFTY_REGISTRY_URL: REGISTRY_URL }, 5, 'auto', /resolver/i],
    [
      'relative resolver',
      {
        VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
        VITE_RIFTY_RESOLVER_URL: '/resolve',
      },
      5,
      'auto',
      /resolver/i,
    ],
    [
      'relative bundle',
      {
        VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
        VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
        VITE_RIFTY_EDDY_BUNDLE_URL: '/bundle',
      },
      5,
      'auto',
      /bundle/i,
    ],
    [
      'wrong run count',
      {
        VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
        VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
      },
      4,
      'auto',
      /exactly 5/i,
    ],
    [
      'non-auto transport',
      {
        VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
        VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
      },
      5,
      'h2',
      /--transport auto/i,
    ],
  ])('rejects Eddy mode before Chromium: %s', (_name, env, runs, transport, error) => {
    expect(() =>
      parseShadowAssetColdOptions({
        args: ['--shadow-asset-cold', 'eddy'],
        env,
        runs,
        transport,
      }),
    ).toThrow(error);
  });

  it('retains the parsed Eddy endpoints in its measured host environment', () => {
    const options = {
      mode: 'eddy',
      registryUrl: REGISTRY_URL,
      resolverUrl: RESOLVER_URL,
      bundleUrl: RESOLVER_URL,
    };
    expect(
      shadowAssetColdHostEnv(
        {
          KEEP: 'yes',
          VITE_RIFTY_REGISTRY_URL: 'https://stale.example/registry',
          VITE_RIFTY_RESOLVER_URL: 'https://stale.example/resolver',
          VITE_RIFTY_EDDY_BUNDLE_URL: 'https://stale.example/bundle',
        },
        options,
      ),
    ).toEqual({
      KEEP: 'yes',
      VITE_RIFTY_REGISTRY_URL: REGISTRY_URL,
      VITE_RIFTY_RESOLVER_URL: RESOLVER_URL,
      VITE_RIFTY_EDDY_BUNDLE_URL: RESOLVER_URL,
    });
  });
});

describe('Eddy cold standard artifact preservation', () => {
  const eddyOptions = {
    mode: 'eddy',
    registryUrl: REGISTRY_URL,
    resolverUrl: RESOLVER_URL,
    bundleUrl: RESOLVER_URL,
  };

  it('returns the complete matching schema-v3 standard object verbatim', () => {
    const { artifact, standard } = completeSchemaV3Artifact();

    expect(preserveStandardShadowAssetColdInput(artifact, eddyOptions)).toBe(standard);
  });

  it('accepts only an output artifact whose standard row is byte-for-byte unchanged', () => {
    const { artifact, standard } = completeSchemaV3Artifact();
    const rebuilt = structuredClone(artifact);

    expect(assertPreservedStandardShadowAssetColdOutput(rebuilt, standard)).toBeUndefined();

    rebuilt.metrics.shadowAssetColdFillMs.standard.samples[2] += 1;
    expect(() => assertPreservedStandardShadowAssetColdOutput(rebuilt, standard)).toThrow(
      /preserve.*standard.*verbatim/i,
    );
  });

  it('rejects a semantically equal standard row whose serialized field order changed', () => {
    const { artifact, standard } = completeSchemaV3Artifact();
    const { status, ...tail } = artifact.metrics.shadowAssetColdFillMs.standard;
    artifact.metrics.shadowAssetColdFillMs.standard = { ...tail, status };

    expect(artifact.metrics.shadowAssetColdFillMs.standard).toEqual(standard);
    expect(() => assertPreservedStandardShadowAssetColdOutput(artifact, standard)).toThrow(
      /preserve.*standard.*verbatim/i,
    );
  });

  it.each([
    ['non-v3 artifact', (artifact) => ({ ...artifact, schemaVersion: 2 }), /schema.*3/i],
    [
      'non-five-run artifact',
      (artifact) => ({ ...artifact, runner: { ...artifact.runner, runs: 4 } }),
      /exactly 5/i,
    ],
    [
      'unmeasured standard row',
      (artifact) => ({
        ...artifact,
        metrics: {
          ...artifact.metrics,
          shadowAssetColdFillMs: {
            standard: { status: 'unmeasured', note: 'network failed' },
          },
        },
      }),
      /measured standard/i,
    ],
    [
      'partial samples',
      (artifact) => {
        const standard = artifact.metrics.shadowAssetColdFillMs.standard;
        return {
          ...artifact,
          metrics: {
            ...artifact.metrics,
            shadowAssetColdFillMs: {
              standard: { ...standard, count: 4, samples: standard.samples.slice(0, 4) },
            },
          },
        };
      },
      /exactly 5/i,
    ],
    [
      'partial evidence runs',
      (artifact) => {
        const standard = artifact.metrics.shadowAssetColdFillMs.standard;
        return {
          ...artifact,
          metrics: {
            ...artifact.metrics,
            shadowAssetColdFillMs: {
              standard: { ...standard, runs: standard.runs.slice(0, 4) },
            },
          },
        };
      },
      /exactly 5/i,
    ],
    [
      'different registry spelling',
      (artifact) => artifact,
      /registry.*exactly match/i,
      { ...eddyOptions, registryUrl: `${REGISTRY_URL}/` },
    ],
  ])('refuses %s before Chromium', (_name, mutate, error, options = eddyOptions) => {
    const { artifact } = completeSchemaV3Artifact();
    expect(() => preserveStandardShadowAssetColdInput(mutate(artifact), options)).toThrow(error);
  });
});
