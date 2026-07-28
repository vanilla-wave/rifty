import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import * as npmClientRoot from './index.ts';
import { install } from './installer.ts';
import * as installer from './installer.ts';
import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import {
  type Lockfile,
  type PreparedInstallPackage,
  type ResolvedPackage,
  buildPreparedInstallLockfile,
  linkPreparedInstallTree,
  preflightPackageInstallPaths,
} from './linker.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import type { TarballCache } from './tarball-cache.ts';

const encoder = new TextEncoder();

interface InstallerIngressContractApi {
  packageLinkTargets(root: string, packages: readonly PreparedInstallPackage[]): readonly string[];
}

const contractApi = installer as unknown as Partial<InstallerIngressContractApi>;
const emptyShadowPlan = Object.freeze({
  requiredSetDigest: '0'.repeat(64),
  substitutions: Object.freeze([]),
  assets: Object.freeze([]),
  bindings: Object.freeze([]),
}) satisfies ShadowAssetPlan;

function requirePackageLinkTargets(): InstallerIngressContractApi['packageLinkTargets'] {
  const candidate = contractApi.packageLinkTargets;
  expect(candidate, 'package-private prepared installer target seam').toBeTypeOf('function');
  if (typeof candidate !== 'function') {
    throw new Error('Contract RED: installer is missing prepared packageLinkTargets');
  }
  return candidate;
}

function pkg(name: string, installPath: string | undefined, withBin = false): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    ...(withBin ? { bin: { [name]: 'bin/cli.js' } } : {}),
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      ...(withBin
        ? { 'bin/cli.js': encoder.encode(`console.log(${JSON.stringify(name)});\n`) }
        : {}),
    },
  };
}

function binfulReadOncePackages(): {
  readonly packages: readonly ResolvedPackage[];
  readonly reads: readonly (() => number)[];
} {
  const paths = [
    { name: 'root-cli', installPath: 'node_modules/root-cli' },
    { name: 'nested-cli', installPath: 'node_modules/host/node_modules/nested-cli' },
  ] as const;
  const packages: ResolvedPackage[] = [];
  const reads: Array<() => number> = [];
  for (const { name, installPath } of paths) {
    const candidate = pkg(name, installPath, true);
    let count = 0;
    Object.defineProperty(candidate, 'installPath', {
      configurable: true,
      enumerable: true,
      get: () => {
        count += 1;
        if (count > 1) throw new Error(`poisoned second installPath read for ${name}`);
        return installPath;
      },
    });
    packages.push(candidate);
    reads.push(() => count);
  }
  return { packages, reads };
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

interface FakeRegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

class FakeRegistry extends RegistryClient {
  constructor(
    private readonly db: ReadonlyMap<string, ReadonlyMap<string, FakeRegistryEntry>>,
    private readonly onTarball: () => void,
  ) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    return {
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: Object.fromEntries(
        [...versions].map(([version, entry]) => [version, entry.manifest]),
      ),
    };
  }

  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    this.onTarball();
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball URL ${tarballUrl}`);
    const name = decodeURIComponent(match[1] ?? '');
    const version = match[2] ?? '';
    const entry = this.db.get(name)?.get(version);
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function registryEntry(name: string): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version: '1.0.0',
      dependencies: {},
      dist: { tarball: `fake://${encodeURIComponent(name)}/1.0.0` },
    },
    tarball: await makePackageTarball(name, '1.0.0'),
  };
}

function memoryTarballCache(): TarballCache {
  const entries = new Map<string, Uint8Array>();
  return {
    async get(name, version, integrity) {
      return entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
    },
    async put(name, version, integrity, bytes) {
      entries.set(`${name}\0${version}\0${integrity}`, bytes.slice());
      return `memory:${name}@${version}`;
    },
  };
}

function recordingVfs(vfs: MemoryVfs, calls: string[], armed: () => boolean): Vfs {
  return new Proxy(vfs, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        if (armed()) calls.push(String(property));
        return Reflect.apply(value, target, args);
      };
    },
  });
}

describe('resolved-package installer path ingress', () => {
  it('keeps prepared packageLinkTargets package-private', () => {
    expect(contractApi.packageLinkTargets).toBeTypeOf('function');
    expect(npmClientRoot).not.toHaveProperty('packageLinkTargets');
  });

  it('derives exact ordered targets from omitted, root, nested, and nested-scoped carriers', () => {
    const packages = [
      pkg('omitted-cli', undefined),
      pkg('root-cli', 'node_modules/root-cli'),
      pkg('nested-cli', 'node_modules/host/node_modules/nested-cli'),
      pkg('@tools/scoped-cli', 'node_modules/@scope/host/node_modules/@tools/scoped-cli'),
    ];
    const prepared = preflightPackageInstallPaths(packages);

    expect(requirePackageLinkTargets()('/project/.', prepared)).toEqual([
      '/project/node_modules/omitted-cli',
      '/project/node_modules/omitted-cli/package.json',
      '/project/node_modules/root-cli',
      '/project/node_modules/root-cli/package.json',
      '/project/node_modules/host/node_modules/nested-cli',
      '/project/node_modules/host/node_modules/nested-cli/package.json',
      '/project/node_modules/@scope/host/node_modules/@tools/scoped-cli',
      '/project/node_modules/@scope/host/node_modules/@tools/scoped-cli/package.json',
    ]);
    expect(prepared.map((entry) => entry.package)).toEqual(packages);
  });

  it('[fault: sibling-drift] one carrier drives targets, binful link, and install lock after one raw read', async () => {
    const { packages, reads } = binfulReadOncePackages();
    const prepared = preflightPackageInstallPaths(packages);
    const vfs = await project();

    const targets = requirePackageLinkTargets()('/project', prepared);
    await linkPreparedInstallTree(vfs, '/project', prepared, () => {});
    const lockfile: Lockfile = buildPreparedInstallLockfile(
      'root',
      '1.0.0',
      prepared,
      emptyShadowPlan,
    );

    expect(reads.map((read) => read())).toEqual([1, 1]);
    expect(targets).toEqual([
      '/project/node_modules/root-cli',
      '/project/node_modules/root-cli/package.json',
      '/project/node_modules/root-cli/bin/cli.js',
      '/project/node_modules/host/node_modules/nested-cli',
      '/project/node_modules/host/node_modules/nested-cli/package.json',
      '/project/node_modules/host/node_modules/nested-cli/bin/cli.js',
    ]);
    expect(await vfs.readFileText('/project/node_modules/.bin/root-cli')).toBe(
      "#!/usr/bin/env node\nimport('../root-cli/bin/cli.js');\n",
    );
    expect(await vfs.readFileText('/project/node_modules/host/node_modules/.bin/nested-cli')).toBe(
      "#!/usr/bin/env node\nimport('../nested-cli/bin/cli.js');\n",
    );
    expect(Object.keys(lockfile.packages)).toEqual([
      '',
      'node_modules/root-cli',
      'node_modules/host/node_modules/nested-cli',
    ]);
  });

  it.each([
    {
      label: 'dot segment',
      name: '@scope/./bad-cli',
      rawPath: 'node_modules/@scope/./bad-cli',
    },
    {
      label: 'double separator',
      name: '@scope//bad-cli',
      rawPath: 'node_modules/@scope//bad-cli',
    },
  ])(
    '[fault: corrupt-input, observable-order] real mixed install rejects a $label before target, VFS, or lock publication',
    async ({ name, rawPath }) => {
      const good = await registryEntry('good');
      const invalid = await registryEntry(name);
      const db = new Map([
        ['good', new Map([['1.0.0', good]])],
        [name, new Map([['1.0.0', invalid]])],
      ]);
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      let armed = false;
      const vfsCalls: string[] = [];
      const targetPublications: string[][] = [];
      const observedVfs = recordingVfs(vfs, vfsCalls, () => armed);
      let caught: unknown;

      try {
        await install(
          'root',
          '1.0.0',
          { good: '1.0.0', [name]: '1.0.0' },
          {
            vfs: observedVfs,
            cwd: '/project',
            registry: new FakeRegistry(db, () => {
              armed = true;
            }),
            tarballCache: memoryTarballCache(),
            assertPortablePaths(paths): void {
              targetPublications.push([...paths]);
            },
          },
        );
      } catch (error) {
        caught = error;
      }

      expect.soft(caught).toBeInstanceOf(Error);
      expect.soft(caught).toMatchObject({
        code: 'EINVALIDPACKAGETAR',
        path: rawPath,
      });
      expect.soft(targetPublications).toEqual([]);
      expect.soft(vfsCalls).toEqual([]);
      expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
      expect(await vfs.exists('/project/package-lock.json')).toBe(false);
    },
  );
});
