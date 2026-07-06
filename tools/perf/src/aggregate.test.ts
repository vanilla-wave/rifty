import { describe, expect, it } from 'vitest';
// The pure core is `.mjs` so `../bench.mjs` (a zero-dep node runner) imports it
// directly; the unit suite drives it here.
import {
  SCHEMA_VERSION,
  buildArtifact,
  median,
  roundUpMs,
  summarize,
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
      expect(art.schemaVersion).toBe(2);
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
      expect(SCHEMA_VERSION).toBe(2);
    });
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

  it('h2 pin: positive h1/h2 mixes are ok (the pin only forbids QUIC)', () => {
    expect(verifyTransportPin('h2', [run(used('h2'), used('http/1.1'))]).ok).toBe(true);
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
});
