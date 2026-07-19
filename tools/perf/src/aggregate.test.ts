import { describe, expect, it } from 'vitest';
// The pure core is `.mjs` so `../bench.mjs` (a zero-dep node runner) imports it
// directly; the unit suite drives it here.
import {
  SCHEMA_VERSION,
  buildArtifact,
  median,
  roundUpMs,
  summarize,
  verifyEddyInstallProof,
  verifyTransportPin,
} from './aggregate.mjs';

describe('bench aggregate core', () => {
  describe('median', () => {
    it('odd-length → the middle value', () => {
      expect(median([5, 1, 3])).toBe(3);
    });
    it('even-length → mean of the two middles', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });
    it('is order-independent', () => {
      expect(median([620, 600, 610])).toBe(median([600, 610, 620]));
    });
    it('throws on an empty sample set (no median of nothing)', () => {
      expect(() => median([])).toThrow();
    });
  });

  describe('roundUpMs — conservative (never claims faster than measured)', () => {
    it('rounds up to the next step', () => {
      expect(roundUpMs(612, 100)).toBe(700);
    });
    it('leaves an exact multiple unchanged', () => {
      expect(roundUpMs(600, 100)).toBe(600);
    });
    it('never rounds down', () => {
      expect(roundUpMs(1840, 100)).toBeGreaterThanOrEqual(1840);
    });
  });

  describe('summarize', () => {
    it('reports median + a conservative displayMs ≥ median', () => {
      const s = summarize([610, 620, 600]);
      expect(s.status).toBe('measured');
      expect(s.count).toBe(3);
      expect(s.median).toBe(610);
      expect(s.displayMs).toBeGreaterThanOrEqual(s.median);
    });
  });

  describe('buildArtifact', () => {
    it('emits a measured cold-start metric and records a non-measured install metric (never silently skipped)', () => {
      const art = buildArtifact({
        generatedAt: '2026-07-01T00:00:00.000Z',
        runs: 3,
        coldStartSamples: [610, 620, 600],
        install: { status: 'requires proxy' },
      });
      expect(art.schemaVersion).toBe(3);
      expect(art.generatedAt).toBe('2026-07-01T00:00:00.000Z');
      expect(art.runner.runs).toBe(3);
      expect(art.metrics.coldStartToInteractiveMs.status).toBe('measured');
      expect(art.metrics.coldStartToInteractiveMs.median).toBe(610);
      // The install number is ALWAYS present as a record — here, unmeasured.
      expect(art.metrics.npmInstallToFirstViteResponseMs.status).toBe('requires proxy');
      expect(art.metrics.npmInstallToFirstViteResponseMs.median).toBeUndefined();
    });

    it('preserves a note on a non-measured install metric (proxy configured but timed out)', () => {
      const art = buildArtifact({
        generatedAt: '2026-07-01T00:00:00.000Z',
        runs: 1,
        coldStartSamples: [500],
        install: { status: 'unmeasured', note: 'install did not reach first Vite response' },
      });
      const install = art.metrics.npmInstallToFirstViteResponseMs;
      expect(install.status).toBe('unmeasured');
      expect(install.note).toMatch(/Vite response/);
      expect(install.median).toBeUndefined();
    });

    it('emits a measured install metric (median + registryUrl) when samples are given', () => {
      const art = buildArtifact({
        generatedAt: '2026-07-01T00:00:00.000Z',
        runs: 2,
        coldStartSamples: [500, 520],
        install: {
          status: 'measured',
          samples: [1800, 1900],
          registryUrl: 'https://registry.rifty.dev',
        },
      });
      const install = art.metrics.npmInstallToFirstViteResponseMs;
      expect(install.status).toBe('measured');
      expect(install.median).toBe(1850);
      expect(install.displayMs).toBeGreaterThanOrEqual(1850);
      expect(install.registryUrl).toBe('https://registry.rifty.dev');
    });

    it('nests the standard baseline + a measured speedup when an eddy pass ran', () => {
      const art = buildArtifact({
        generatedAt: '2026-07-01T00:00:00.000Z',
        runs: 5,
        coldStartSamples: [700, 690],
        install: {
          status: 'measured',
          samples: [2521, 2525, 2523], // eddy = primary/top-level
          registryUrl: 'https://registry.rifty.dev/npm-registry',
          resolverUrl: 'https://eddy.rifty.dev',
          baselineSamples: [4276, 4283, 4533], // standard
        },
      });
      const install = art.metrics.npmInstallToFirstViteResponseMs;
      expect(install.status).toBe('measured');
      expect(install.median).toBe(2523); // top-level = eddy (the fast path)
      expect(install.resolverUrl).toBe('https://eddy.rifty.dev');
      expect(install.baseline.label).toBe('standard');
      expect(install.baseline.median).toBe(4283);
      // speedup = standard median ÷ eddy median = 4283 / 2523 ≈ 1.70
      expect(install.speedupX).toBe(1.7);
    });
  });

  describe('preset-boot metric (instant preset pick→preview-live, no npm in the path)', () => {
    const BASE = {
      generatedAt: '2026-07-02T00:00:00.000Z',
      runs: 3,
      coldStartSamples: [1, 2, 3],
      install: { status: 'requires proxy' },
    };

    it('summarizes measured preset-boot samples with per-stage medians', () => {
      const art = buildArtifact({
        ...BASE,
        presetBoot: [
          {
            presetId: 'project-files',
            samples: [2500, 2400, 2700],
            stageRuns: [
              { interactiveMs: 700, viteReadyMs: 2100 },
              { interactiveMs: 650, viteReadyMs: 2000 },
              { interactiveMs: 720, viteReadyMs: 2280 },
            ],
          },
        ],
      });
      const [m] = art.metrics.presetBootToPreviewLiveMs;
      expect(m.presetId).toBe('project-files');
      expect(m.status).toBe('measured');
      expect(m.median).toBe(2500);
      expect(m.displayMs).toBe(2500);
      expect(m.stages).toEqual({ interactiveMs: 700, viteReadyMs: 2100 });
    });

    it('a stage missing in ANY run aggregates to null (no thin stage medians)', () => {
      const art = buildArtifact({
        ...BASE,
        runs: 2,
        presetBoot: [
          {
            presetId: 'p',
            samples: [100, 200],
            stageRuns: [
              { interactiveMs: 10, viteReadyMs: 90 },
              { interactiveMs: 12, viteReadyMs: null },
            ],
          },
        ],
      });
      expect(art.metrics.presetBootToPreviewLiveMs[0].stages).toEqual({
        interactiveMs: 11,
        viteReadyMs: null,
      });
    });

    it('records an unmeasured preset verbatim (never a partial median)', () => {
      const art = buildArtifact({
        ...BASE,
        presetBoot: [{ presetId: 'p', status: 'unmeasured', note: 'only 1/2 runs went live' }],
      });
      expect(art.metrics.presetBootToPreviewLiveMs[0]).toEqual({
        presetId: 'p',
        status: 'unmeasured',
        note: 'only 1/2 runs went live',
      });
    });

    it('a PARTIAL measured sample set (fewer samples than runs) degrades to unmeasured', () => {
      // Contract lives in the CORE, not only the harness: summarizing 2/3
      // samples would publish a launch-citable thin median.
      const art = buildArtifact({
        ...BASE,
        presetBoot: [
          {
            presetId: 'p',
            samples: [100, 200],
            stageRuns: [{ interactiveMs: 10 }, { interactiveMs: 12 }],
          },
        ],
      });
      const [m] = art.metrics.presetBootToPreviewLiveMs;
      expect(m.status).toBe('unmeasured');
      expect(m.note).toContain('2/3');
      expect(m.median).toBeUndefined();
    });

    it('a stageRuns count that disagrees with samples also degrades to unmeasured', () => {
      const art = buildArtifact({
        ...BASE,
        presetBoot: [
          {
            presetId: 'p',
            samples: [100, 200, 300],
            stageRuns: [{ interactiveMs: 10 }, { interactiveMs: 12 }],
          },
        ],
      });
      expect(art.metrics.presetBootToPreviewLiveMs[0].status).toBe('unmeasured');
    });

    it('omits the key when the phase did not run, records an explicit skip when told to', () => {
      expect(buildArtifact(BASE).metrics.presetBootToPreviewLiveMs).toBeUndefined();
      const skipped = buildArtifact({
        ...BASE,
        presetBoot: { status: 'skipped', note: '--presets none' },
      });
      expect(skipped.metrics.presetBootToPreviewLiveMs).toEqual({
        status: 'skipped',
        note: '--presets none',
      });
    });

    it('bumps the schema version for the new metric', () => {
      expect(SCHEMA_VERSION).toBe(3);
    });
  });
});

const SHADOW_ASSET_CACHE_REGIME = 'fresh-context-empty-store-and-tarball;warm-proxy-origin';
const SHADOW_ASSET_DIGEST = 'a'.repeat(64);
const SHADOW_ASSET_MEMBER_BYTES = 13_918_738;

function shadowAssetRun(durationMs, overrides = {}) {
  return {
    durationMs,
    requiredSetDigest: SHADOW_ASSET_DIGEST,
    storageClass: 'opfs-persisted',
    fillTransport: 'standard',
    fillCache: 'network',
    memberBytes: SHADOW_ASSET_MEMBER_BYTES,
    responseBodyBytes: {
      packumentDecoded: 650,
      tarball: 5_057_200,
      total: 5_057_850,
    },
    transport: {
      mode: 'auto',
      origins: {
        'https://registry.example': { protocol: 'h2', requests: 2 },
      },
    },
    ...overrides,
  };
}

function eddyShadowAssetRun(durationMs, overrides = {}) {
  return {
    durationMs,
    requiredSetDigest: SHADOW_ASSET_DIGEST,
    storageClass: 'opfs-persisted',
    fillTransport: 'eddy',
    fillCache: 'bundle',
    memberBytes: SHADOW_ASSET_MEMBER_BYTES,
    responseBodyBytes: {
      bundle: 5_058_900,
      total: 5_058_900,
    },
    transport: {
      mode: 'auto',
      origins: {
        'https://eddy.example': { protocol: 'h2', requests: 1 },
      },
    },
    ...overrides,
  };
}

function shadowAssetArtifact(standard, eddy) {
  return buildArtifact({
    generatedAt: '2026-07-18T00:00:00.000Z',
    runs: 5,
    coldStartSamples: [1, 2, 3, 4, 5],
    install: { status: 'requires proxy' },
    shadowAssetCold: {
      standard,
      ...(eddy === undefined ? {} : { eddy }),
    },
    stepMs: 100,
  });
}

function measuredShadowAssetRow(runs, overrides = {}) {
  return {
    status: 'measured',
    registryUrl: 'https://registry.example/npm-registry',
    cacheRegime: SHADOW_ASSET_CACHE_REGIME,
    runs,
    ...overrides,
  };
}

describe('schema-v3 shadowAssetColdFillMs', () => {
  it('always reserves standard as an explicit unmeasured row when the phase is off', () => {
    const artifact = buildArtifact({
      generatedAt: '2026-07-18T00:00:00.000Z',
      runs: 5,
      coldStartSamples: [1, 2, 3, 4, 5],
      install: { status: 'requires proxy' },
    });

    expect(artifact.schemaVersion).toBe(3);
    expect(artifact.metrics.shadowAssetColdFillMs).toEqual({
      standard: { status: 'unmeasured', note: '--shadow-asset-cold off' },
    });
  });

  it('derives exactly five samples, median, display, and uniform facts from complete runs', () => {
    const runs = [511, 409, 455, 477, 433].map((duration) => shadowAssetRun(duration));
    const row = shadowAssetArtifact(measuredShadowAssetRow(runs)).metrics.shadowAssetColdFillMs
      .standard;

    expect(row).toMatchObject({
      status: 'measured',
      count: 5,
      samples: [511, 409, 455, 477, 433],
      median: 455,
      displayMs: 500,
      requiredSetDigest: SHADOW_ASSET_DIGEST,
      storageClass: 'opfs-persisted',
      fillTransport: 'standard',
      fillCache: 'network',
      memberBytes: SHADOW_ASSET_MEMBER_BYTES,
      registryUrl: 'https://registry.example/npm-registry',
      cacheRegime: SHADOW_ASSET_CACHE_REGIME,
    });
    expect(row.runs.map((run) => run.durationMs)).toEqual(row.samples);
  });

  it('refuses four-of-five as one unmeasured row with no partial samples or median', () => {
    const row = shadowAssetArtifact(
      measuredShadowAssetRow([100, 110, 120, 130].map((duration) => shadowAssetRun(duration))),
    ).metrics.shadowAssetColdFillMs.standard;

    expect(row).toEqual({
      status: 'unmeasured',
      note: expect.stringMatching(/exactly 5.*received 4/i),
    });
    expect(row.samples).toBeUndefined();
    expect(row.median).toBeUndefined();
  });

  it.each([
    [
      'mixed digest',
      (runs) => runs.with(4, shadowAssetRun(140, { requiredSetDigest: 'b'.repeat(64) })),
    ],
    [
      'mixed storage',
      (runs) => runs.with(4, shadowAssetRun(140, { storageClass: 'memory-session' })),
    ],
    ['wrong cache', (runs) => runs.with(4, shadowAssetRun(140, { fillCache: 'storage' }))],
    ['wrong source', (runs) => runs.with(4, shadowAssetRun(140, { fillTransport: 'eddy' }))],
  ])('refuses %s instead of aggregating heterogeneous evidence', (_name, mutate) => {
    const runs = [100, 110, 120, 130, 140].map((duration) => shadowAssetRun(duration));
    const row = shadowAssetArtifact(measuredShadowAssetRow(mutate(runs))).metrics
      .shadowAssetColdFillMs.standard;

    expect(row.status).toBe('unmeasured');
    expect(row.samples).toBeUndefined();
  });

  it.each([
    [
      'unsafe response bytes',
      shadowAssetRun(100, {
        responseBodyBytes: {
          packumentDecoded: Number.MAX_SAFE_INTEGER + 1,
          tarball: 1,
          total: Number.MAX_SAFE_INTEGER + 2,
        },
      }),
    ],
    [
      'impossible response total',
      shadowAssetRun(100, {
        responseBodyBytes: { packumentDecoded: 650, tarball: 5_057_200, total: 5_000_000 },
      }),
    ],
    ['wrong member size', shadowAssetRun(100, { memberBytes: SHADOW_ASSET_MEMBER_BYTES - 1 })],
    [
      'unknown protocol on a used origin',
      shadowAssetRun(100, {
        transport: {
          mode: 'auto',
          origins: { 'https://registry.example': { protocol: 'unknown', requests: 2 } },
        },
      }),
    ],
    [
      'no used remote origin',
      shadowAssetRun(100, {
        transport: {
          mode: 'auto',
          origins: { 'https://registry.example': { protocol: 'h2', requests: 0 } },
        },
      }),
    ],
  ])('refuses corrupt proof: %s', (_name, corrupt) => {
    const runs = [corrupt, ...[110, 120, 130, 140].map((duration) => shadowAssetRun(duration))];
    const row = shadowAssetArtifact(measuredShadowAssetRow(runs)).metrics.shadowAssetColdFillMs
      .standard;

    expect(row.status).toBe('unmeasured');
    expect(row.runs).toBeUndefined();
  });

  it('preserves explicit unmeasured evidence without leaking stale measured fields', () => {
    expect(
      shadowAssetArtifact({
        status: 'unmeasured',
        note: 'run 3 capability progress duplicated verify',
        samples: [1, 2],
      }).metrics.shadowAssetColdFillMs.standard,
    ).toEqual({
      status: 'unmeasured',
      note: 'run 3 capability progress duplicated verify',
    });
  });

  it('emits speedupX only for two complete matched measured rows', () => {
    const standardRuns = [500, 510, 520, 530, 540].map((duration) => shadowAssetRun(duration));
    const eddyRuns = [250, 255, 260, 265, 270].map((duration) => eddyShadowAssetRun(duration));
    const matched = shadowAssetArtifact(
      measuredShadowAssetRow(standardRuns),
      measuredShadowAssetRow(eddyRuns, {
        resolverUrl: 'https://eddy.example',
      }),
    ).metrics.shadowAssetColdFillMs;
    expect(matched.speedupX).toBe(2);
    expect(matched.eddy).toMatchObject({
      status: 'measured',
      fillTransport: 'eddy',
      fillCache: 'bundle',
    });
    expect(matched.eddy.runs[0].responseBodyBytes).toEqual({
      bundle: 5_058_900,
      total: 5_058_900,
    });

    const incomplete = shadowAssetArtifact(measuredShadowAssetRow(standardRuns), {
      status: 'unmeasured',
      note: 'Eddy bundle missed one asset',
    }).metrics.shadowAssetColdFillMs;
    expect(incomplete.speedupX).toBeUndefined();
  });

  it.each([
    [
      'requiredSetDigest',
      (runs) =>
        measuredShadowAssetRow(
          runs.map((run) => ({ ...run, requiredSetDigest: 'b'.repeat(64) })),
          { resolverUrl: 'https://eddy.example' },
        ),
    ],
    [
      'storageClass',
      (runs) =>
        measuredShadowAssetRow(
          runs.map((run) => ({ ...run, storageClass: 'memory-session' })),
          { resolverUrl: 'https://eddy.example' },
        ),
    ],
    [
      'memberBytes',
      (runs) =>
        measuredShadowAssetRow(
          runs.map((run) => ({ ...run, memberBytes: SHADOW_ASSET_MEMBER_BYTES - 1 })),
          { resolverUrl: 'https://eddy.example' },
        ),
    ],
    [
      'cacheRegime',
      (runs) =>
        measuredShadowAssetRow(runs, {
          resolverUrl: 'https://eddy.example',
          cacheRegime: 'fresh-context-empty-store-and-tarball;cold-proxy-origin',
        }),
    ],
  ])(
    'refuses an unmatched Eddy %s boundary while preserving standard verbatim',
    (field, eddyInput) => {
      const standardInput = measuredShadowAssetRow(
        [500, 510, 520, 530, 540].map((duration) => shadowAssetRun(duration)),
      );
      const preservedStandard =
        shadowAssetArtifact(standardInput).metrics.shadowAssetColdFillMs.standard;
      const eddyRuns = [250, 255, 260, 265, 270].map((duration) => eddyShadowAssetRun(duration));
      const metric = shadowAssetArtifact(standardInput, eddyInput(eddyRuns)).metrics
        .shadowAssetColdFillMs;

      expect(JSON.stringify(metric.standard)).toBe(JSON.stringify(preservedStandard));
      expect(metric.eddy).toEqual({
        status: 'unmeasured',
        note: expect.stringMatching(new RegExp(`match.*standard boundary.*${field}`, 'i')),
      });
      expect(metric.speedupX).toBeUndefined();
    },
  );

  it('refuses registry-shaped bytes or registry-only traffic as Eddy evidence', () => {
    const standardRuns = [500, 510, 520, 530, 540].map((duration) => shadowAssetRun(duration));
    const registryShaped = [250, 255, 260, 265, 270].map((duration) =>
      shadowAssetRun(duration, { fillTransport: 'eddy' }),
    );
    const metric = shadowAssetArtifact(
      measuredShadowAssetRow(standardRuns),
      measuredShadowAssetRow(registryShaped, { resolverUrl: 'https://eddy.example' }),
    ).metrics.shadowAssetColdFillMs;

    expect(metric.eddy).toEqual({
      status: 'unmeasured',
      note: expect.stringMatching(/fillCache must be bundle|bundle response/i),
    });
    expect(metric.speedupX).toBeUndefined();
  });

  it('requires every measured Eddy run to use its configured resolver or bundle origin', () => {
    const standardRuns = [500, 510, 520, 530, 540].map((duration) => shadowAssetRun(duration));
    const wrongOrigin = [250, 255, 260, 265, 270].map((duration) =>
      eddyShadowAssetRun(duration, {
        transport: {
          mode: 'auto',
          origins: { 'https://other.example': { protocol: 'h2', requests: 1 } },
        },
      }),
    );
    const metric = shadowAssetArtifact(
      measuredShadowAssetRow(standardRuns),
      measuredShadowAssetRow(wrongOrigin, { resolverUrl: 'https://eddy.example' }),
    ).metrics.shadowAssetColdFillMs;

    expect(metric.eddy).toEqual({
      status: 'unmeasured',
      note: expect.stringMatching(/no measured request.*Eddy origin/i),
    });
    expect(metric.speedupX).toBeUndefined();
  });
});

// Transport pin verification (docs/backlog/perf/eddy-http3-cold-validation):
// a pass whose observed evidence contradicts its pinned transport must be
// REFUSED (no median) — a silently-fallen-back h3 pass would quote an h2
// number as h3. Per-run evidence = per-origin { protocol (post-window CDP
// probe), requests (measured-window request count) }. A pin demands POSITIVE
// protocol proof for every origin the run actually used (requests > 0);
// unused origins are recorded, never enforced.
describe('verifyTransportPin', () => {
  const run = (eddy, registry) => ({
    'https://eddy.example': eddy,
    'https://registry.example': registry,
  });
  const used = (protocol) => ({ protocol, requests: 3 });
  const unused = (protocol) => ({ protocol, requests: 0 });

  it('auto: always ok — evidence recorded, nothing pinned', () => {
    expect(verifyTransportPin('auto', [run(used('h2'), used('h3'))]).ok).toBe(true);
  });

  it('h3 pin: ok when every USED origin in every run positively probed h3', () => {
    expect(
      verifyTransportPin('h3', [run(used('h3'), used('h3')), run(used('h3'), used('h3'))]).ok,
    ).toBe(true);
  });

  it('h3 pin: a used origin probing h2 refuses the pass, naming origin + protocol', () => {
    const v = verifyTransportPin('h3', [run(used('h3'), used('h3')), run(used('h2'), used('h3'))]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/https:\/\/eddy\.example/);
    expect(v.note).toMatch(/h2/);
  });

  it('h3 pin: a used origin probing unreachable (QUIC blocked) refuses loudly', () => {
    const v = verifyTransportPin('h3', [run(used('unreachable'), used('h3'))]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/unreachable/);
  });

  it('h3 pin: an UNUSED origin with no proof is recorded, not enforced', () => {
    expect(verifyTransportPin('h3', [run(unused('unreachable'), used('h3'))]).ok).toBe(true);
  });

  it('h2 pin: refuses when a used origin negotiated h3 (QUIC leaked past --disable-quic)', () => {
    const v = verifyTransportPin('h2', [run(used('h2'), used('h3'))]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/registry\.example/);
  });

  it('h2 pin: refuses a used origin with NO positive proof (unreachable/unknown)', () => {
    const v = verifyTransportPin('h2', [run(used('unreachable'), used('h2'))]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/unreachable/);
    const u = verifyTransportPin('h2', [run(used('unknown'), used('h2'))]);
    expect(u.ok).toBe(false);
  });

  it('h2 pin: http/1.1 refuses — the artifact would label an h1 run as the h2 leg', () => {
    const v = verifyTransportPin('h2', [run(used('h2'), used('http/1.1'))]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/http\/1\.1/);
  });

  it('a pin with no evidence at all is refused (no run ever probed)', () => {
    expect(verifyTransportPin('h3', []).ok).toBe(false);
  });
});

describe('buildArtifact — transport evidence', () => {
  it('a measured install carries the transport record verbatim (incl. per-run audit list)', () => {
    const art = buildArtifact({
      generatedAt: '2026-07-01T00:00:00.000Z',
      runs: 1,
      coldStartSamples: [600],
      install: {
        status: 'measured',
        samples: [2500],
        registryUrl: 'https://registry.example/npm-registry',
        transport: {
          mode: 'h2',
          originProtocols: { 'https://registry.example': ['h2'] },
          runs: [{ 'https://registry.example': { protocol: 'h2', requests: 41 } }],
        },
      },
    });
    const m = art.metrics.npmInstallToFirstViteResponseMs;
    expect(m.status).toBe('measured');
    expect(m.transport.mode).toBe('h2');
    expect(m.transport.originProtocols['https://registry.example']).toEqual(['h2']);
    expect(m.transport.runs[0]['https://registry.example'].requests).toBe(41);
  });

  it('a refused (unmeasured) install still records the transport evidence', () => {
    const art = buildArtifact({
      generatedAt: '2026-07-01T00:00:00.000Z',
      runs: 1,
      coldStartSamples: [600],
      install: {
        status: 'unmeasured',
        note: 'transport pin violated',
        transport: { mode: 'h3', originProtocols: { 'https://eddy.example': ['h2'] }, runs: [] },
      },
    });
    const m = art.metrics.npmInstallToFirstViteResponseMs;
    expect(m.status).toBe('unmeasured');
    expect(m.transport.mode).toBe('h3');
  });

  it('keeps baseline transport evidence on the baseline metric, not only the eddy headline', () => {
    const art = buildArtifact({
      generatedAt: '2026-07-01T00:00:00.000Z',
      runs: 1,
      coldStartSamples: [600],
      install: {
        status: 'measured',
        samples: [2500],
        baselineSamples: [4300],
        registryUrl: 'https://registry.example/npm-registry',
        resolverUrl: 'https://eddy.example',
        transport: {
          mode: 'auto',
          originProtocols: { 'https://eddy.example': ['h2'] },
          runs: [{ 'https://eddy.example': { protocol: 'h2', requests: 1 } }],
        },
        baselineTransport: {
          mode: 'auto',
          originProtocols: { 'https://registry.example': ['h2'] },
          runs: [{ 'https://registry.example': { protocol: 'h2', requests: 50 } }],
        },
      },
    });
    const m = art.metrics.npmInstallToFirstViteResponseMs;
    expect(m.transport.runs[0]['https://eddy.example'].requests).toBe(1);
    expect(m.baseline.transport.runs[0]['https://registry.example'].requests).toBe(50);
  });

  it('carries a per-transport matrix with phase-local evidence and keeps the headline on auto', () => {
    const art = buildArtifact({
      generatedAt: '2026-07-01T00:00:00.000Z',
      runs: 1,
      coldStartSamples: [600],
      install: {
        status: 'measured',
        samples: [2500],
        baselineSamples: [4250],
        registryUrl: 'https://registry.example/npm-registry',
        resolverUrl: 'https://eddy.example',
        transportMatrix: {
          auto: {
            standard: {
              status: 'measured',
              samples: [4250],
              registryUrl: 'https://registry.example/npm-registry',
              transport: {
                mode: 'auto',
                originProtocols: { 'https://registry.example': ['h2'] },
                runs: [{ 'https://registry.example': { protocol: 'h2', requests: 50 } }],
              },
            },
            eddy: {
              status: 'measured',
              samples: [2500],
              resolverUrl: 'https://eddy.example',
              transport: {
                mode: 'auto',
                originProtocols: { 'https://eddy.example': ['h2'] },
                runs: [{ 'https://eddy.example': { protocol: 'h2', requests: 1 } }],
              },
            },
          },
          h2: {
            standard: { status: 'measured', samples: [4300] },
            eddy: { status: 'measured', samples: [2600] },
          },
          h3: {
            standard: { status: 'unmeasured', note: 'transport pinned to h3 but unreachable' },
            eddy: { status: 'unmeasured', note: 'transport pinned to h3 but unreachable' },
          },
        },
      },
    });
    const m = art.metrics.npmInstallToFirstViteResponseMs;
    expect(m.median).toBe(2500);
    expect(m.baseline.median).toBe(4250);
    expect(m.speedupX).toBe(1.7);
    expect(
      m.transportMatrix.auto.standard.transport.runs[0]['https://registry.example'].requests,
    ).toBe(50);
    expect(m.transportMatrix.auto.eddy.transport.runs[0]['https://eddy.example'].requests).toBe(1);
    expect(m.transportMatrix.h2.speedupX).toBe(1.65);
    expect(m.transportMatrix.h3.standard.status).toBe('unmeasured');
    expect(m.transportMatrix.h3.eddy.status).toBe('unmeasured');
  });
});

describe('verifyEddyInstallProof', () => {
  it('accepts the terminal line emitted only when install() returned source=eddy', () => {
    const proof = verifyEddyInstallProof(
      '$ npm install\nnpm: installed 17 package(s) in 1.2s via eddy (fast)\n$ vite\n',
    );
    expect(proof.ok).toBe(true);
  });

  it('refuses a resolver-configured run that fell back to standard install', () => {
    const proof = verifyEddyInstallProof(
      '$ npm install\nnpm: fast install (eddy) unavailable, using standard install\nnpm: installed 17 package(s) in 3.8s\n$ vite\n',
    );
    expect(proof.ok).toBe(false);
    expect(proof.note).toMatch(/without terminal proof/);
  });
});

describe('verifyTransportPin — vacuous-proof guard (per run)', () => {
  const zero = {
    'https://eddy.example': { protocol: 'h2', requests: 0 },
    'https://registry.example': { protocol: 'h2', requests: 0 },
  };
  const usedRun = {
    'https://eddy.example': { protocol: 'h2', requests: 0 },
    'https://registry.example': { protocol: 'h2', requests: 12 },
  };

  it('refuses a pinned pass whose runs never hit any measured origin (no request proof at all)', () => {
    const v = verifyTransportPin('h2', [zero, zero]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/no measured-window request/);
  });

  it('refuses when ANY single run has no measured-origin request (per-run proof, not merged)', () => {
    const v = verifyTransportPin('h2', [usedRun, zero]);
    expect(v.ok).toBe(false);
    expect(v.note).toMatch(/no measured-window request/);
  });

  it('accepts when every run proves at least one used origin', () => {
    expect(verifyTransportPin('h2', [usedRun, usedRun]).ok).toBe(true);
  });
});
