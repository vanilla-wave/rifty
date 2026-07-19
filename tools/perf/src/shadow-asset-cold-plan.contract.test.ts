import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalShadowAssetColdExpectation } from './shadow-asset-cold-plan.mjs';

const catalog = JSON.parse(
  readFileSync('tools/shadow-registry/generated/shadow-asset-catalog.json', 'utf8'),
) as Record<string, unknown>;

interface TraceEntry {
  requestedRange: string;
  resolvedPublicVersion: string;
  substitutionId: string;
}

interface BenchmarkLockfile {
  rifty: {
    shadowSubstitutions: {
      protocol: string;
      applied: TraceEntry[];
    };
  };
}

function lockfile(overrides: Record<string, unknown> = {}) {
  const substitution = (catalog.substitutions as Array<Record<string, unknown>>)[0]!;
  return JSON.stringify({
    name: 'shadow-asset-cold',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'shadow-asset-cold', version: '0.0.0' } },
    rifty: {
      shadowSubstitutions: {
        protocol: 'rifty.lockfile-shadow-substitutions/v1',
        applied: [
          {
            publicName: substitution.publicName,
            requestedRange: '^0.25.0',
            resolvedPublicVersion: '0.28.0',
            runtimeAdapterId: substitution.runtimeAdapterId,
            substitutionId: substitution.id,
          },
        ],
      },
    },
    ...overrides,
  });
}

describe('canonical shadow-asset cold expected facts', () => {
  it('derives the exact manager plan digest and source from catalog + lockfile trace', () => {
    expect(canonicalShadowAssetColdExpectation({ catalog, lockfileText: lockfile() })).toEqual({
      assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      requiredSetDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      memberBytes: 13_918_738,
      source: {
        name: 'esbuild-wasm',
        version: '0.28.0',
        integrity:
          'sha512-5TRVKExcEmeMkccIZMzUq+Az6X2RoMAJyfl6SMMO1dMVhmvt0I2mx7gAb6zYi42n4d1ETcatFXazGKzA+aW7fg==',
      },
    });
  });

  it('changes the required-set digest when truthful requested-range evidence changes', () => {
    const first = canonicalShadowAssetColdExpectation({ catalog, lockfileText: lockfile() });
    const secondLockfile = JSON.parse(lockfile()) as BenchmarkLockfile;
    secondLockfile.rifty.shadowSubstitutions.applied[0]!.requestedRange = '^0.28.0';
    const second = canonicalShadowAssetColdExpectation({
      catalog,
      lockfileText: JSON.stringify(secondLockfile),
    });

    expect(second.requiredSetDigest).not.toBe(first.requiredSetDigest);
  });

  it('rejects a catalog whose content no longer matches its own digest', () => {
    const forged = structuredClone(catalog) as {
      assets: Array<{ memberSize: number }>;
    } & Record<string, unknown>;
    forged.assets[0]!.memberSize -= 1;

    expect(() =>
      canonicalShadowAssetColdExpectation({ catalog: forged, lockfileText: lockfile() }),
    ).toThrow(/catalog digest/i);
  });

  it.each([
    [
      'unsupported trace protocol',
      (value: BenchmarkLockfile) => {
        value.rifty.shadowSubstitutions.protocol = 'future';
      },
    ],
    [
      'drifted recipe',
      (value: BenchmarkLockfile) => {
        value.rifty.shadowSubstitutions.applied[0].substitutionId = 'foreign';
      },
    ],
    [
      'wrong resolved version',
      (value: BenchmarkLockfile) => {
        value.rifty.shadowSubstitutions.applied[0].resolvedPublicVersion = '0.27.0';
      },
    ],
    [
      'two applied substitutions',
      (value: BenchmarkLockfile) => {
        value.rifty.shadowSubstitutions.applied.push(
          structuredClone(value.rifty.shadowSubstitutions.applied[0]),
        );
      },
    ],
  ])('rejects %s instead of inferring the benchmark plan', (_label, mutate) => {
    const value = JSON.parse(lockfile()) as BenchmarkLockfile;
    mutate(value);
    expect(() =>
      canonicalShadowAssetColdExpectation({ catalog, lockfileText: JSON.stringify(value) }),
    ).toThrow(/shadow-asset cold/i);
  });

  it('rejects malformed lockfile bytes before using trace-like fields', () => {
    expect(() =>
      canonicalShadowAssetColdExpectation({ catalog, lockfileText: '{not-json' }),
    ).toThrow(/lockfile/i);
    expect(() =>
      canonicalShadowAssetColdExpectation({ catalog, lockfileText: JSON.stringify({ rifty: {} }) }),
    ).toThrow(/lockfile/i);
  });
});
