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

it('keeps settlement package-private', () => {
  expect(npmClientRoot).not.toHaveProperty('preflightPackageBins');
});

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
  expect
    .soft((caught as NotImplementedError | undefined)?.feature)
    .toBe('npm-client.bin-collision-reify');
}

it('[fault: lossy-aggregate] returns exact current claims for stable owners in independent scopes', () => {
  const preflight = requirePreflight();
  const nestedDir = 'node_modules/host/node_modules';
  const current = [
    source('root-cli', { shared: './bin/current-root.js', fresh: './bin/fresh.js' }),
    source('nested-cli', { shared: './bin/current-nested.js' }, nestedDir),
  ] as const;
  const prior = [
    source('nested-cli', { shared: './bin/prior-nested.js' }, nestedDir),
    source('root-cli', { shared: './bin/prior-root.js' }),
  ] as const;

  expect(preflight(current, prior)).toEqual([
    claim('root-cli', 'shared', 'bin/current-root.js'),
    claim('root-cli', 'fresh', 'bin/fresh.js'),
    claim('nested-cli', 'shared', 'bin/current-nested.js', nestedDir),
  ]);
  expect(preflight([source('new-cli', './bin/new.js')])).toEqual([
    claim('new-cli', 'new-cli', 'bin/new.js'),
  ]);
});

it.each([
  ['root forward', 'node_modules', ['a-cli', 'z-cli']],
  ['root reverse', 'node_modules', ['z-cli', 'a-cli']],
  ['nested forward', 'node_modules/host/node_modules', ['a-cli', 'z-cli']],
  ['nested reverse', 'node_modules/host/node_modules', ['z-cli', 'a-cli']],
] as const)(
  '[fault: frozen-assumption][fault: observable-order] rejects current collision: %s',
  (_case, nodeModulesDir, owners) => {
    const preflight = requirePreflight();
    expectCollision(() =>
      preflight(
        owners.map((owner) => source(owner, { shared: `./bin/${owner}.js` }, nodeModulesDir)),
      ),
    );
  },
);

it.each([
  ['recorded prior collision', ['a-cli'], ['a-cli', 'z-cli']],
  ['prior owner transition', ['current-cli'], ['prior-cli']],
  ['recorded prior removal', [], ['prior-cli']],
] as const)(
  '[fault: frozen-assumption][fault: observable-order] rejects %s',
  (_case, currentOwners, priorOwners) => {
    const preflight = requirePreflight();
    const sources = (owners: readonly string[]) =>
      owners.map((owner) => source(owner, { shared: `./bin/${owner}.js` }));
    expectCollision(() => preflight(sources(currentOwners), sources(priorOwners)));
  },
);
