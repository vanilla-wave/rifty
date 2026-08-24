import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import * as npmClientRoot from './index.ts';
import type {
  InstallResult,
  NormalizedPackageBin,
  NormalizedResolvedPackage,
  PackageBin,
  ResolvedPackage,
  VersionManifest,
} from './index.ts';
import * as linker from './linker.ts';

type OracleBin =
  | string
  | readonly unknown[]
  | Readonly<Record<string, unknown>>
  | null
  | boolean
  | number;

interface OracleDirectCase {
  readonly id: string;
  readonly input: Readonly<{ name?: string; bin?: OracleBin }>;
  readonly packageJson: Readonly<{
    bin?: Readonly<Record<string, string>> | null;
    error?: Readonly<{ name: string; message: string }>;
  }>;
}

interface OracleFixture {
  readonly name: string;
  readonly bin?: OracleBin;
  readonly files: Readonly<Record<string, boolean>>;
}

interface PackageBinOracle {
  readonly direct: readonly OracleDirectCase[];
  readonly fixtures: readonly OracleFixture[];
  readonly install: Readonly<{
    fresh: Readonly<{
      lockBins: Readonly<Record<string, Readonly<Record<string, string>> | null>>;
      links: Readonly<Record<string, string>>;
    }>;
  }>;
}

interface PackageBinNormalizationApi {
  normalizePackageBin(
    packageName: string | undefined,
    bin: unknown,
  ): NormalizedPackageBin | undefined;
}

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <
  Value,
>() => Value extends Right ? 1 : 2
  ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
    ? true
    : false
  : false;
type ExpectedPackageBin = string | readonly string[] | Readonly<Record<string, unknown>>;
type ExpectedNormalizedResolvedPackage = Omit<ResolvedPackage, 'bin'> & {
  bin?: NormalizedPackageBin;
};
type MissingNormalizer = (packageName: number, bin: string) => string;
type ConditionalExport<Key extends PropertyKey> = Key extends keyof typeof linker
  ? Extract<(typeof linker)[Key], (...args: never[]) => unknown>
  : MissingNormalizer;
type NormalizeExport = ConditionalExport<'normalizePackageBin'>;

const contractApi = linker as unknown as Partial<PackageBinNormalizationApi>;
const compatUrl = new URL('../../../docs/public/compat/package-tooling.md', import.meta.url);
const oracleUrl = new URL(
  '../../../docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json',
  import.meta.url,
);
const oraclePromise = readFile(oracleUrl, 'utf8').then(
  (text) => JSON.parse(text) as PackageBinOracle,
);

function provePackageBinTypes(): void {
  const rawExact: Equal<PackageBin, ExpectedPackageBin> = true;
  const normalizedExact: Equal<NormalizedPackageBin, Readonly<Record<string, string>>> = true;
  const resolvedIngressExact: Equal<ResolvedPackage['bin'], PackageBin | undefined> = true;
  const manifestIngressExact: Equal<VersionManifest['bin'], PackageBin | undefined> = true;
  const normalizedPackageExact: Equal<
    NormalizedResolvedPackage,
    ExpectedNormalizedResolvedPackage
  > = true;
  const resultPackageExact: Equal<InstallResult['packages'][number], NormalizedResolvedPackage> =
    true;
  const resultBinExact: Equal<
    InstallResult['packages'][number]['bin'],
    NormalizedPackageBin | undefined
  > = true;
  const lockBinExact: Equal<
    InstallResult['lockfile']['packages'][string]['bin'],
    NormalizedPackageBin | undefined
  > = true;
  const normalizerExact: Equal<NormalizeExport, PackageBinNormalizationApi['normalizePackageBin']> =
    true;
  const array = ['first/array-z', 'last/array-z'] as const satisfies PackageBin;
  const object = { valid: './valid.js', removed: 42 } as const satisfies PackageBin;
  const resolved: ResolvedPackage = {
    name: 'typed-bin',
    version: '1.0.0',
    dependencies: {},
    files: {},
    bin: array,
  };
  const manifest: VersionManifest = {
    name: 'typed-bin',
    version: '1.0.0',
    bin: object,
    dist: { tarball: 'fixture:typed-bin' },
  };
  const raw = {} as PackageBin;
  // @ts-expect-error Contract: raw forms are not canonical output facts.
  const rejectedOutput: NormalizedPackageBin = raw;
  void [
    rawExact,
    normalizedExact,
    resolvedIngressExact,
    manifestIngressExact,
    normalizedPackageExact,
    resultPackageExact,
    resultBinExact,
    lockBinExact,
    normalizerExact,
    resolved,
    manifest,
    rejectedOutput,
  ];
}

void provePackageBinTypes;

function requireNormalizer(): PackageBinNormalizationApi['normalizePackageBin'] {
  const candidate = contractApi.normalizePackageBin;
  expect(candidate, 'normalizePackageBin package-private pure seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: linker is missing normalizePackageBin');
  }
  return candidate;
}

function rawPackage(fixture: OracleFixture): ResolvedPackage {
  return {
    name: fixture.name,
    version: '1.0.0',
    dependencies: {},
    files: Object.fromEntries(Object.keys(fixture.files).map((path) => [path, new Uint8Array()])),
    ...(Object.hasOwn(fixture, 'bin') ? { bin: fixture.bin as ResolvedPackage['bin'] } : {}),
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
  it('exports exact raw/output types but keeps the normalizer package-private', () => {
    expect(npmClientRoot).not.toHaveProperty('normalizePackageBin');
  });

  it('[fault: frozen-assumption][fault: corrupt-input][fault: lossy-aggregate] runs every npm direct fixture through the pure seam', async () => {
    const normalize = requireNormalizer();
    const oracle = await oraclePromise;
    for (const row of oracle.direct.filter(
      (candidate) => candidate.packageJson.error === undefined,
    )) {
      const input = structuredClone(row.input);
      const expected = row.packageJson.bin ?? null;
      const actual = normalize(input.name, input.bin) ?? null;
      expect(JSON.stringify(actual), row.id).toBe(JSON.stringify(expected));
      expect(input, `${row.id} ingress mutation`).toEqual(row.input);
    }
  });

  it('[fault: corrupt-input] maps npm array TypeError to one named loud gap', async () => {
    const normalize = requireNormalizer();
    const oracle = await oraclePromise;
    const row = oracle.direct.find((candidate) => candidate.id === 'non-string-array-entry');
    if (!row) throw new Error('Contract oracle: non-string array row missing');
    let caught: unknown;

    try {
      normalize(row.input.name, structuredClone(row.input.bin));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
  });

  it('[fault: sibling-drift] runs every install fixture through direct lock construction', async () => {
    const oracle = await oraclePromise;
    const lock = linker.buildLockfile('root', '1.0.0', oracle.fixtures.map(rawPackage));

    for (const fixture of oracle.fixtures) {
      expect(lock.packages[`node_modules/${fixture.name}`]?.bin ?? null, fixture.name).toEqual(
        oracle.install.fresh.lockBins[fixture.name],
      );
    }
  });

  it('[fault: sibling-drift] runs every install fixture through public link', async () => {
    const oracle = await oraclePromise;
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    await npmClientRoot.link(vfs, '/project', oracle.fixtures.map(rawPackage));

    const commands = Object.keys(oracle.install.fresh.links).sort();
    expect(
      (await vfs.readdir('/project/node_modules/.bin')).map((entry) => entry.name).sort(),
    ).toEqual(commands);
    for (const [command, target] of Object.entries(oracle.install.fresh.links)) {
      expect(await vfs.readFileText(`/project/node_modules/.bin/${command}`), command).toBe(
        `#!/usr/bin/env node\nimport('${target}');\n`,
      );
    }
  });

  it('[fault: corrupt-input][fault: sibling-drift] normalizes before collision preflight or VFS mutation', async () => {
    const observed = await observedProject();
    const collisionFixtures: readonly OracleFixture[] = [
      {
        name: 'renamed-owner',
        bin: { 'bad/shared': './a.js' },
        files: { 'a.js': true },
      },
      { name: 'canonical-owner', bin: { shared: './b.js' }, files: { 'b.js': true } },
    ];
    const packages = collisionFixtures.map(rawPackage);
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

  it('[fault: corrupt-input] rejects the oracle array gap before direct-link mutation', async () => {
    const oracle = await oraclePromise;
    const row = oracle.direct.find((candidate) => candidate.id === 'non-string-array-entry');
    if (!row) throw new Error('Contract oracle: non-string array row missing');
    const targets = Array.isArray(row.input.bin)
      ? row.input.bin.filter((value): value is string => typeof value === 'string')
      : [];
    if (targets.length === 0) {
      throw new Error('Contract oracle: non-string array prefix missing');
    }
    const observed = await observedProject();
    const invalid = rawPackage({
      name: row.input.name ?? 'invalid-array',
      bin: row.input.bin,
      files: Object.fromEntries(targets.map((target) => [target, true])),
    });
    let reads = 0;
    Object.defineProperty(invalid, 'bin', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return row.input.bin;
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
