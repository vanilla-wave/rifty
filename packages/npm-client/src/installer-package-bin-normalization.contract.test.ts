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

type RawPackageBin = string | readonly unknown[] | Readonly<Record<string, unknown>>;

interface RegistryEntry {
  readonly manifest: Omit<VersionManifest, 'bin'> & { readonly bin?: RawPackageBin };
  readonly tarball: Uint8Array;
  readonly packageJson: string;
}

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

async function registryEntry(
  name: string,
  bin: RawPackageBin,
  files: Readonly<Record<string, string>>,
): Promise<RegistryEntry> {
  const packageJson = `${JSON.stringify({ name, version: '1.0.0', bin }, null, 2)}\n`;
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      name,
      version: '1.0.0',
      dependencies: {},
      bin,
      dist: { tarball: `fixture://${encodeURIComponent(name)}|1.0.0` },
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

const expectedBins = {
  '@scope/string-cli': { 'string-cli': 'scoped.js' },
  'array-cli': {
    'array-z': 'last/array-z',
    'array-a': 'middle/array-a',
  },
  'object-cli': {
    canonical: 'first.js',
    drive: 'C/bin/drive.js',
    tool: 'tool.js',
  },
} as const;

const expectedLaunchers = {
  'string-cli': "#!/usr/bin/env node\nimport('../@scope/string-cli/scoped.js');\n",
  'array-z': "#!/usr/bin/env node\nimport('../array-cli/last/array-z');\n",
  'array-a': "#!/usr/bin/env node\nimport('../array-cli/middle/array-a');\n",
  canonical: "#!/usr/bin/env node\nimport('../object-cli/first.js');\n",
  drive: "#!/usr/bin/env node\nimport('../object-cli/C/bin/drive.js');\n",
  tool: "#!/usr/bin/env node\nimport('../object-cli/tool.js');\n",
} as const;

function resultBins(result: InstallResult): Readonly<Record<string, unknown>> {
  return Object.fromEntries(result.packages.map((pkg) => [pkg.name, pkg.bin ?? null]));
}

function lockBins(result: InstallResult): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.keys(expectedBins).map((name) => [
      name,
      result.lockfile.packages[`node_modules/${name}`]?.bin ?? null,
    ]),
  );
}

async function launcherBytes(vfs: MemoryVfs): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    await Promise.all(
      Object.keys(expectedLaunchers).map(async (command) => [
        command,
        await vfs.readFileText(`/project/node_modules/.bin/${command}`),
      ]),
    ),
  );
}

describe('install — npm package-bin normalization authority', () => {
  it('[fault: sibling-drift, lossy-aggregate] publishes one npm-canonical map on fresh install and zero-registry replay', async () => {
    const entries = new Map<string, RegistryEntry>([
      [
        '@scope/string-cli',
        await registryEntry('@scope/string-cli', '.\\bin\\..\\scoped.js', {
          'scoped.js': 'console.log("scoped");\n',
        }),
      ],
      [
        'array-cli',
        await registryEntry(
          'array-cli',
          [
            'first/array-z',
            'middle/array-a',
            'a-very-long-intermediate-directory-name/array-z',
            'last/array-z',
          ],
          {
            'first/array-z': 'console.log("first-z");\n',
            'middle/array-a': 'console.log("array-a");\n',
            'a-very-long-intermediate-directory-name/array-z': 'console.log("intermediate-z");\n',
            'last/array-z': 'console.log("last-z");\n',
          },
        ),
      ],
      [
        'object-cli',
        await registryEntry(
          'object-cli',
          {
            'bad/tool': './bin/../tool.js',
            'bad/canonical': './first.js',
            canonical: './second.js',
            drive: 'C:\\bin\\drive.js',
          },
          {
            'tool.js': 'console.log("tool");\n',
            'first.js': 'console.log("first");\n',
            'second.js': 'console.log("second");\n',
            'C/bin/drive.js': 'console.log("drive");\n',
          },
        ),
      ],
    ]);
    const dependencies = Object.fromEntries([...entries.keys()].map((name) => [name, '1.0.0']));
    const vfs = await project(dependencies);
    const freshRegistry = new FixtureRegistry(entries);

    const fresh = await install({ vfs, cwd: '/project', registry: freshRegistry });
    const freshLockBytes = await vfs.readFileText('/project/package-lock.json');
    const writtenFreshLock = JSON.parse(freshLockBytes) as InstallResult['lockfile'];

    expect.soft([freshRegistry.packumentReads, freshRegistry.tarballReads]).toEqual([3, 3]);
    expect.soft(resultBins(fresh)).toEqual(expectedBins);
    expect.soft(lockBins(fresh)).toEqual(expectedBins);
    expect.soft(writtenFreshLock).toEqual(fresh.lockfile);
    expect.soft(lockBins({ ...fresh, lockfile: writtenFreshLock })).toEqual(expectedBins);
    expect.soft(await launcherBytes(vfs)).toEqual(expectedLaunchers);
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
    expect.soft(resultBins(replay)).toEqual(expectedBins);
    expect.soft(lockBins(replay)).toEqual(expectedBins);
    expect.soft(await launcherBytes(vfs)).toEqual(expectedLaunchers);
    expect.soft(replayLockBytes).toBe(freshLockBytes);
    for (const [name, entry] of entries) {
      expect
        .soft(await vfs.readFileText(`/project/node_modules/${name}/package.json`), name)
        .toBe(entry.packageJson);
    }
  });

  it('[fault: corrupt-input] rejects a non-string array entry before tree or lock publication', async () => {
    const invalid = await registryEntry('invalid-array', ['valid.js', 42], {
      'valid.js': 'console.log("valid");\n',
    });
    const vfs = await project({ 'invalid-array': '1.0.0' });
    let caught: unknown;
    try {
      await install({
        vfs,
        cwd: '/project',
        registry: new FixtureRegistry(new Map([['invalid-array', invalid]])),
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

  it('[fault: corrupt-input, sibling-drift] rejects the same gap on zero-registry lock replay', async () => {
    const valid = await registryEntry('replay-array', ['valid.js'], {
      'valid.js': 'console.log("valid");\n',
    });
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
    entry.bin = ['valid.js', 42];
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
