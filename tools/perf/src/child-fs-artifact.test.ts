import { describe, expect, it } from 'vitest';

const SCENARIO_DIGEST = 'a'.repeat(64);
const DEPENDENCY_DIGEST = 'b'.repeat(64);

interface ViteSample {
  readonly exitCode: number;
  readonly transformedModules: number;
  readonly selfTimeSeconds: number;
  readonly marker: string;
  readonly markerFound: boolean;
  readonly markerCount: number;
  readonly rawOutput: string;
}

interface ExpressSample {
  readonly exitCode: number;
  readonly startToListeningMs: number;
  readonly freshRealm: boolean;
  readonly clockStartedBeforeRequire: boolean;
  readonly listened: boolean;
  readonly closed: boolean;
  readonly markerCount: number;
  readonly rawOutput: string;
}

interface BenchmarkSample {
  readonly lane: 'product-coi' | 'in-realm';
  readonly topology: 'owner-sync-rpc-kernel-child' | 'single-in-realm-worker';
  readonly ordinal: number;
  readonly scenarioDigest: string;
  readonly dependencyDigest: string;
  readonly ownerLoad: 'idle';
  readonly terminalProof: boolean;
  readonly vite: ViteSample;
  readonly express: ExpressSample;
}

function sample(lane: 'product-coi' | 'in-realm', ordinal: number): BenchmarkSample {
  return {
    lane,
    topology: lane === 'product-coi' ? 'owner-sync-rpc-kernel-child' : 'single-in-realm-worker',
    ordinal,
    scenarioDigest: SCENARIO_DIGEST,
    dependencyDigest: DEPENDENCY_DIGEST,
    ownerLoad: 'idle',
    terminalProof: true,
    vite: {
      exitCode: 0,
      transformedModules: 2180,
      selfTimeSeconds: lane === 'product-coi' ? 1.63 : 1.13,
      marker: `run-${ordinal}`,
      markerFound: true,
      markerCount: 1,
      rawOutput: `✓ 2180 modules transformed.\n✓ built in ${lane === 'product-coi' ? '1.63' : '1.13'}s`,
    },
    express: {
      exitCode: 0,
      startToListeningMs: lane === 'product-coi' ? 34.25 : 9.5,
      freshRealm: true,
      clockStartedBeforeRequire: true,
      listened: true,
      closed: true,
      markerCount: 1,
      rawOutput: `RIFTY_EXPRESS_READY run-${ordinal}`,
    },
  };
}

function completeSamples(runs = 2): readonly BenchmarkSample[] {
  return (['product-coi', 'in-realm'] as const).flatMap((lane) =>
    Array.from({ length: runs }, (_, index) => sample(lane, index + 1)),
  );
}

type BuildArtifact = typeof import('./child-fs-artifact.mjs')['buildChildFsArtifact'];

function validArtifact(buildChildFsArtifact: BuildArtifact, runs = 2): unknown {
  return buildChildFsArtifact({
    generatedAt: '2026-08-26T00:00:00.000Z',
    gitSha: 'c'.repeat(40),
    browserVersion: 'Chromium 140.0.7339.16',
    runs,
    samples: completeSamples(runs),
  });
}

describe('child fs benchmark artifact', () => {
  it('preserves exact raw samples and all provenance without rounding or projection', async () => {
    const { buildChildFsArtifact, validateChildFsArtifact } = await import(
      './child-fs-artifact.mjs'
    );
    const artifact = validateChildFsArtifact(validArtifact(buildChildFsArtifact));
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      gitSha: 'c'.repeat(40),
      browserVersion: 'Chromium 140.0.7339.16',
      scenarioDigest: SCENARIO_DIGEST,
      dependencyDigest: DEPENDENCY_DIGEST,
      runs: 2,
    });
    expect(artifact.samples).toEqual(completeSamples());
    expect(artifact.samples[0]?.vite.selfTimeSeconds).toBe(1.63);
    expect(artifact.samples[0]?.express.startToListeningMs).toBe(34.25);
  });

  it('rejects identity, topology, terminal, and Vite proof corruption', async () => {
    const { buildChildFsArtifact } = await import('./child-fs-artifact.mjs');
    const corruptions: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
      ['scenario digest drift', { scenarioDigest: 'd'.repeat(64) }],
      ['dependency digest drift', { dependencyDigest: 'e'.repeat(64) }],
      ['wrong module count', { vite: { ...sample('in-realm', 1).vite, transformedModules: 2179 } }],
      ['stale Vite marker', { vite: { ...sample('in-realm', 1).vite, markerFound: false } }],
      ['duplicate Vite marker', { vite: { ...sample('in-realm', 1).vite, markerCount: 2 } }],
      ['missing terminal proof', { terminalProof: false }],
      ['wrong topology', { topology: 'same-realm-fallback' }],
    ];
    for (const [label, replacement] of corruptions) {
      const samples = completeSamples().map((entry, index) =>
        index === 2 ? { ...entry, ...replacement } : entry,
      );
      expect(
        () =>
          buildChildFsArtifact({
            generatedAt: '2026-08-26T00:00:00.000Z',
            gitSha: 'c'.repeat(40),
            browserVersion: 'Chromium 140.0.7339.16',
            runs: 2,
            samples,
          }),
        label,
      ).toThrow();
    }
  });

  it('rejects every incomplete Express cold-listen proof', async () => {
    const { buildChildFsArtifact } = await import('./child-fs-artifact.mjs');
    const corruptions: ReadonlyArray<readonly [string, Partial<ExpressSample>]> = [
      ['clock starts after require', { clockStartedBeforeRequire: false }],
      ['warm realm', { freshRealm: false }],
      ['never listened', { listened: false }],
      ['server left open', { closed: false }],
      ['non-zero exit', { exitCode: 1 }],
      ['duplicate marker', { markerCount: 2 }],
    ];
    for (const [label, expressPatch] of corruptions) {
      const samples = completeSamples().map((entry, index) =>
        index === 0 ? { ...entry, express: { ...entry.express, ...expressPatch } } : entry,
      );
      expect(
        () =>
          buildChildFsArtifact({
            generatedAt: '2026-08-26T00:00:00.000Z',
            gitSha: 'c'.repeat(40),
            browserVersion: 'Chromium 140.0.7339.16',
            runs: 2,
            samples,
          }),
        label,
      ).toThrow();
    }
  });

  it('rejects partial, duplicate, or one-lane samples instead of a thin comparison', async () => {
    const { buildChildFsArtifact } = await import('./child-fs-artifact.mjs');
    const corruptions: ReadonlyArray<readonly [string, readonly BenchmarkSample[]]> = [
      ['partial sample set', completeSamples().slice(0, -1)],
      [
        'duplicate ordinal',
        completeSamples().map((entry, index) => (index === 1 ? { ...entry, ordinal: 1 } : entry)),
      ],
      ['missing lane', completeSamples().filter((entry) => entry.lane !== 'in-realm')],
    ];
    for (const [label, samples] of corruptions) {
      expect(
        () =>
          buildChildFsArtifact({
            generatedAt: '2026-08-26T00:00:00.000Z',
            gitSha: 'c'.repeat(40),
            browserVersion: 'Chromium 140.0.7339.16',
            runs: 2,
            samples,
          }),
        label,
      ).toThrow();
    }
  });
});
