import { NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import * as npmClientRoot from './index.ts';
import * as linker from './linker.ts';
import type { PackageBinClaim, PackageBinSource } from './linker.ts';
type Normalizer = (sources: readonly PackageBinSource[]) => readonly PackageBinClaim[];
type RawPackageBin = string | readonly string[] | Readonly<Record<string, unknown>>;

function source(
  name: string,
  bin: RawPackageBin,
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
    } as PackageBinSource['package'],
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
  for (const [label, bin, expected] of [
    [
      'traversal',
      '../escape.js',
      '[{"nodeModulesDir":"node_modules","command":"prefix","owner":"prefix","target":"bin/prefix.js"},{"nodeModulesDir":"node_modules","command":"invalid","owner":"invalid","target":"escape.js"},{"nodeModulesDir":"node_modules","command":"following","owner":"following","target":"bin/following.js"}]',
    ],
    [
      'absolute',
      { valid: './bin/valid.js', bad: '/absolute.js' },
      '[{"nodeModulesDir":"node_modules","command":"prefix","owner":"prefix","target":"bin/prefix.js"},{"nodeModulesDir":"node_modules","command":"valid","owner":"invalid","target":"bin/valid.js"},{"nodeModulesDir":"node_modules","command":"bad","owner":"invalid","target":"absolute.js"},{"nodeModulesDir":"node_modules","command":"following","owner":"following","target":"bin/following.js"}]',
    ],
  ] as const) {
    const reads = { prefix: 0, invalid: 0, following: 0 };
    const observed = (key: keyof typeof reads, value: RawPackageBin): PackageBinSource =>
      source(key, value, 'node_modules', () => reads[key]++);

    expect(
      JSON.stringify(
        normalize([
          observed('prefix', './bin/prefix.js'),
          observed('invalid', bin),
          observed('following', './bin/following.js'),
        ]),
      ),
      label,
    ).toBe(expected);
    expect(reads).toEqual({ prefix: 1, invalid: 1, following: 1 });
  }
});

it('[fault: corrupt-input][fault: observable-order] stops at a named non-string array gap after one read', () => {
  const normalize = (linker as unknown as { normalizePackageBinSources?: Normalizer })
    .normalizePackageBinSources;
  expect(normalize, 'normalizePackageBinSources package-private linker seam').toBeTypeOf(
    'function',
  );
  if (!normalize) throw new Error('Contract RED: linker is missing normalizePackageBinSources');
  const reads = { prefix: 0, invalid: 0, following: 0 };
  const observed = (key: keyof typeof reads, value: RawPackageBin): PackageBinSource =>
    source(key, value, 'node_modules', () => reads[key]++);
  let caught: unknown;

  try {
    normalize([
      observed('prefix', './bin/prefix.js'),
      observed('invalid', ['valid.js', 42] as unknown as RawPackageBin),
      observed('following', './bin/following.js'),
    ]);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(NotImplementedError);
  expect(caught).toMatchObject({
    feature: 'npm-client.package-bin.non-string-array-entry',
  });
  expect(reads).toEqual({ prefix: 1, invalid: 1, following: 0 });
});
