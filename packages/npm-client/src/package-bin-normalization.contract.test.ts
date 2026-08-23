import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import type { PackageBin, ResolvedPackage, VersionManifest } from './index.ts';
import * as linker from './linker.ts';

type PackageBinInput = PackageBin | null | false | number | undefined;

interface PackageBinNormalizationApi {
  normalizePackageBin(
    packageName: string | undefined,
    bin: PackageBinInput,
  ): Readonly<Record<string, string>> | undefined;
}

const contractApi = linker as unknown as Partial<PackageBinNormalizationApi>;
const compatUrl = new URL('../../../docs/public/compat/package-tooling.md', import.meta.url);

function requireNormalizer(): PackageBinNormalizationApi['normalizePackageBin'] {
  const candidate = contractApi.normalizePackageBin;
  expect(candidate, 'normalizePackageBin package-private pure seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing normalizePackageBin');
  }
  return candidate;
}

function proveReadonlyArrayIngress(): void {
  const bin = ['first/array-z', 'middle/array-a', 'last/array-z'] as const satisfies PackageBin;
  const resolved: ResolvedPackage = {
    name: 'array-cli',
    version: '1.0.0',
    dependencies: {},
    files: {},
    bin,
  };
  const manifest: VersionManifest = {
    name: 'array-cli',
    version: '1.0.0',
    bin,
    dist: { tarball: 'fixture:array-cli' },
  };
  void [resolved, manifest];
}

void proveReadonlyArrayIngress;

function rawPackage(
  name: string,
  bin: PackageBinInput,
  files: Readonly<Record<string, Uint8Array>> = {},
): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    dependencies: {},
    files: { ...files },
    bin: bin as ResolvedPackage['bin'],
  };
}

async function observedProject() {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  const mutations = [
    vi.spyOn(vfs, 'writeFile'),
    vi.spyOn(vfs, 'mkdir'),
    vi.spyOn(vfs, 'rm'),
    vi.spyOn(vfs, 'utimes'),
  ];
  return { vfs, mutations };
}

describe('npm package-bin normalization authority', () => {
  it('exports the raw type but keeps the normalizer package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('normalizePackageBin');
  });

  it('[fault: frozen-assumption][fault: observable-order] matches npm 11 string and array rows', () => {
    const normalize = requireNormalizer();
    const array = ['first/array-z', 'middle/array-a', 'last/array-z'] as const;

    expect(normalize('plain-cli', './bin/../plain.js')).toEqual({
      'plain-cli': 'plain.js',
    });
    expect(normalize('@scope/scoped-cli', '.\\bin\\..\\scoped.js')).toEqual({
      'scoped-cli': 'scoped.js',
    });
    expect(JSON.stringify(normalize('array-cli', array))).toBe(
      '{"array-z":"last/array-z","array-a":"middle/array-a"}',
    );
    expect(array).toEqual(['first/array-z', 'middle/array-a', 'last/array-z']);
  });

  it('[fault: frozen-assumption][fault: lossy-aggregate] matches npm 11 object mutation order without mutating ingress', () => {
    const normalize = requireNormalizer();
    const bin = {
      'bad/object-command': './bin/./object.js',
      'bad\\windows-command': 'bin\\windows.js',
      'bad:colon-command': '../colon.js',
      'first/collision': './one.js',
      'second:collision': 'dir/../two.js',
      'bad/canonical-collision': './renamed-first.js',
      'canonical-collision': './canonical-second.js',
      'drive-target': 'C:\\bin\\drive.js',
      '': 'ignored.js',
      'bad/empty-target': '',
      'bad/non-string': 42,
    } as const;
    const before = structuredClone(bin);

    expect(JSON.stringify(normalize('object-cli', bin))).toBe(
      '{"canonical-collision":"renamed-first.js","drive-target":"C/bin/drive.js","object-command":"bin/object.js","windows-command":"bin/windows.js","colon-command":"colon.js","collision":"two.js"}',
    );
    expect(bin).toEqual(before);
  });

  it('[fault: frozen-assumption][fault: corrupt-input] roots dot, traversal, absolute, and platform separators inside the package', () => {
    const normalize = requireNormalizer();

    expect(
      normalize('target-cli', {
        dot: './bin/dot.js',
        traversal: '../../outside.js',
        absolute: '/absolute.js',
        segments: 'bin/../segments.js',
        windows: 'bin\\nested\\..\\windows.js',
      }),
    ).toEqual({
      dot: 'bin/dot.js',
      traversal: 'outside.js',
      absolute: 'absolute.js',
      segments: 'segments.js',
      windows: 'bin/windows.js',
    });
  });

  it('[fault: corrupt-input] removes every npm-removed top-level form', () => {
    const normalize = requireNormalizer();
    const cases = [
      ['absent', undefined],
      ['empty-array', [] as const],
      ['empty-object', {}],
      ['empty-string', ''],
      ['null-bin', null],
      ['false-bin', false],
      ['number-bin', 42],
    ] as const;

    for (const [name, bin] of cases) expect(normalize(name, bin)).toBeUndefined();
    expect(normalize(undefined, './unnamed.js')).toBeUndefined();
  });

  it('[fault: corrupt-input] keeps a non-string array member as one named loud gap', () => {
    const normalize = requireNormalizer();
    const bin = ['valid.js', 42] as unknown as PackageBin;
    let caught: unknown;

    try {
      normalize('invalid-array', bin);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
    expect(bin).toEqual(['valid.js', 42]);
  });

  it('[fault: sibling-drift] canonicalizes direct lock facts through the same map', () => {
    const lock = linker.buildLockfile('root', '1.0.0', [
      rawPackage('@scope/string-cli', '.\\bin\\..\\scoped.js'),
      rawPackage('array-cli', ['first/array-z', 'middle/array-a', 'last/array-z']),
      rawPackage('object-cli', {
        'bad/tool': '../tool.js',
        'bad/canonical': './first.js',
        canonical: './second.js',
        drive: 'C:\\bin\\drive.js',
      }),
    ]);

    expect(lock.packages['node_modules/@scope/string-cli']?.bin).toEqual({
      'string-cli': 'scoped.js',
    });
    expect(JSON.stringify(lock.packages['node_modules/array-cli']?.bin)).toBe(
      '{"array-z":"last/array-z","array-a":"middle/array-a"}',
    );
    expect(lock.packages['node_modules/object-cli']?.bin).toEqual({
      canonical: 'first.js',
      drive: 'C/bin/drive.js',
      tool: 'tool.js',
    });
  });

  it('[fault: corrupt-input][fault: sibling-drift] normalizes before collision preflight or VFS mutation', async () => {
    const observed = await observedProject();
    const packages = [
      rawPackage('renamed-owner', { 'bad/shared': './a.js' }, { 'a.js': new Uint8Array() }),
      rawPackage('canonical-owner', { shared: './b.js' }, { 'b.js': new Uint8Array() }),
    ];
    let caught: unknown;

    try {
      await npmClientRoot.link(observed.vfs, '/project', packages);
    } catch (error) {
      caught = error;
    }

    expect.soft(caught).toBeInstanceOf(NotImplementedError);
    expect.soft(caught).toMatchObject({ feature: 'npm-client.bin-collision-reify' });
    expect(observed.mutations.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it('[fault: corrupt-input] rejects a non-string array before direct-link mutation', async () => {
    const observed = await observedProject();
    const invalid = rawPackage('invalid-array', ['valid.js', 42] as unknown as PackageBin, {
      'valid.js': new Uint8Array(),
    });
    let reads = 0;
    Object.defineProperty(invalid, 'bin', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return ['valid.js', 42];
      },
    });
    const caught: unknown = await npmClientRoot
      .link(observed.vfs, '/project', [invalid])
      .catch((error: unknown) => error);

    expect.soft(caught).toBeInstanceOf(NotImplementedError);
    expect.soft(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
    expect.soft(reads).toBe(1);
    expect(observed.mutations.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it('[fault: provenance-lie] keeps one exact public compat ceiling', async () => {
    const row =
      "| Non-string package-bin array entries | ❌ | Registry, lockfile, and direct linker ingress throw `NotImplementedError('npm-client.package-bin.non-string-array-entry')` before project-tree or lock mutation |";
    const rows = (await readFile(compatUrl, 'utf8'))
      .split('\n')
      .filter((line) => line.startsWith('| Non-string package-bin array entries |'));

    expect(rows).toEqual([row]);
  });
});
