import { describe, expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import {
  type PreparedInstallPackage,
  type ResolvedPackage,
  preflightPackageInstallPaths,
} from './linker.ts';

interface PackageBinSource {
  readonly package: Readonly<Pick<ResolvedPackage, 'name' | 'bin'>>;
  readonly nodeModulesDir: string;
}

interface PackageBinClaim {
  readonly nodeModulesDir: string;
  readonly command: string;
  readonly owner: string;
  readonly target: string;
}

interface PackageBinSourceNormalizationApi {
  normalizePackageBinSources(sources: readonly PackageBinSource[]): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinSourceNormalizationApi>;

type MissingNormalizer = (
  sources: readonly (PackageBinSource | ResolvedPackage | PackageBinClaim)[],
) => readonly PackageBinClaim[];
type ConditionalExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : MissingNormalizer;
type NormalizeExport = ConditionalExport<'normalizePackageBinSources'>;

function proveBinSourceTypes(
  normalize: NormalizeExport,
  prepared: PreparedInstallPackage,
  narrow: PackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const mixed: readonly PackageBinSource[] = [prepared, narrow];
  const mixedClaims: readonly PackageBinClaim[] = normalize(mixed);
  const preparedClaims: readonly PackageBinClaim[] = normalize([prepared]);
  const narrowClaims: readonly PackageBinClaim[] = normalize([narrow]);
  // @ts-expect-error Contract: raw resolved packages are not bin sources.
  normalize([raw]);
  // @ts-expect-error Contract: shaped output claims are not bin sources.
  normalize([claim]);
  void mixedClaims;
  void preparedClaims;
  void narrowClaims;
}

void proveBinSourceTypes;

function requireNormalizer(): PackageBinSourceNormalizationApi['normalizePackageBinSources'] {
  const candidate = contractApi.normalizePackageBinSources;
  expect(candidate, 'normalizePackageBinSources package-private linker seam').toBeTypeOf(
    'function',
  );
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing normalizePackageBinSources');
  }
  return candidate;
}

function pkg(
  name: string,
  installPath: string,
  bin: string | Record<string, string>,
): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    bin,
    files: {},
  };
}

interface ObservedSource {
  readonly value: PackageBinSource;
  readonly reads: () => number;
}

function observedSource(
  name: string,
  nodeModulesDir: string,
  bin: string | Record<string, string>,
): ObservedSource {
  const packageValue: { name: string; bin?: string | Record<string, string> } = { name };
  let reads = 0;
  Object.defineProperty(packageValue, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      if (reads > 1) throw new Error(`${name} bin normalized more than once`);
      return bin;
    },
  });
  return {
    value: { package: packageValue, nodeModulesDir },
    reads: () => reads,
  };
}

interface ObservedPackage {
  readonly value: ResolvedPackage;
  readonly binReads: () => number;
}

function observedPackage(value: ResolvedPackage, bin: NonNullable<ResolvedPackage['bin']>) {
  let reads = 0;
  Object.defineProperty(value, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      reads += 1;
      if (reads > 1) throw new Error(`${value.name} bin normalized more than once`);
      return bin;
    },
  });
  return {
    value,
    binReads: () => reads,
  } satisfies ObservedPackage;
}

describe('package-bin source normalization authority', () => {
  it('keeps the source normalizer package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('normalizePackageBinSources');
  });

  it('[fault: sibling-drift] returns every prepared/narrow claim after one bin read', () => {
    const normalize = requireNormalizer();
    const preparedPackage = observedPackage(
      pkg('multi-cli', 'node_modules/multi-cli', {
        omega: 'bin/omega.js',
        alpha: './bin/alpha.js',
      }),
      {
        omega: 'bin/omega.js',
        alpha: './bin/alpha.js',
      },
    );
    const [prepared] = preflightPackageInstallPaths([preparedPackage.value]);
    if (!prepared) throw new Error('Contract fixture: prepared package missing');
    const nested = observedSource('@scope/tool', 'node_modules/host/node_modules', './bin/tool.js');

    expect(structuredClone(normalize([nested.value, prepared]))).toEqual([
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'tool',
        owner: '@scope/tool',
        target: 'bin/tool.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'omega',
        owner: 'multi-cli',
        target: 'bin/omega.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'alpha',
        owner: 'multi-cli',
        target: 'bin/alpha.js',
      },
    ]);
    expect(preparedPackage.binReads()).toBe(1);
    expect(nested.reads()).toBe(1);
  });

  it('[fault: lossy-aggregate] preserves duplicate claims in source order', () => {
    const normalize = requireNormalizer();
    const first = observedSource('z-cli', 'node_modules', {
      shared: './bin/z.js',
    });
    const second = observedSource('a-cli', 'node_modules', {
      shared: './bin/a.js',
    });

    expect(structuredClone(normalize([first.value, second.value]))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'z-cli',
        target: 'bin/z.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'a-cli',
        target: 'bin/a.js',
      },
    ]);
    expect(first.reads()).toBe(1);
    expect(second.reads()).toBe(1);
  });

  it.each([
    ['object', '../escape.js', { valid: './bin/valid.js', bad: '../escape.js' }],
    ['object', '/absolute.js', { valid: './bin/valid.js', bad: '/absolute.js' }],
    ['string', '../escape.js', '../escape.js'],
    ['string', '/absolute.js', '/absolute.js'],
  ] as const)(
    '[fault: corrupt-input] rejects escaping %s target %s after one bin read',
    (_shape, target, bin) => {
      const normalize = requireNormalizer();
      const prefix = observedSource('prefix-cli', 'node_modules', {
        prefix: './bin/prefix.js',
      });
      const invalid = observedSource('bad-target', 'node_modules', bin);
      let caught: unknown;

      try {
        normalize([prefix.value, invalid.value]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(`Invalid package bin target: ${target}`);
      expect(prefix.reads()).toBe(1);
      expect(invalid.reads()).toBe(1);
    },
  );
});
