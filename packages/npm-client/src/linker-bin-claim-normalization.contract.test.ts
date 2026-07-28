import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import {
  type PreparedInstallPackage,
  type ResolvedPackage,
  preflightPackageInstallPaths,
} from './linker.ts';

interface PreparedPackageBinSource {
  readonly package: Pick<ResolvedPackage, 'name' | 'bin'>;
  readonly nodeModulesDir: string;
}

interface PackageBinClaim {
  readonly nodeModulesDir: string;
  readonly command: string;
  readonly owner: string;
  readonly target: string;
}

interface PackageBinNormalizationApi {
  preflightPackageBins(
    current: readonly PreparedPackageBinSource[],
    prior?: readonly PreparedPackageBinSource[],
  ): readonly PackageBinClaim[];
}

const contractApi = linker as unknown as Partial<PackageBinNormalizationApi>;

type MissingPreflight = (
  current: readonly (PreparedPackageBinSource | ResolvedPackage | PackageBinClaim)[],
  prior?: readonly PreparedPackageBinSource[],
) => readonly PackageBinClaim[];
type ConditionalExport<TKey extends PropertyKey> = TKey extends keyof typeof linker
  ? Extract<(typeof linker)[TKey], (...args: never[]) => unknown>
  : MissingPreflight;
type PreflightExport = ConditionalExport<'preflightPackageBins'>;

function proveBinSourceTypes(
  preflight: PreflightExport,
  prepared: PreparedInstallPackage,
  narrow: PreparedPackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const preparedClaims: readonly PackageBinClaim[] = preflight([prepared], [narrow]);
  const narrowClaims: readonly PackageBinClaim[] = preflight([narrow], [narrow]);
  // @ts-expect-error Contract: raw resolved packages are not bin sources.
  preflight([raw]);
  // @ts-expect-error Contract: shaped output claims are not bin sources.
  preflight([claim]);
  void preparedClaims;
  void narrowClaims;
}

void proveBinSourceTypes;

function requirePreflight(): PackageBinNormalizationApi['preflightPackageBins'] {
  const candidate = contractApi.preflightPackageBins;
  expect(candidate, 'preflightPackageBins package-private linker seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing preflightPackageBins');
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
  readonly value: PreparedPackageBinSource;
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
  readonly pathReads: () => number;
  readonly binReads: () => number;
}

function observedPackage(
  value: ResolvedPackage,
  bin: NonNullable<ResolvedPackage['bin']>,
): ObservedPackage {
  const installPath = value.installPath;
  let pathReads = 0;
  let binReads = 0;
  Object.defineProperty(value, 'installPath', {
    configurable: true,
    enumerable: true,
    get: () => {
      pathReads += 1;
      if (pathReads > 1) throw new Error('raw package installPath read after path preflight');
      return installPath;
    },
  });
  Object.defineProperty(value, 'bin', {
    configurable: true,
    enumerable: true,
    get: () => {
      binReads += 1;
      if (binReads > 1) throw new Error('prepared package bin normalized more than once');
      return bin;
    },
  });
  return {
    value,
    pathReads: () => pathReads,
    binReads: () => binReads,
  };
}

function expectCollision(error: unknown): void {
  expect.soft(error).toBeInstanceOf(NotImplementedError);
  expect
    .soft((error as NotImplementedError | undefined)?.feature)
    .toBe('npm-client.bin-collision-reify');
}

function expectSyncCollision(run: () => void): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expectCollision(caught);
}

describe('package-bin claim normalization authority', () => {
  it('keeps the normalization seam package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('preflightPackageBins');
  });

  it.each([
    ['root', 'forward', 'node_modules', ['a-a', 'a_a']],
    ['root', 'reverse', 'node_modules', ['a_a', 'a-a']],
    ['nested', 'forward', 'node_modules/host/node_modules', ['a-a', 'a_a']],
    ['nested', 'reverse', 'node_modules/host/node_modules', ['a_a', 'a-a']],
  ] as const)(
    '[fault: frozen-assumption] rejects ambiguous %s claims after one read (%s)',
    (_scope, _order, nodeModulesDir, names) => {
      const preflight = requirePreflight();
      const current = names.map((name) =>
        observedSource(name, nodeModulesDir, { shared: './bin/cli.js' }),
      );

      expectSyncCollision(() => preflight(current.map(({ value }) => value)));
      for (const source of current) expect(source.reads()).toBe(1);
    },
  );

  it('[fault: observable-order] returns equal commands as independent scoped claims', () => {
    const preflight = requirePreflight();
    const root = observedSource('root-cli', 'node_modules', { shared: './bin/root.js' });
    const nested = observedSource('nested-cli', 'node_modules/host/node_modules', {
      shared: './bin/nested.js',
    });

    expect(structuredClone(preflight([root.value, nested.value]))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'shared',
        owner: 'root-cli',
        target: 'bin/root.js',
      },
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'shared',
        owner: 'nested-cli',
        target: 'bin/nested.js',
      },
    ]);
    expect(root.reads()).toBe(1);
    expect(nested.reads()).toBe(1);
  });

  it('[fault: sibling-drift] accepts prepared current packages without raw rereads', () => {
    const preflight = requirePreflight();
    const root = observedPackage(
      pkg('prepared-root', 'node_modules/prepared-root', './bin/root.js'),
      './bin/root.js',
    );
    const nested = observedPackage(
      pkg('prepared-nested', 'node_modules/host/node_modules/prepared-nested', {
        nested: './bin/nested.js',
      }),
      { nested: './bin/nested.js' },
    );
    const prepared = preflightPackageInstallPaths([root.value, nested.value]);

    expect(structuredClone(preflight(prepared))).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'prepared-root',
        owner: 'prepared-root',
        target: 'bin/root.js',
      },
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'nested',
        owner: 'prepared-nested',
        target: 'bin/nested.js',
      },
    ]);
    expect(root.pathReads()).toBe(1);
    expect(nested.pathReads()).toBe(1);
    expect(root.binReads()).toBe(1);
    expect(nested.binReads()).toBe(1);
  });

  it('[fault: observable-order] rejects a prior owner transition after one read', () => {
    const preflight = requirePreflight();
    const current = observedSource('current-cli', 'node_modules', {
      shared: 'bin/current.js',
    });
    const prior = observedSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' });

    expectSyncCollision(() => preflight([current.value], [prior.value]));
    expect(current.reads()).toBe(1);
    expect(prior.reads()).toBe(1);
  });

  it('[fault: frozen-assumption] rejects a recorded prior collision without rereads', () => {
    const preflight = requirePreflight();
    const current = observedSource('provider-a', 'node_modules', { shared: 'bin/a.js' });
    const priorA = observedSource('provider-a', 'node_modules', { shared: 'bin/a.js' });
    const priorZ = observedSource('provider-z', 'node_modules', { shared: 'bin/z.js' });

    expectSyncCollision(() => preflight([current.value], [priorA.value, priorZ.value]));
    expect(current.reads()).toBeLessThanOrEqual(1);
    expect(priorA.reads()).toBe(1);
    expect(priorZ.reads()).toBe(1);
  });

  it('[fault: observable-order] rejects removal of a recorded sole claimant after one read', () => {
    const preflight = requirePreflight();
    const prior = observedSource('prior-cli', 'node_modules', { shared: 'bin/prior.js' });

    expectSyncCollision(() => preflight([], [prior.value]));
    expect(prior.reads()).toBe(1);
  });

  it('[fault: sibling-drift] returns only current string/object targets for stable owners', () => {
    const preflight = requirePreflight();
    const rootCurrent = observedSource('root-cli', 'node_modules', './bin/current-root.js');
    const nestedCurrent = observedSource('nested-cli', 'node_modules/host/node_modules', {
      nested: './bin/current-nested.js',
    });
    const rootPrior = observedSource('root-cli', 'node_modules', 'bin/prior-root.js');
    const nestedPrior = observedSource('nested-cli', 'node_modules/host/node_modules', {
      nested: 'bin/prior-nested.js',
    });

    expect(
      structuredClone(
        preflight([rootCurrent.value, nestedCurrent.value], [rootPrior.value, nestedPrior.value]),
      ),
    ).toEqual([
      {
        nodeModulesDir: 'node_modules',
        command: 'root-cli',
        owner: 'root-cli',
        target: 'bin/current-root.js',
      },
      {
        nodeModulesDir: 'node_modules/host/node_modules',
        command: 'nested',
        owner: 'nested-cli',
        target: 'bin/current-nested.js',
      },
    ]);
    expect(rootCurrent.reads()).toBe(1);
    expect(nestedCurrent.reads()).toBe(1);
    expect(rootPrior.reads()).toBe(1);
    expect(nestedPrior.reads()).toBe(1);
  });

  it.each(['../escape.js', '/absolute.js'] as const)(
    '[fault: corrupt-input] rejects escaping target %s without rereading it',
    (target) => {
      const preflight = requirePreflight();
      const invalid = observedSource('bad-target', 'node_modules', { bad: target });

      expect(() => preflight([invalid.value])).toThrow(/Invalid package bin target/);
      expect(invalid.reads()).toBe(1);
    },
  );
});
