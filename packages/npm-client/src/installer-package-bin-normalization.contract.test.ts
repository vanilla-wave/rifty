import { readFile } from 'node:fs/promises';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { type InstallResult, install } from './index.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

type OracleBin =
  | string
  | readonly unknown[]
  | Readonly<Record<string, unknown>>
  | null
  | boolean
  | number;

interface OracleFixture {
  readonly name: string;
  readonly bin?: OracleBin;
  readonly files: Readonly<Record<string, boolean>>;
}

interface PackageBinOracle {
  readonly direct: readonly Readonly<{
    id: string;
    input: Readonly<{ name?: string; bin?: OracleBin }>;
  }>[];
  readonly fixtures: readonly OracleFixture[];
  readonly install: Readonly<{
    fresh: Readonly<{
      manifests: Readonly<Record<string, OracleBin | null>>;
      lockBins: Readonly<Record<string, Readonly<Record<string, string>> | null>>;
      links: Readonly<Record<string, string>>;
    }>;
  }>;
}

interface RegistryEntry {
  readonly manifest: Omit<VersionManifest, 'bin'> & { readonly bin?: OracleBin };
  readonly tarball: Uint8Array;
  readonly packageJson: string;
}

const oracleUrl = new URL(
  '../../../docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json',
  import.meta.url,
);
const oraclePromise = readFile(oracleUrl, 'utf8').then(
  (text) => JSON.parse(text) as PackageBinOracle,
);

class FixtureRegistry extends RegistryClient {
  packumentReads = 0;
  tarballReads = 0;

  constructor(private readonly entries: ReadonlyMap<string, RegistryEntry>) {
    super({ baseUrl: '/fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads += 1;
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`fixture registry has no ${name}`);
    return {
      name,
      'dist-tags': { latest: entry.manifest.version },
      versions: {
        [entry.manifest.version]: entry.manifest as unknown as VersionManifest,
      },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads += 1;
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.manifest.dist.tarball === url,
    );
    if (!entry) throw new Error(`fixture registry has no tarball ${url}`);
    return entry.tarball.slice();
  }
}

async function registryEntry(fixture: OracleFixture): Promise<RegistryEntry> {
  const packageData = {
    name: fixture.name,
    version: '1.0.0',
    ...(Object.hasOwn(fixture, 'bin') ? { bin: fixture.bin } : {}),
  };
  const packageJson = `${JSON.stringify(packageData, null, 2)}\n`;
  const files = Object.fromEntries(
    Object.keys(fixture.files).map((path) => [path, `console.log(${JSON.stringify(path)});\n`]),
  );
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      ...packageData,
      dependencies: {},
      dist: { tarball: `fixture://${encodeURIComponent(fixture.name)}|1.0.0` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
    packageJson,
  };
}

async function project(dependencies: Readonly<Record<string, string>>): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'bin-root', version: '1.0.0', dependencies }),
  );
  return vfs;
}

function resultBins(result: InstallResult): Readonly<Record<string, unknown>> {
  return Object.fromEntries(result.packages.map((pkg) => [pkg.name, pkg.bin ?? null]));
}

function lockBins(
  result: InstallResult,
  names: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    names.map((name) => [name, result.lockfile.packages[`node_modules/${name}`]?.bin ?? null]),
  );
}

function expectedLaunchers(
  links: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(links).map(([command, target]) => [
      command,
      `#!/usr/bin/env node\nimport('${target}');\n`,
    ]),
  );
}

async function launcherBytes(
  vfs: MemoryVfs,
  commands: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    await Promise.all(
      commands.map(async (command) => [
        command,
        await vfs.readFileText(`/project/node_modules/.bin/${command}`),
      ]),
    ),
  );
}

function arrayStringTargets(input: Readonly<{ bin?: OracleBin }>): readonly string[] {
  const values = Array.isArray(input.bin)
    ? input.bin.filter((value): value is string => typeof value === 'string')
    : [];
  if (values.length === 0) throw new Error('Contract oracle: array prefix missing');
  return values;
}

describe('install — npm package-bin normalization authority', () => {
  it('[fault: sibling-drift, lossy-aggregate, corrupt-input] runs every npm fixture through fresh install and zero-registry replay', async () => {
    const oracle = await oraclePromise;
    const entries = new Map<string, RegistryEntry>();
    for (const fixture of oracle.fixtures) entries.set(fixture.name, await registryEntry(fixture));
    const names = oracle.fixtures.map((fixture) => fixture.name);
    const dependencies = Object.fromEntries(names.map((name) => [name, '1.0.0']));
    const launchers = expectedLaunchers(oracle.install.fresh.links);
    const vfs = await project(dependencies);
    const freshRegistry = new FixtureRegistry(entries);

    const fresh = await install({ vfs, cwd: '/project', registry: freshRegistry });
    const freshLockBytes = await vfs.readFileText('/project/package-lock.json');
    const writtenFreshLock = JSON.parse(freshLockBytes) as InstallResult['lockfile'];

    expect
      .soft([freshRegistry.packumentReads, freshRegistry.tarballReads])
      .toEqual([names.length, names.length]);
    expect.soft(resultBins(fresh)).toEqual(oracle.install.fresh.lockBins);
    expect.soft(lockBins(fresh, names)).toEqual(oracle.install.fresh.lockBins);
    expect.soft(writtenFreshLock).toEqual(fresh.lockfile);
    expect
      .soft(lockBins({ ...fresh, lockfile: writtenFreshLock }, names))
      .toEqual(oracle.install.fresh.lockBins);
    expect.soft(await launcherBytes(vfs, Object.keys(launchers))).toEqual(launchers);
    for (const [name, entry] of entries) {
      expect
        .soft(await vfs.readFileText(`/project/node_modules/${name}/package.json`), name)
        .toBe(entry.packageJson);
    }

    await vfs.rm('/project/node_modules', { recursive: true });
    const replayRegistry = new FixtureRegistry(new Map());
    const replay = await install({ vfs, cwd: '/project', registry: replayRegistry });
    const replayLockBytes = await vfs.readFileText('/project/package-lock.json');

    expect.soft([replayRegistry.packumentReads, replayRegistry.tarballReads]).toEqual([0, 0]);
    expect.soft(resultBins(replay)).toEqual(oracle.install.fresh.lockBins);
    expect.soft(lockBins(replay, names)).toEqual(oracle.install.fresh.lockBins);
    expect.soft(await launcherBytes(vfs, Object.keys(launchers))).toEqual(launchers);
    expect.soft(replayLockBytes).toBe(freshLockBytes);
    for (const [name, entry] of entries) {
      expect
        .soft(await vfs.readFileText(`/project/node_modules/${name}/package.json`), name)
        .toBe(entry.packageJson);
    }
  });

  it('[fault: corrupt-input] rejects the oracle array gap before tree or lock publication', async () => {
    const oracle = await oraclePromise;
    const row = oracle.direct.find((candidate) => candidate.id === 'non-string-array-entry');
    if (!row) throw new Error('Contract oracle: non-string array row missing');
    const targets = arrayStringTargets(row.input);
    const invalid = await registryEntry({
      name: row.input.name ?? 'invalid-array',
      bin: row.input.bin,
      files: Object.fromEntries(targets.map((target) => [target, true])),
    });
    const vfs = await project({ [invalid.manifest.name]: '1.0.0' });
    let caught: unknown;

    try {
      await install({
        vfs,
        cwd: '/project',
        registry: new FixtureRegistry(new Map([[invalid.manifest.name, invalid]])),
      });
    } catch (error) {
      caught = error;
    }

    expect.soft(caught).toBeInstanceOf(NotImplementedError);
    expect.soft(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
    expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
    expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);
  });

  it('[fault: corrupt-input, sibling-drift] rejects the oracle gap on zero-registry lock replay', async () => {
    const oracle = await oraclePromise;
    const row = oracle.direct.find((candidate) => candidate.id === 'non-string-array-entry');
    if (!row) throw new Error('Contract oracle: non-string array row missing');
    const targets = arrayStringTargets(row.input);
    const validFixture = {
      name: 'replay-array',
      bin: targets,
      files: Object.fromEntries(targets.map((target) => [target, true])),
    } as const;
    const valid = await registryEntry(validFixture);
    const vfs = await project({ 'replay-array': '1.0.0' });
    await install({
      vfs,
      cwd: '/project',
      registry: new FixtureRegistry(new Map([['replay-array', valid]])),
    });
    const lock = JSON.parse(await vfs.readFileText('/project/package-lock.json')) as {
      packages: Record<string, { bin?: unknown }>;
    };
    const entry = lock.packages['node_modules/replay-array'];
    if (!entry) throw new Error('Contract fixture: replay-array lock entry missing');
    entry.bin = structuredClone(row.input.bin);
    const malformedLockBytes = JSON.stringify(lock, null, 2);
    await vfs.writeFile('/project/package-lock.json', malformedLockBytes);
    await vfs.rm('/project/node_modules', { recursive: true });
    const replayRegistry = new FixtureRegistry(new Map());
    let caught: unknown;

    try {
      await install({ vfs, cwd: '/project', registry: replayRegistry });
    } catch (error) {
      caught = error;
    }

    expect.soft(caught).toBeInstanceOf(NotImplementedError);
    expect.soft(caught).toMatchObject({
      feature: 'npm-client.package-bin.non-string-array-entry',
    });
    expect.soft([replayRegistry.packumentReads, replayRegistry.tarballReads]).toEqual([0, 0]);
    expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
    expect(await vfs.readFileText('/project/package-lock.json')).toBe(malformedLockBytes);
  });
});
