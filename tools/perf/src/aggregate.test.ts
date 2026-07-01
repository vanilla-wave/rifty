import { describe, expect, it } from 'vitest';
// The pure core is `.mjs` so `../bench.mjs` (a zero-dep node runner) imports it
// directly; the unit suite drives it here.
import { buildArtifact, median, roundUpMs, summarize } from './aggregate.mjs';

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
      expect(art.schemaVersion).toBe(1);
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
  });
});
