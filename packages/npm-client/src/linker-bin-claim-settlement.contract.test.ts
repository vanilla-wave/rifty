import { NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import type { PackageBinClaim, PackageBinSource } from './linker.ts';

type Preflight = (
  current: readonly PackageBinSource[],
  prior?: readonly PackageBinSource[],
) => readonly PackageBinClaim[];

function requirePreflight(): Preflight {
  const preflight = (linker as unknown as { preflightPackageBins?: Preflight })
    .preflightPackageBins;
  expect(preflight, 'preflightPackageBins package-private linker seam').toBeTypeOf('function');
  if (!preflight) throw new Error('Contract RED: linker is missing preflightPackageBins');
  return preflight;
}

it('keeps settlement private', () =>
  expect(npmClientRoot).not.toHaveProperty('preflightPackageBins'));

function source(
  name: string,
  bin: string | Record<string, string>,
  nodeModulesDir = 'node_modules',
): PackageBinSource {
  return { package: { name, bin }, nodeModulesDir };
}

function claim(
  owner: string,
  command: string,
  target: string,
  nodeModulesDir = 'node_modules',
): PackageBinClaim {
  return { nodeModulesDir, command, owner, target };
}

function expectCollision(run: () => void): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect.soft(caught).toBeInstanceOf(NotImplementedError);
  expect.soft(caught).toMatchObject({ feature: 'npm-client.bin-collision-reify' });
}

it('[fault: observable-order][fault: lossy-aggregate] returns exact current claims for stable owners in independent scopes', () => {
  const preflight = requirePreflight();
  const nestedDir = 'node_modules/host/node_modules';
  const current = [
    source('middle', { middle: './bin/middle.js', shared: './bin/root.js' }),
    source('zeta', { shared: './bin/nested.js' }, nestedDir),
    source('alpha', { fresh: './bin/fresh.js' }),
  ] as const;
  const prior = [
    source('zeta', { shared: './bin/prior-nested.js' }, nestedDir),
    source('middle', { middle: './bin/prior-middle.js', shared: './bin/prior-root.js' }),
  ] as const;

  expect(preflight(current, prior)).toEqual([
    claim('middle', 'middle', 'bin/middle.js'),
    claim('middle', 'shared', 'bin/root.js'),
    claim('zeta', 'shared', 'bin/nested.js', nestedDir),
    claim('alpha', 'fresh', 'bin/fresh.js'),
  ]);
  expect(preflight([source('@scope/new-cli', './bin/new.js', nestedDir)])).toEqual([
    claim('@scope/new-cli', 'new-cli', 'bin/new.js', nestedDir),
  ]);
});

it.each([
  ['root forward', 'node_modules', ['a-cli', 'z-cli'], false],
  ['root reverse', 'node_modules', ['z-cli', 'a-cli'], false],
  ['nested forward', 'node_modules/host/node_modules', ['a-cli', 'z-cli'], true],
  ['nested reverse', 'node_modules/host/node_modules', ['z-cli', 'a-cli'], true],
] as const)(
  '[fault: frozen-assumption][fault: observable-order] rejects current collision: %s',
  (_case, nodeModulesDir, owners, sameTarget) => {
    const preflight = requirePreflight();
    const target = (owner: string) => `./bin/${sameTarget ? 'shared' : owner}.js`;
    expectCollision(() =>
      preflight(owners.map((owner) => source(owner, { shared: target(owner) }, nodeModulesDir))),
    );
  },
);

it.each([
  ['recorded prior collision', ['a-cli'], ['a-cli', 'z-cli']],
  ['recorded prior collision reverse', ['a-cli'], ['z-cli', 'a-cli']],
  ['prior owner transition', ['current-cli'], ['prior-cli']],
  ['recorded prior removal', [], ['prior-cli']],
] as const)(
  '[fault: frozen-assumption][fault: observable-order] rejects %s',
  (_case, currentOwners, priorOwners) => {
    const preflight = requirePreflight();
    const sources = (owners: readonly string[]) =>
      owners.map((owner) => source(owner, { shared: './bin/shared.js' }));
    expectCollision(() => preflight(sources(currentOwners), sources(priorOwners)));
  },
);

it('[fault: lossy-aggregate] rejects one removed command while its owner survives', () => {
  const preflight = requirePreflight();
  const current = source('stable', { kept: './bin/kept.js' });
  const prior = source('stable', { kept: './bin/kept.js', removed: './bin/removed.js' });
  expectCollision(() => preflight([current], [prior]));
});
