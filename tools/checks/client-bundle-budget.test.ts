import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUNDLE_BUDGETS, assertClientBundleBudgets } from './client-bundle-budget.mjs';

const evidence = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/backlog/toolchain-build/reference/client-bundle-budget-evidence.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  historical: Snapshot;
  cleaned: Snapshot;
};
interface Snapshot {
  report: {
    rows: Array<{ name: string; min: number; gzip: number; eager: string[]; compiler: string[] }>;
  };
  boot: { rows: Array<{ name: string; requests: string[] }> };
}

describe('CI client bundle budgets against real packed reports', () => {
  it('admits cleaned artifacts with at least 50% headroom', () => {
    expect(Object.keys(CLIENT_BUNDLE_BUDGETS)).toEqual(['main', 'sw', 'generic', 'toolchain']);
    const { report, boot } = evidence.cleaned;
    expect(() => assertClientBundleBudgets(report, boot)).not.toThrow();
    for (const [name, limits] of Object.entries(CLIENT_BUNDLE_BUDGETS)) {
      const row = report.rows.find((row) => row.name === name);
      expect(row).toBeDefined();
      expect(limits.min).toBeGreaterThanOrEqual((row?.min ?? Number.POSITIVE_INFINITY) * 1.5);
      expect(limits.gzip).toBeGreaterThanOrEqual((row?.gzip ?? Number.POSITIVE_INFINITY) * 1.5);
    }
  });

  it('rejects every historical io/TypeScript leak on both byte metrics and preserves compiler guard', () => {
    const { report, boot } = evidence.historical;
    for (const name of Object.keys(CLIENT_BUNDLE_BUDGETS)) {
      for (const metric of ['min', 'gzip']) {
        expect(() => assertClientBundleBudgets(report, boot)).toThrow(`${name}: ${metric} `);
      }
    }
    for (const name of ['generic', 'toolchain']) {
      expect(() => assertClientBundleBudgets(report, boot)).toThrow(`${name}: TypeScript compiler`);
    }
  });

  it('rejects missing artifacts, provenance and boot observations', () => {
    for (const name of Object.keys(CLIENT_BUNDLE_BUDGETS)) {
      const { report, boot } = structuredClone(evidence.cleaned);
      report.rows = report.rows.filter((row) => row.name !== name);
      expect(() => assertClientBundleBudgets(report, boot)).toThrow(
        `${name}: expected one artifact`,
      );
    }
    for (const name of ['generic', 'toolchain']) {
      const { report, boot } = structuredClone(evidence.cleaned);
      for (const row of report.rows) if (row.name === name) row.compiler = [];
      expect(() => assertClientBundleBudgets(report, boot)).toThrow(
        `${name}: missing compiler provenance`,
      );
      expect(() =>
        assertClientBundleBudgets(evidence.cleaned.report, {
          rows: boot.rows.filter((row) => row.name !== name),
        }),
      ).toThrow(`${name}: missing browser boot observation`);
    }
  });

  it('rejects undercounting an actually requested QuickJS bootstrap JS output', () => {
    const { report, boot } = structuredClone(evidence.cleaned);
    const generic = report.rows.find((row) => row.name === 'generic');
    const dynamic = generic?.eager.find((path) => path.includes('emscripten-module.browser'));
    expect(dynamic).toBeDefined();
    if (!generic || !dynamic) throw new Error('Recorded QuickJS JS bootstrap missing');
    generic.eager = generic.eager.filter((path) => path !== dynamic);
    expect(() => assertClientBundleBudgets(report, boot)).toThrow(`unaccounted boot JS ${dynamic}`);
  });
});
