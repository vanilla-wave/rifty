import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { closureHashOf } from './closure-hash.ts';
import { EDDY_BUNDLE_FORMAT, packEddyBundle } from './eddy-bundle.ts';
import { install } from './installer.ts';
import type { Lockfile } from './linker.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { type TarballCache, computeIntegrity } from './tarball-cache.ts';

const SOURCE = 'lightningcss-wasm';
const SOURCE_VERSION = '1.32.0';
const BUNDLED = 'napi-wasm';
const BUNDLED_VERSION = '1.1.3';
const SOURCE_URL = `https://registry.test/${SOURCE}-${SOURCE_VERSION}.tgz`;
const SOURCE_INTEGRITY =
  'sha512-SteAkCtRuSCDYPGHKhLV/dDs5Bk+7I4QUxWxfk4xwsTI1rQk8MQyYtpGcd3NECsUGzK0q2/KqoVS+YHCqKHUTQ==';
const REAL_TARBALL_URL = new URL(
  '../../../tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0.tgz',
  import.meta.url,
);
const FEATURE = 'lightningcss.acquisition';

const REAL_FILES = [
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

interface ProjectionFields {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  bundleDependencies: string[];
}

type FixtureManifest = VersionManifest & {
  readonly bundleDependencies?: readonly string[];
  readonly bundledDependencies?: readonly string[];
};

interface RegistryEntry {
  readonly manifest: FixtureManifest;
  readonly tarball: Uint8Array;
}

function exactProjection(): ProjectionFields {
  return {
    dependencies: { [BUNDLED]: '^1.0.1' },
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: [BUNDLED],
  };
}

async function registryEntry(
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

async function mutationSourceEntry(
  fields = exactProjection(),
  embeddedManifest: Readonly<{ name: string; version: string }> | null = {
    name: BUNDLED,
    version: BUNDLED_VERSION,
  },
): Promise<RegistryEntry> {
  return await registryEntry(
    SOURCE,
    SOURCE_VERSION,
    {
      ...fields,
      bin: {
        lightningcss: 'bin/acquired.js',
        'acquired-only': 'bin/acquired.js',
      },
    },
    {
      'bin/acquired.js': 'throw new Error("acquired twin bin leaked");\n',
      ...(embeddedManifest === null
        ? {}
        : {
            [`node_modules/${BUNDLED}/package.json`]: JSON.stringify(embeddedManifest),
          }),
      [`node_modules/${BUNDLED}/index.js`]: 'module.exports = "bundled napi-wasm";\n',
    },
  );
}

async function officialSourceEntry(): Promise<RegistryEntry> {
  return {
    manifest: {
      name: SOURCE,
      version: SOURCE_VERSION,
      ...exactProjection(),
      main: 'index.mjs',
      module: 'index.mjs',
      type: 'module',
      dist: { tarball: SOURCE_URL, integrity: SOURCE_INTEGRITY },
    },
    tarball: new Uint8Array(await readFile(REAL_TARBALL_URL)),
  };
}

class LedgerCache implements TarballCache {
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

class LedgerRegistry extends RegistryClient {
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];
  readonly #entries: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;

  constructor(entries: readonly RegistryEntry[]) {
    super({ baseUrl: '/contract-registry', fetch: async () => new Response('', { status: 599 }) });
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
    if (!entries) throw new Error(`contract registry has no packument for ${name}`);
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
    throw new Error(`contract registry has no tarball for ${url}`);
  }
}

const projectionDrifts = [
  {
    label: 'required dependency removal',
    mutate(fields: ProjectionFields): void {
      fields.dependencies = {};
    },
  },
  {
    label: 'required dependency range change',
    mutate(fields: ProjectionFields): void {
      fields.dependencies[BUNDLED] = '9.9.9';
    },
  },
  {
    label: 'required dependency addition',
    mutate(fields: ProjectionFields): void {
      fields.dependencies['@drift/required'] = '1.0.0';
    },
  },
  {
    label: 'optional dependency addition',
    mutate(fields: ProjectionFields): void {
      fields.optionalDependencies['@drift/optional'] = '1.0.0';
    },
  },
  {
    label: 'peer dependency addition',
    mutate(fields: ProjectionFields): void {
      fields.peerDependencies['@drift/peer'] = '^1.0.0';
    },
  },
  {
    label: 'bundle removal',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies = [];
    },
  },
  {
    label: 'bundle addition',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies.push('@drift/bundled');
    },
  },
  {
    label: 'bundle member change',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies = ['@drift/bundled'];
    },
  },
] as const;

const embeddedManifestDrifts = [
  { label: 'missing manifest', manifest: null },
  {
    label: 'name drift',
    manifest: { name: '@drift/napi-wasm', version: BUNDLED_VERSION },
  },
  {
    label: 'version/range drift',
    manifest: { name: BUNDLED, version: '9.9.9' },
  },
] as const;

async function poisonEntries(fields: ProjectionFields): Promise<RegistryEntry[]> {
  return [
    await mutationSourceEntry(fields),
    // Poison only: correct execution must consume the embedded member instead.
    await registryEntry(BUNDLED, BUNDLED_VERSION),
    await registryEntry(BUNDLED, '9.9.9'),
    await registryEntry('@drift/required', '1.0.0'),
    await registryEntry('@drift/optional', '1.0.0'),
    await registryEntry('@drift/peer', '1.0.0'),
    await registryEntry('@drift/bundled', '1.0.0'),
  ];
}

async function installFixture(
  vfs: MemoryVfs,
  registry: RegistryClient,
  dependencies: Readonly<Record<string, string>>,
  cache: TarballCache,
  reports: string[],
  resolverUrl?: string,
) {
  return await install(
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeProject(
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

async function eddyBundleFor(
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

async function expectInstalledAuthority(
  vfs: MemoryVfs,
  result: Awaited<ReturnType<typeof installFixture>>,
  scope: 'root' | 'nested',
): Promise<void> {
  const acquisitionPath =
    scope === 'root' ? `node_modules/${SOURCE}` : `node_modules/nested-host/node_modules/${SOURCE}`;
  const aliasPath =
    scope === 'root'
      ? 'node_modules/lightningcss'
      : 'node_modules/nested-host/node_modules/lightningcss';
  const childPath = `${acquisitionPath}/node_modules/${BUNDLED}`;
  const acquisition = result.lockfile.packages[acquisitionPath];
  const expectedLockPaths =
    scope === 'root'
      ? ['', aliasPath, acquisitionPath, childPath]
      : [
          '',
          'node_modules/lightningcss-wasm',
          'node_modules/nested-host',
          aliasPath,
          acquisitionPath,
          childPath,
        ];

  expect
    .soft(Object.keys(result.lockfile.packages).sort(), `${scope}: lock paths`)
    .toEqual(expectedLockPaths.sort());
  expect.soft(acquisition).toMatchObject({
    version: SOURCE_VERSION,
    resolved: SOURCE_URL,
    integrity: SOURCE_INTEGRITY,
    dependencies: { [BUNDLED]: '^1.0.1' },
    bundleDependencies: [BUNDLED],
  });
  expect.soft(acquisition).not.toHaveProperty('bin');
  expect.soft(result.lockfile.packages[childPath]).toEqual({
    version: BUNDLED_VERSION,
    inBundle: true,
  });
  expect.soft(result.lockfile.packages[`node_modules/${BUNDLED}`]).toBeUndefined();
  expect.soft(result.packages.some(({ name }) => name === BUNDLED)).toBe(false);
  expect
    .soft(result.packages.find(({ installPath }) => installPath === acquisitionPath)?.bin)
    .toBe(undefined);

  for (const file of REAL_FILES) {
    const bytes = await vfs.readFile(`/project/${acquisitionPath}/${file.path}`);
    expect.soft(bytes.byteLength, `${scope}: ${file.path} bytes`).toBe(file.bytes);
    expect.soft(sha256(bytes), `${scope}: ${file.path} sha256`).toBe(file.sha256);
  }
  const sourceManifest = JSON.parse(
    await vfs.readFileText(`/project/${acquisitionPath}/package.json`),
  ) as Record<string, unknown>;
  expect.soft(sourceManifest).toMatchObject({
    name: SOURCE,
    version: SOURCE_VERSION,
    dependencies: { [BUNDLED]: '^1.0.1' },
    bundledDependencies: [BUNDLED],
  });
  const bundledManifest = JSON.parse(
    await vfs.readFileText(`/project/${childPath}/package.json`),
  ) as Record<string, unknown>;
  expect.soft(bundledManifest).toMatchObject({ name: BUNDLED, version: BUNDLED_VERSION });
  expect.soft(await vfs.exists('/project/node_modules/napi-wasm')).toBe(false);
  expect.soft(await vfs.exists('/project/node_modules/.bin/lightningcss')).toBe(false);
  expect.soft(await vfs.exists('/project/node_modules/.bin/acquired-only')).toBe(false);
}

function errorFact(error: unknown): Readonly<{ name?: unknown; feature?: unknown }> {
  if (error === null || typeof error !== 'object') return {};
  return {
    name: error instanceof Error ? error.name : undefined,
    feature: 'feature' in error ? error.feature : undefined,
  };
}

async function expectFreshAuthority(scope: 'root' | 'nested'): Promise<void> {
  const source = await officialSourceEntry();
  const entries: RegistryEntry[] = [
    source,
    // Poison only: any request proves bundled traversal leaked.
    await registryEntry(BUNDLED, BUNDLED_VERSION),
  ];
  const dependencies: Record<string, string> =
    scope === 'root' ? { lightningcss: '^1.32.0' } : { [SOURCE]: '1.32.1', 'nested-host': '1.0.0' };
  if (scope === 'nested') {
    entries.push(
      await registryEntry(SOURCE, '1.32.1'),
      await registryEntry('nested-host', '1.0.0', {
        dependencies: { lightningcss: '^1.32.0' },
      }),
    );
  }
  const registry = new LedgerRegistry(entries);
  const cache = new LedgerCache();
  const reports: string[] = [];
  const vfs = new MemoryVfs();
  await writeProject(vfs, dependencies);

  const result = await installFixture(vfs, registry, dependencies, cache, reports);
  await expectInstalledAuthority(vfs, result, scope);
  expect.soft(registry.packumentReads.filter((name) => name === BUNDLED)).toEqual([]);
  expect.soft(registry.tarballReads.some((url) => url.includes(BUNDLED))).toBe(false);
  expect.soft(cache.gets.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect.soft(cache.puts.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect(reports).toContain(
    'npm: lightningcss@^1.32.0 materialized from shadow registry (rifty.shadow-substitution.lightningcss.v2)',
  );

  cache.clearLedger();
  const replayVfs = new MemoryVfs();
  const lockBytes = await writeProject(replayVfs, dependencies, result.lockfile);
  if (lockBytes === undefined) throw new Error('replay fixture lock bytes are missing');
  const replayRegistry = new LedgerRegistry([]);
  const replayReports: string[] = [];
  const replay = await installFixture(
    replayVfs,
    replayRegistry,
    dependencies,
    cache,
    replayReports,
  );
  await expectInstalledAuthority(replayVfs, replay, scope);
  expect.soft(replayRegistry.packumentReads, `${scope}: replay packuments`).toEqual([]);
  expect.soft(replayRegistry.tarballReads, `${scope}: replay tarballs`).toEqual([]);
  expect.soft(cache.gets).toContain(`${SOURCE}@${SOURCE_VERSION}`);
  expect.soft(cache.gets.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect.soft(cache.puts).toEqual([]);
  expect.soft(await replayVfs.readFile('/project/package-lock.json')).toEqual(lockBytes);

  const bundle = await eddyBundleFor(result.lockfile, entries);
  const eddyVfs = new MemoryVfs();
  await writeProject(eddyVfs, dependencies);
  const eddyRegistry = new LedgerRegistry([]);
  const eddyCache = new LedgerCache();
  const eddyReports: string[] = [];
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(bundle as unknown as BodyInit));
  const eddy = await installFixture(
    eddyVfs,
    eddyRegistry,
    dependencies,
    eddyCache,
    eddyReports,
    'https://eddy.test/resolve',
  );
  await expectInstalledAuthority(eddyVfs, eddy, scope);
  expect.soft(fetchSpy).toHaveBeenCalledTimes(1);
  expect.soft(eddyRegistry.packumentReads, `${scope}: Eddy packuments`).toEqual([]);
  expect.soft(eddyRegistry.tarballReads, `${scope}: Eddy tarballs`).toEqual([]);
  expect.soft(eddyCache.gets.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect.soft(eddyCache.puts.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 acquisition authority', () => {
  it.each(projectionDrifts)(
    '[fault: observable-order/provenance-lie] rejects $label before acquisition effects',
    async ({ label, mutate }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fields = exactProjection();
      mutate(fields);
      const registry = new LedgerRegistry(await poisonEntries(fields));
      const cache = new LedgerCache();
      const reports: string[] = [];
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const writers = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      const outcome = await installFixture(
        vfs,
        registry,
        { lightningcss: '1.32.0' },
        cache,
        reports,
      ).then(
        (value) => ({ kind: 'resolved' as const, value }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      );

      expect.soft(outcome.kind, `${label}: outcome`).toBe('rejected');
      expect
        .soft(errorFact(outcome.kind === 'rejected' ? outcome.error : undefined), `${label}: error`)
        .toEqual({ name: 'NotImplementedError', feature: FEATURE });
      expect.soft(registry.packumentReads, `${label}: packuments`).toEqual([SOURCE]);
      expect.soft(registry.tarballReads, `${label}: tarballs`).toEqual([]);
      expect.soft(cache.gets, `${label}: cache gets`).toEqual([]);
      expect.soft(cache.puts, `${label}: cache puts`).toEqual([]);
      expect.soft(reports, `${label}: reports`).toEqual([]);
      for (const writer of writers) {
        expect.soft(writer.mock.calls.length, `${label}: VFS writer calls`).toBe(0);
      }
      expect.soft(await vfs.exists('/project/node_modules'), `${label}: tree`).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json'), `${label}: lock`).toBe(false);
    },
  );

  it.each(embeddedManifestDrifts)(
    '[fault: corrupt-input/provenance-lie] rejects embedded $label before link effects',
    async ({ label, manifest }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const registry = new LedgerRegistry([
        await mutationSourceEntry(exactProjection(), manifest),
        // Poison only: embedded validation must not resolve a replacement child.
        await registryEntry(BUNDLED, BUNDLED_VERSION),
      ]);
      const cache = new LedgerCache();
      const reports: string[] = [];
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const writers = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      const outcome = await installFixture(
        vfs,
        registry,
        { lightningcss: '1.32.0' },
        cache,
        reports,
      ).then(
        (value) => ({ kind: 'resolved' as const, value }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      );

      expect.soft(outcome.kind, `${label}: outcome`).toBe('rejected');
      expect
        .soft(errorFact(outcome.kind === 'rejected' ? outcome.error : undefined), `${label}: error`)
        .toEqual({ name: 'NotImplementedError', feature: FEATURE });
      expect.soft(registry.packumentReads, `${label}: packuments`).toEqual([SOURCE]);
      expect.soft(registry.tarballReads, `${label}: tarballs`).toEqual([SOURCE_URL]);
      expect.soft(cache.gets, `${label}: cache gets`).toEqual([`${SOURCE}@${SOURCE_VERSION}`]);
      expect.soft(cache.puts, `${label}: cache puts`).toEqual([`${SOURCE}@${SOURCE_VERSION}`]);
      expect.soft(reports, `${label}: reports`).toEqual([]);
      for (const writer of writers) {
        expect.soft(writer.mock.calls.length, `${label}: VFS writer calls`).toBe(0);
      }
      expect.soft(await vfs.exists('/project/node_modules'), `${label}: tree`).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json'), `${label}: lock`).toBe(false);
    },
  );

  it.each(['root', 'nested'] as const)(
    'consumes exact embedded acquisition at the %s scope through fresh, replay, and Eddy without a standalone child',
    expectFreshAuthority,
  );
});
