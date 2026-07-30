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

interface PackageBinClaimAggregationApi {
  normalizePackageBinSources(sources: readonly PackageBinSource[]): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinClaimAggregationApi>;

type MissingNormalizer = (
  sources: readonly PackageBinSource[] | readonly ResolvedPackage[] | readonly PackageBinClaim[],
) => readonly PackageBinClaim[];
type ConditionalExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : MissingNormalizer;
type NormalizeExport = ConditionalExport<'normalizePackageBinSources'>;

function proveAggregationTypes(
  normalize: NormalizeExport,
  prepared: PreparedInstallPackage,
  narrow: PackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const sources = [prepared, narrow] as const satisfies readonly PackageBinSource[];
  const claims: readonly PackageBinClaim[] = normalize(sources);
  // @ts-expect-error Contract: raw resolved-package lists are not bin sources.
  normalize([raw]);
  // @ts-expect-error Contract: shaped output-claim lists are not bin sources.
  normalize([claim]);
  void claims;
}

void proveAggregationTypes;

function requireNormalizer(): PackageBinClaimAggregationApi['normalizePackageBinSources'] {
  const candidate = contractApi.normalizePackageBinSources;
  expect(candidate, 'normalizePackageBinSources package-private linker seam').toBeTypeOf(
    'function',
  );
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing normalizePackageBinSources');
  }
  return candidate;
}

interface ObservedSource<TSource extends PackageBinSource = PackageBinSource> {
  readonly value: TSource;
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

function observedPrepared(
  name: string,
  installPath: string,
  bin: string | Record<string, string>,
): ObservedSource<PreparedInstallPackage> {
  const packageValue: ResolvedPackage = {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    files: {},
  };
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
  const [prepared] = preflightPackageInstallPaths([packageValue]);
  if (!prepared) throw new Error('Contract fixture: prepared package missing');
  return { value: prepared, reads: () => reads };
}

describe('package-bin claim aggregation authority', () => {
  it('keeps the claim aggregator package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('normalizePackageBinSources');
  });

  it('returns no claims for an empty readonly source list', () => {
    const normalize = requireNormalizer();
    const sources = [] as const satisfies readonly PackageBinSource[];

    expect(normalize(sources)).toEqual([]);
  });

  it('[fault: observable-order] preserves three-source and per-source command order', () => {
    const normalize = requireNormalizer();
    const middle = observedPrepared('middle', 'node_modules/middle', {
      middle: './bin/middle.js',
      zeta: 'bin/zeta.js',
      alpha: './bin/alpha.js',
    });
    const zeta = observedSource('zeta', 'node_modules', './bin/zeta.js');
    const alpha = observedSource('alpha', 'node_modules', './bin/alpha.js');
    const sources = [middle.value, zeta.value, alpha.value] as const;

    expect(structuredClone(normalize(sources))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'middle',
        owner: 'middle',
        target: 'bin/middle.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'zeta',
        owner: 'middle',
        target: 'bin/zeta.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'alpha',
        owner: 'middle',
        target: 'bin/alpha.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'zeta',
        owner: 'zeta',
        target: 'bin/zeta.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'alpha',
        owner: 'alpha',
        target: 'bin/alpha.js',
      },
    ]);
    expect([middle.reads(), zeta.reads(), alpha.reads()]).toEqual([1, 1, 1]);
  });

  it('[fault: lossy-aggregate] keeps same-scope duplicate commands separate', () => {
    const normalize = requireNormalizer();
    const first = observedSource('first-owner', 'node_modules', {
      shared: './bin/first.js',
    });
    const second = observedSource('second-owner', 'node_modules', {
      shared: './bin/second.js',
    });

    expect(structuredClone(normalize([first.value, second.value]))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'first-owner',
        target: 'bin/first.js',
      },
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'second-owner',
        target: 'bin/second.js',
      },
    ]);
    expect([first.reads(), second.reads()]).toEqual([1, 1]);
  });

  it.each([
    ['string', '../escape.js', '../escape.js'],
    ['object', '/absolute.js', { valid: './bin/valid.js', bad: '/absolute.js' }],
  ] as const)(
    '[fault: corrupt-input][fault: observable-order][fault: sibling-drift] preserves later %s source error %s',
    (_shape, target, bin) => {
      const normalize = requireNormalizer();
      const prefix = observedSource('prefix', 'node_modules', './bin/prefix.js');
      const invalid = observedSource('invalid', 'node_modules', bin);
      const following = observedSource('following', 'node_modules', './bin/following.js');
      let caught: unknown;

      try {
        normalize([prefix.value, invalid.value, following.value]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(`Invalid package bin target: ${target}`);
      expect([prefix.reads(), invalid.reads(), following.reads()]).toEqual([1, 1, 0]);
    },
  );
});
