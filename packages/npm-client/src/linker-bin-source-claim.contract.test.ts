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

interface PackageBinSourceClaimApi {
  normalizePackageBinSource(source: PackageBinSource): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinSourceClaimApi>;

type MissingNormalizer = (
  source: PackageBinSource | ResolvedPackage | PackageBinClaim,
) => readonly PackageBinClaim[];
type ConditionalExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : MissingNormalizer;
type NormalizeExport = ConditionalExport<'normalizePackageBinSource'>;

function proveBinSourceTypes(
  normalize: NormalizeExport,
  prepared: PreparedInstallPackage,
  narrow: PackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const preparedClaims: readonly PackageBinClaim[] = normalize(prepared);
  const narrowClaims: readonly PackageBinClaim[] = normalize(narrow);
  // @ts-expect-error Contract: raw resolved packages are not bin sources.
  normalize(raw);
  // @ts-expect-error Contract: shaped output claims are not bin sources.
  normalize(claim);
  void preparedClaims;
  void narrowClaims;
}

void proveBinSourceTypes;

function requireNormalizer(): PackageBinSourceClaimApi['normalizePackageBinSource'] {
  const candidate = contractApi.normalizePackageBinSource;
  expect(candidate, 'normalizePackageBinSource package-private linker seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing normalizePackageBinSource');
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

describe('package-bin source claim authority', () => {
  it('keeps the source normalizer package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('normalizePackageBinSource');
  });

  it('[fault: lossy-aggregate] preserves non-monotonic object command order', () => {
    const normalize = requireNormalizer();
    const preparedPackage = observedPackage(
      pkg('multi-cli', 'node_modules/multi-cli', {
        middle: './bin/middle.js',
        zeta: 'bin/zeta.js',
        alpha: './bin/alpha.js',
      }),
      {
        middle: './bin/middle.js',
        zeta: 'bin/zeta.js',
        alpha: './bin/alpha.js',
      },
    );
    const [prepared] = preflightPackageInstallPaths([preparedPackage.value]);
    if (!prepared) throw new Error('Contract fixture: prepared package missing');

    expect(structuredClone(normalize(prepared))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'middle',
        owner: 'multi-cli',
        target: 'bin/middle.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'zeta',
        owner: 'multi-cli',
        target: 'bin/zeta.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'alpha',
        owner: 'multi-cli',
        target: 'bin/alpha.js',
      },
    ]);
    expect(preparedPackage.binReads()).toBe(1);
  });

  it('[fault: sibling-drift] normalizes one narrow nested scoped string', () => {
    const normalize = requireNormalizer();
    const nested = observedSource('@scope/tool', 'node_modules/host/node_modules', './bin/tool.js');

    expect(structuredClone(normalize(nested.value))).toEqual([
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'tool',
        owner: '@scope/tool',
        target: 'bin/tool.js',
      },
    ]);
    expect(nested.reads()).toBe(1);
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
      const invalid = observedSource('bad-target', 'node_modules', bin);
      let caught: unknown;

      try {
        normalize(invalid.value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(`Invalid package bin target: ${target}`);
      expect(invalid.reads()).toBe(1);
    },
  );
});
