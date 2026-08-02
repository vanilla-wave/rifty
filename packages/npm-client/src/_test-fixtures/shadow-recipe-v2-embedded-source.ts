import { readFile } from 'node:fs/promises';
import { MemoryVfs } from '@riftydev/vfs';
import { closureHashOf } from '../closure-hash.ts';
import { EDDY_BUNDLE_FORMAT, packEddyBundle } from '../eddy-bundle.ts';
import { install } from '../installer.ts';
import type { Lockfile, LockfileEntry } from '../linker.ts';
import type { Packument, VersionManifest } from '../registry.ts';
import { RegistryClient } from '../registry.ts';
import { type TarballCache, computeIntegrity } from '../tarball-cache.ts';
import { TAR_TRAILER, buildHeader, concat, gzip, padToBlock } from './tar-builder.ts';

export const SOURCE = 'lightningcss-wasm';
export const SOURCE_VERSION = '1.32.0';
export const BUNDLED = 'napi-wasm';
export const BUNDLED_VERSION = '1.1.3';
export const SOURCE_URL = `https://registry.test/${SOURCE}-${SOURCE_VERSION}.tgz`;
export const SOURCE_INTEGRITY =
  'sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==';

const REAL_TARBALL_URL = new URL(
  '../../../../tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0.tgz',
  import.meta.url,
);

export const REAL_FILES = [
  {
    path: 'package.json',
    bytes: 1_186,
    sha256: 'b7f16ae6a0036f2d92a22efdfff34482ec6b9ef33c519b8c0e858dbf2d403410',
  },
  {
    path: `node_modules/${BUNDLED}/README.md`,
    bytes: 4_246,
    sha256: 'e646406048bd592d66f5a4deeadb41ab5071ee051a530a7346f7ed2eb520e8e1',
  },
  {
    path: `node_modules/${BUNDLED}/index.js`,
    bytes: 42_418,
    sha256: 'ad46aa59b86c852819ba521cdbde18348467e448ce4e466e83e53ea60896bc8d',
  },
  {
    path: `node_modules/${BUNDLED}/index.mjs`,
    bytes: 42_375,
    sha256: '0108dc67b01e6f4e8493720a51f58747f5318ff13294bb4636fce108515e0101',
  },
  {
    path: `node_modules/${BUNDLED}/package.json`,
    bytes: 810,
    sha256: '979a10d090dc49549d31ee206b60863950712145a3bebf9fe21a0919e8ca77a1',
  },
] as const;

export type Scope = 'root' | 'nested';

type FixtureManifest = VersionManifest & {
  readonly bundleDependencies?: readonly string[];
  readonly bundledDependencies?: readonly string[];
};

export interface RegistryEntry {
  readonly manifest: FixtureManifest;
  readonly tarball: Uint8Array;
}

type EmbeddedLockfileEntry = LockfileEntry & {
  bundleDependencies?: string[];
  inBundle?: boolean;
};

type EmbeddedLockfile = Omit<Lockfile, 'packages'> & {
  packages: Record<string, EmbeddedLockfileEntry>;
};

export interface ScopePaths {
  readonly acquisition: string;
  readonly alias: string;
  readonly child: string;
}

export function scopePaths(scope: Scope): ScopePaths {
  const acquisition =
    scope === 'root' ? `node_modules/${SOURCE}` : `node_modules/nested-host/node_modules/${SOURCE}`;
  const alias =
    scope === 'root'
      ? 'node_modules/lightningcss'
      : 'node_modules/nested-host/node_modules/lightningcss';
  return { acquisition, alias, child: `${acquisition}/node_modules/${BUNDLED}` };
}

export function scopeDependencies(scope: Scope): Record<string, string> {
  return scope === 'root'
    ? { lightningcss: '^1.32.0' }
    : { [SOURCE]: '1.32.1', 'nested-host': '1.0.0' };
}

export async function registryEntry(
  name: string,
  version: string,
  fields: Partial<Omit<FixtureManifest, 'dist' | 'name' | 'version'>> = {},
  files: Readonly<Record<string, string>> = {},
): Promise<RegistryEntry> {
  const manifest: FixtureManifest = {
    name,
    version,
    ...fields,
    dist: { tarball: `https://registry.test/${encodeURIComponent(name)}-${version}.tgz` },
  };
  const { dist: _dist, ...packageManifest } = manifest;
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries({
    'package.json': JSON.stringify(packageManifest),
    ...files,
  })) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  const tarball = await gzip(concat(...chunks, TAR_TRAILER));
  manifest.dist.integrity = await computeIntegrity(tarball);
  return { manifest, tarball };
}

async function officialSourceEntry(): Promise<RegistryEntry> {
  return {
    manifest: {
      name: SOURCE,
      version: SOURCE_VERSION,
      dependencies: { [BUNDLED]: '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [BUNDLED],
      main: 'index.mjs',
      module: 'index.mjs',
      type: 'module',
      dist: { tarball: SOURCE_URL, integrity: SOURCE_INTEGRITY },
    },
    tarball: new Uint8Array(await readFile(REAL_TARBALL_URL)),
  };
}

export async function scopeEntries(scope: Scope): Promise<RegistryEntry[]> {
  const entries = [await officialSourceEntry(), await registryEntry(BUNDLED, BUNDLED_VERSION)];
  if (scope === 'nested') {
    entries.push(
      await registryEntry(SOURCE, '1.32.1'),
      await registryEntry('nested-host', '1.0.0', {
        dependencies: { lightningcss: '^1.32.0' },
      }),
    );
  }
  return entries;
}

export class LedgerCache implements TarballCache {
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  readonly #entries = new Map<string, Uint8Array>();

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version}`);
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    this.puts.push(`${name}@${version}`);
    this.#entries.set(`${name}\0${version}\0${integrity}`, bytes.slice());
    return `memory:${name}@${version}`;
  }

  clearLedger(): void {
    this.gets.length = 0;
    this.puts.length = 0;
  }
}

export class LedgerVfs extends MemoryVfs {
  readonly mutations: string[] = [];

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    this.mutations.push(`write:${path}`);
    await super.writeFile(path, data);
  }

  override async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.mutations.push(`mkdir:${path}`);
    await super.mkdir(path, options);
  }

  override async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    this.mutations.push(`rm:${path}`);
    await super.rm(path, options);
  }

  override async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    this.mutations.push(`utimes:${path}`);
    await super.utimes(path, atimeMs, mtimeMs);
  }

  clearLedger(): void {
    this.mutations.length = 0;
  }
}

export class LedgerRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];
  readonly #entries: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;

  constructor(entries: readonly RegistryEntry[]) {
    super({
      baseUrl: '/embedded-contract-registry',
      fetch: async () => new Response('', { status: 599 }),
    });
    const grouped = new Map<string, Map<string, RegistryEntry>>();
    for (const candidate of entries) {
      const versions = grouped.get(candidate.manifest.name) ?? new Map<string, RegistryEntry>();
      versions.set(candidate.manifest.version, candidate);
      grouped.set(candidate.manifest.name, versions);
    }
    this.#entries = grouped;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    const entries = this.#entries.get(name);
    if (!entries) throw new Error(`embedded contract registry has no packument for ${name}`);
    const versions: Record<string, VersionManifest> = {};
    for (const [version, candidate] of entries) versions[version] = candidate.manifest;
    return {
      name,
      'dist-tags': { latest: [...entries.keys()].sort().at(-1) ?? '0.0.0' },
      versions,
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads.push(url);
    for (const versions of this.#entries.values()) {
      for (const candidate of versions.values()) {
        if (candidate.manifest.dist.tarball === url) return candidate.tarball.slice();
      }
    }
    throw new Error(`embedded contract registry has no tarball for ${url}`);
  }
}

export async function installFixture(
  vfs: MemoryVfs,
  registry: RegistryClient,
  dependencies: Readonly<Record<string, string>>,
  cache: TarballCache,
  reports: string[],
  resolverUrl?: string,
) {
  return install(
    'fixture',
    '1.0.0',
    { ...dependencies },
    {
      vfs,
      cwd: '/project',
      registry,
      tarballCache: cache,
      ...(resolverUrl === undefined ? {} : { resolverUrl }),
      onSubstitution: (line) => reports.push(line),
    },
  );
}

export async function writeProject(
  vfs: MemoryVfs,
  dependencies: Readonly<Record<string, string>>,
  lockfile?: Lockfile,
): Promise<Uint8Array | undefined> {
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies }),
  );
  if (lockfile === undefined) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(lockfile, null, 2));
  await vfs.writeFile('/project/package-lock.json', bytes);
  return bytes;
}

export async function freshScope(scope: Scope) {
  const entries = await scopeEntries(scope);
  const dependencies = scopeDependencies(scope);
  const registry = new LedgerRegistry(entries);
  const cache = new LedgerCache();
  const reports: string[] = [];
  const vfs = new LedgerVfs();
  await writeProject(vfs, dependencies);
  vfs.clearLedger();
  const result = await installFixture(vfs, registry, dependencies, cache, reports);
  return { cache, dependencies, entries, registry, reports, result, vfs };
}

export function parentOnlyLockfile(lockfile: Lockfile, scope: Scope): Lockfile {
  const next = structuredClone(lockfile) as EmbeddedLockfile;
  const paths = scopePaths(scope);
  const acquisition = next.packages[paths.acquisition];
  if (!acquisition) throw new Error(`fixture lock is missing ${paths.acquisition}`);
  acquisition.dependencies = { [BUNDLED]: '^1.0.1' };
  acquisition.bundleDependencies = [BUNDLED];
  for (const path of Object.keys(next.packages)) {
    const bare = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (bare === BUNDLED) Reflect.deleteProperty(next.packages, path);
  }
  const root = next.packages[''];
  if (!root) throw new Error('fixture lock is missing its root entry');
  const rootDependencies = { ...(root.dependencies ?? {}) };
  Reflect.deleteProperty(rootDependencies, BUNDLED);
  root.dependencies = rootDependencies;
  next.packages[paths.child] = { version: BUNDLED_VERSION, inBundle: true };
  return next;
}

export async function parentOnlyCache(entries: readonly RegistryEntry[]): Promise<LedgerCache> {
  const cache = new LedgerCache();
  for (const entry of entries) {
    if (entry.manifest.name === BUNDLED) continue;
    const integrity = entry.manifest.dist.integrity;
    if (!integrity) throw new Error(`fixture entry ${entry.manifest.name} lacks integrity`);
    await cache.put(entry.manifest.name, entry.manifest.version, integrity, entry.tarball);
  }
  cache.clearLedger();
  return cache;
}

export async function eddyBundleFor(
  lockfile: Lockfile,
  entries: readonly RegistryEntry[],
): Promise<Uint8Array> {
  const byUrl = new Map(entries.map((entry) => [entry.manifest.dist.tarball, entry]));
  const tarballs: Array<{
    entry: { file: string; name: string; version: string; integrity: string };
    bytes: Uint8Array;
  }> = [];
  const seen = new Set<string>();
  for (const [installPath, pinned] of Object.entries(lockfile.packages)) {
    if (installPath === '' || !pinned.resolved || !pinned.integrity) continue;
    const source = byUrl.get(pinned.resolved);
    if (!source) throw new Error(`Eddy fixture has no pinned bytes for ${pinned.resolved}`);
    const key = `${source.manifest.name}@${pinned.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tarballs.push({
      entry: {
        file: `tarballs/${source.manifest.name}-${pinned.version}.tgz`,
        name: source.manifest.name,
        version: pinned.version,
        integrity: pinned.integrity,
      },
      bytes: source.tarball,
    });
  }
  return packEddyBundle({
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0-contract',
      asOf: {
        resolvedAt: '2026-08-02T00:00:00.000Z',
        registry: 'https://registry.test',
        closureHash: await closureHashOf(lockfile),
      },
      tarballs: tarballs.map(({ entry }) => entry),
    },
    lockfileText: JSON.stringify(lockfile),
    tarballs,
  });
}

export type TreeEntry =
  | Readonly<{ kind: 'directory' }>
  | Readonly<{ kind: 'file'; bytes: readonly number[] }>;

export async function snapshotTree(
  vfs: MemoryVfs,
  root: string,
): Promise<Record<string, TreeEntry>> {
  const snapshot: Record<string, TreeEntry> = {};
  const visit = async (path: string, relative: string): Promise<void> => {
    for (const child of await vfs.readdir(path)) {
      const childPath = `${path}/${child.name}`;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory) {
        snapshot[childRelative] = { kind: 'directory' };
        await visit(childPath, childRelative);
      } else {
        snapshot[childRelative] = { kind: 'file', bytes: [...(await vfs.readFile(childPath))] };
      }
    }
  };
  await visit(root, '');
  return snapshot;
}
