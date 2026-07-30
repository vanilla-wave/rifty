import { expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import type { PackageBinClaim, PackageBinSource } from './linker.ts';
type Normalizer = (sources: readonly PackageBinSource[]) => readonly PackageBinClaim[];
function source(
  name: string,
  bin: string | Record<string, string>,
  nodeModulesDir: string,
  onRead: () => void,
): PackageBinSource {
  return {
    package: {
      name,
      get bin() {
        onRead();
        return bin;
      },
    },
    nodeModulesDir,
  };
}
it('[fault: observable-order][fault: lossy-aggregate][fault: sibling-drift][fault: corrupt-input] normalizes exact readonly source lists', () => {
  expect(npmClientRoot).not.toHaveProperty('normalizePackageBinSources');
  const normalize = (linker as unknown as { normalizePackageBinSources?: Normalizer })
    .normalizePackageBinSources;
  expect(normalize, 'normalizePackageBinSources package-private linker seam').toBeTypeOf(
    'function',
  );
  if (!normalize) throw new Error('Contract RED: linker is missing normalizePackageBinSources');
  expect(normalize([] as const)).toEqual([]);
  const reads = { middle: 0, zeta: 0, alpha: 0 };
  const sources = [
    source(
      'middle',
      { middle: './bin/middle.js', shared: 'bin/shared.js', alpha: './bin/alpha.js' },
      'node_modules',
      () => reads.middle++,
    ),
    source('@zeta/tool', './bin/tool.js', 'node_modules/host/node_modules', () => reads.zeta++),
    source('alpha', { shared: './bin/alpha.js' }, 'node_modules', () => reads.alpha++),
  ] as const;
  expect(JSON.stringify(normalize(sources))).toBe(
    '[{"nodeModulesDir":"node_modules","command":"middle","owner":"middle","target":"bin/middle.js"},{"nodeModulesDir":"node_modules","command":"shared","owner":"middle","target":"bin/shared.js"},{"nodeModulesDir":"node_modules","command":"alpha","owner":"middle","target":"bin/alpha.js"},{"nodeModulesDir":"node_modules/host/node_modules","command":"tool","owner":"@zeta/tool","target":"bin/tool.js"},{"nodeModulesDir":"node_modules","command":"shared","owner":"alpha","target":"bin/alpha.js"}]',
  );
  expect(reads).toEqual({ middle: 1, zeta: 1, alpha: 1 });
  for (const [target, bin] of [
    ['../escape.js', '../escape.js'],
    ['/absolute.js', { valid: './bin/valid.js', bad: '/absolute.js' }],
  ] as const) {
    const errorReads = { prefix: 0, invalid: 0, following: 0 };
    const observed = (
      key: keyof typeof errorReads,
      value: string | Record<string, string>,
    ): PackageBinSource => source(key, value, 'node_modules', () => errorReads[key]++);
    expect(() =>
      normalize([
        observed('prefix', './bin/prefix.js'),
        observed('invalid', bin),
        observed('following', './bin/following.js'),
      ]),
    ).toThrowError(new Error(`Invalid package bin target: ${target}`));
    expect(errorReads).toEqual({ prefix: 1, invalid: 1, following: 0 });
  }
});
