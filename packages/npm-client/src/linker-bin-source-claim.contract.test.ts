import { NotImplementedError } from '@riftydev/io';
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

type RawPackageBin = string | readonly string[] | Readonly<Record<string, unknown>>;

interface PackageBinSourceClaimApi {
  normalizePackageBinSource(source: PackageBinSource): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinSourceClaimApi>;

type MissingNormalizer = (
  source: PackageBinSource | ResolvedPackage | PackageBinClaim | readonly PackageBinSource[],
  additional?: PackageBinSource,
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
  // @ts-expect-error Contract: source-list aggregation belongs to its successor.
  normalize([narrow]);
  // @ts-expect-error Contract: one call accepts exactly one source.
  normalize(narrow, prepared);
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

function observedSource(name: string, nodeModulesDir: string, bin: RawPackageBin): ObservedSource {
  const packageValue: { name: string; bin?: RawPackageBin } = { name };
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
    value: {
      package: packageValue as PackageBinSource['package'],
      nodeModulesDir,
    },
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

  it('[fault: observable-order] preserves non-monotonic object command order', () => {
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
    [
      'object traversal',
      { valid: './bin/valid.js', bad: '../escape.js' },
      [
        ['valid', 'bin/valid.js'],
        ['bad', 'escape.js'],
      ],
    ],
    [
      'object absolute',
      { valid: './bin/valid.js', bad: '/absolute.js' },
      [
        ['valid', 'bin/valid.js'],
        ['bad', 'absolute.js'],
      ],
    ],
    ['string traversal', '../escape.js', [['bad-target', 'escape.js']]],
    ['string absolute', '/absolute.js', [['bad-target', 'absolute.js']]],
  ] as const)(
    '[fault: frozen-assumption][fault: corrupt-input] roots %s inside the package after one bin read',
    (_case, bin, expected) => {
      const normalize = requireNormalizer();
      const source = observedSource('bad-target', 'node_modules', bin);

      expect(structuredClone(normalize(source.value))).toEqual(
        expected.map(([command, target]) => ({
          nodeModulesDir: 'node_modules',
          command,
          owner: 'bad-target',
          target,
        })),
      );
      expect(source.reads()).toBe(1);
    },
  );

  it('[fault: corrupt-input] names a non-string array member after one bin read', () => {
    const normalize = requireNormalizer();
    const invalid = observedSource('invalid-array', 'node_modules', [
      'valid.js',
      42,
    ] as unknown as RawPackageBin);
    let caught: unknown;

    try {
      normalize(invalid.value);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
    expect(invalid.reads()).toBe(1);
  });
});
