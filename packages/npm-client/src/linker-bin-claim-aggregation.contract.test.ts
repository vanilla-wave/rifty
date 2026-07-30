import { expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import {
  type PackageBinClaim,
  type PackageBinSource,
  type PreparedInstallPackage,
  type ResolvedPackage,
  preflightPackageInstallPaths,
} from './linker.ts';

type Normalizer = (sources: readonly PackageBinSource[]) => readonly PackageBinClaim[];
type MissingNormalizer = (
  sources: readonly (PackageBinSource | ResolvedPackage | PackageBinClaim)[],
) => readonly PackageBinClaim[];
type NormalizeExport = typeof linker extends { normalizePackageBinSources: infer TExport }
  ? Extract<TExport, (...args: never[]) => unknown>
  : MissingNormalizer;

function proveTypes(
  normalize: NormalizeExport,
  prepared: PreparedInstallPackage,
  narrow: PackageBinSource,
  raw: ResolvedPackage,
  claim: PackageBinClaim,
): void {
  const claims: readonly PackageBinClaim[] = normalize([prepared, narrow] as const);
  // @ts-expect-error Contract: raw resolved-package lists are not bin sources.
  normalize([raw]);
  // @ts-expect-error Contract: shaped output-claim lists are not bin sources.
  normalize([claim]);
  void claims;
}
void proveTypes;
function requireNormalizer(): Normalizer {
  const normalize = (linker as unknown as { normalizePackageBinSources?: Normalizer })
    .normalizePackageBinSources;
  expect(normalize, 'normalizePackageBinSources package-private linker seam').toBeTypeOf(
    'function',
  );
  if (!normalize) throw new Error('Contract RED: linker is missing normalizePackageBinSources');
  return normalize;
}

function observedPackage(
  name: string,
  bin: string | Record<string, string>,
  onRead: () => void,
): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    dependencies: {},
    files: {},
    get bin() {
      onRead();
      return bin;
    },
  };
}

it('keeps the claim aggregator package-private', () => {
  expect(npmClientRoot).not.toHaveProperty('normalizePackageBinSources');
});
it('returns no claims for an empty readonly source list', () => {
  expect(requireNormalizer()([] as const)).toEqual([]);
});

it('[fault: observable-order][fault: lossy-aggregate][fault: sibling-drift] preserves exact mixed claims once', () => {
  const reads = { middle: 0, zeta: 0, alpha: 0 };
  const [middle] = preflightPackageInstallPaths([
    observedPackage(
      'middle',
      { middle: './bin/middle.js', shared: 'bin/shared.js', alpha: './bin/alpha.js' },
      () => reads.middle++,
    ),
  ]);
  if (!middle) throw new Error('Contract fixture: prepared package missing');
  const sources: readonly PackageBinSource[] = [
    middle,
    {
      package: observedPackage('@zeta/tool', './bin/tool.js', () => reads.zeta++),
      nodeModulesDir: 'node_modules/host/node_modules',
    },
    {
      package: observedPackage('alpha', { shared: './bin/alpha.js' }, () => reads.alpha++),
      nodeModulesDir: 'node_modules',
    },
  ];

  expect(JSON.stringify(requireNormalizer()(sources))).toBe(
    '[{"nodeModulesDir":"node_modules","command":"middle","owner":"middle","target":"bin/middle.js"},{"nodeModulesDir":"node_modules","command":"shared","owner":"middle","target":"bin/shared.js"},{"nodeModulesDir":"node_modules","command":"alpha","owner":"middle","target":"bin/alpha.js"},{"nodeModulesDir":"node_modules/host/node_modules","command":"tool","owner":"@zeta/tool","target":"bin/tool.js"},{"nodeModulesDir":"node_modules","command":"shared","owner":"alpha","target":"bin/alpha.js"}]',
  );
  expect(reads).toEqual({ middle: 1, zeta: 1, alpha: 1 });
});
it('[fault: corrupt-input][fault: observable-order][fault: sibling-drift] preserves later errors and unread suffixes', () => {
  const normalize = requireNormalizer();
  for (const [target, bin] of [
    ['../escape.js', '../escape.js'],
    ['/absolute.js', { valid: './bin/valid.js', bad: '/absolute.js' }],
  ] as const) {
    const reads = { prefix: 0, invalid: 0, following: 0 };
    const source = (
      key: keyof typeof reads,
      value: string | Record<string, string>,
    ): PackageBinSource => ({
      package: observedPackage(key, value, () => reads[key]++),
      nodeModulesDir: 'node_modules',
    });
    expect(() =>
      normalize([
        source('prefix', './bin/prefix.js'),
        source('invalid', bin),
        source('following', './bin/following.js'),
      ]),
    ).toThrowError(new Error(`Invalid package bin target: ${target}`));
    expect(reads).toEqual({ prefix: 1, invalid: 1, following: 0 });
  }
});
