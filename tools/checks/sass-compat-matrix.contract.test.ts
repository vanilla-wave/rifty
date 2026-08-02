import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const matrixUrl = new URL('../../docs/public/compat/sass-embedded.md', import.meta.url);
const policyUrl = new URL('../shadow-registry/sass-embedded-policy.json', import.meta.url);

interface SassPolicy {
  readonly state: string;
  readonly version: string;
  readonly source: Readonly<{ package: string; version: string }>;
  readonly admission: Readonly<{ kind: string; unsupportedFeature: string }>;
  readonly acquisition: Readonly<{
    dependencies: Readonly<Record<string, string>>;
    optionalDependencies: Readonly<Record<string, string>>;
    omittedOptionalDependencies: Readonly<Record<string, string>>;
    peerDependencies: Readonly<Record<string, string>>;
    bundledDependencies: readonly string[];
    unsupportedFeature: string;
  }>;
  readonly facade: Readonly<{
    cjsOmittedExports: readonly string[];
    esmOmittedExports: readonly string[];
    esmUndefinedExports: readonly string[];
    adaptations: readonly Readonly<{ id: string }>[];
  }>;
  readonly surfaces: readonly Readonly<{ surface: string }>[];
  readonly divergence: Readonly<{ surface: string }>;
  readonly unsupported: readonly Readonly<
    | { surface: string; kind: 'runtime-throw'; feature: string; notes: string }
    | { surface: string; kind: 'not-published'; notes: string }
  >[];
}

async function policy(): Promise<SassPolicy> {
  return JSON.parse(await readFile(policyUrl, 'utf8')) as SassPolicy;
}

describe('sass-embedded public compatibility contract', () => {
  it('pins exact acquisition, the omitted watcher, and every named loud gap', async () => {
    const value = await policy();
    expect(['contract-red', 'final-green']).toContain(value.state);
    expect(value).toMatchObject({
      version: '1.100.0',
      source: { package: 'sass', version: '1.100.0' },
      admission: { kind: 'exact-only', unsupportedFeature: 'sass-embedded.version' },
      acquisition: {
        dependencies: {
          chokidar: '^5.0.0',
          immutable: '^5.1.5',
          'source-map-js': '>=0.6.2 <2.0.0',
        },
        optionalDependencies: {},
        omittedOptionalDependencies: { '@parcel/watcher': '^2.4.1' },
        peerDependencies: {},
        bundledDependencies: [],
        unsupportedFeature: 'sass-embedded.acquisition',
      },
      facade: {
        cjsOmittedExports: ['cli_pkg_main_0_', 'load', 'loadParserExports_'],
        esmOmittedExports: ['parser_'],
        esmUndefinedExports: [
          'CalculationOperator',
          'CustomFunction',
          'ListSeparator',
          'PromiseOr',
        ],
      },
    });
    expect(value.facade.adaptations.map(({ id }) => id)).toEqual([
      'clean-export-namespace',
      'embedded-info',
      'exception-message-prefix',
      'exception-span-url',
      'compiler-dispose-errors',
      'legacy-logger-routing',
    ]);
    expect(
      value.unsupported.flatMap((entry) => (entry.kind === 'runtime-throw' ? [entry.feature] : [])),
    ).toEqual(['sass-embedded.version', 'sass-embedded.cli', 'sass-embedded.watch']);
    expect(value.unsupported.find(({ kind }) => kind === 'not-published')).toMatchObject({
      surface: 'TypeScript declaration surface',
      kind: 'not-published',
      notes: expect.stringContaining('No TypeScript declarations'),
    });
  });

  it('publishes supported rows, the measured divergence, and every explicit failure', async () => {
    const value = await policy();
    expect(value.state).toBe('final-green');
    const matrix = await readFile(matrixUrl, 'utf8').catch(() => '');
    for (const { surface } of value.surfaces) {
      expect(matrix).toContain(`| ${surface} | ✅ |`);
    }
    expect(matrix).toContain(`| ${value.divergence.surface} | ⚠️ |`);
    for (const entry of value.unsupported) {
      expect(matrix).toContain(`| ${entry.surface} | ❌ |`);
      if (entry.kind === 'runtime-throw') {
        expect(matrix).toContain(`NotImplementedError('${entry.feature}')`);
      } else {
        expect(matrix).toContain(entry.notes);
        expect(matrix).not.toContain("NotImplementedError('sass-embedded.types')");
      }
    }
  });
});
