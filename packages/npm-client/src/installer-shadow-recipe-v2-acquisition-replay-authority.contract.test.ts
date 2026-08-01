import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { type TarballCache, computeIntegrity } from './tarball-cache.ts';

const SOURCE = 'lightningcss-wasm';
const SOURCE_VERSION = '1.32.0';
const BUNDLED = 'napi-wasm';
const BUNDLED_VERSION = '1.1.3';
const SOURCE_URL = `https://registry.test/${SOURCE}-${SOURCE_VERSION}.tgz`;
const FEATURE = 'lightningcss.acquisition';

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

async function sourceEntry(fields = exactProjection()): Promise<RegistryEntry> {
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
      [`node_modules/${BUNDLED}/package.json`]: JSON.stringify({
        name: BUNDLED,
        version: BUNDLED_VERSION,
      }),
      [`node_modules/${BUNDLED}/index.js`]: 'module.exports = "bundled napi-wasm";\n',
    },
  );
}

class LedgerCache implements TarballCache {
  readonly gets: string[] = [];
  readonly puts: string[] = [];

  async get(name: string, version: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version}`);
    return null;
  }

  async put(name: string, version: string): Promise<string> {
    this.puts.push(`${name}@${version}`);
    return `memory:${name}@${version}`;
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

async function poisonEntries(fields: ProjectionFields): Promise<RegistryEntry[]> {
  return [
    await sourceEntry(fields),
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
      onSubstitution: (line) => reports.push(line),
    },
  );
}

function errorFact(error: unknown): Readonly<{ name?: unknown; feature?: unknown }> {
  if (error === null || typeof error !== 'object') return {};
  return {
    name: error instanceof Error ? error.name : undefined,
    feature: 'feature' in error ? error.feature : undefined,
  };
}

async function expectFreshAuthority(scope: 'root' | 'nested'): Promise<void> {
  const source = await sourceEntry();
  const entries: RegistryEntry[] = [
    source,
    // Poison only: any request proves bundled traversal leaked.
    await registryEntry(BUNDLED, BUNDLED_VERSION),
  ];
  const dependencies: Record<string, string> =
    scope === 'root' ? { lightningcss: '^1.32.0' } : { [SOURCE]: '1.32.1', 'nested-host': '1.0.0' };
  const acquisitionPath =
    scope === 'root' ? `node_modules/${SOURCE}` : `node_modules/nested-host/node_modules/${SOURCE}`;
  const aliasPath =
    scope === 'root'
      ? 'node_modules/lightningcss'
      : 'node_modules/nested-host/node_modules/lightningcss';
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
  await vfs.mkdir('/project', { recursive: true });

  const result = await installFixture(vfs, registry, dependencies, cache, reports);
  const acquisition = result.lockfile.packages[acquisitionPath];
  const childPath = `${acquisitionPath}/node_modules/${BUNDLED}`;
  const trace = result.lockfile.rifty?.shadowSubstitutions;
  const applied = trace?.applied.find(
    ({ substitutionId }) => substitutionId === 'rifty.shadow-substitution.lightningcss.v2',
  );

  expect.soft(trace?.protocol).toBe('rifty.shadow-substitutions/v2');
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
  expect.soft(applied).toMatchObject({
    catalog: {
      id: 'rifty.shadow-substitutions.builtin.v2',
      digest: 'a037016265e1c348254b3f067403278f5baee8b1f39e2bcd16f535fd0b9c3b52',
    },
    substitutionId: 'rifty.shadow-substitution.lightningcss.v2',
    recipeDigest: '1800acdcf6efc1eb97de67a1fa4bb27d7f0c77c583b270644e258543be0dcfc4',
    acquisition: {
      kind: 'registry',
      name: SOURCE,
      version: SOURCE_VERSION,
      resolved: SOURCE_URL,
      dependencies: { [BUNDLED]: '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [BUNDLED],
      bundled: [{ name: BUNDLED, version: BUNDLED_VERSION, inBundle: true }],
    },
    materialization: { installPath: aliasPath, bin: {} },
  });
  if (acquisition !== undefined) {
    expect.soft(acquisition).toMatchObject({
      version: SOURCE_VERSION,
      dependencies: { [BUNDLED]: '^1.0.1' },
      bundleDependencies: [BUNDLED],
      resolved: SOURCE_URL,
    });
    expect.soft(acquisition).not.toHaveProperty('bin');
  }
  expect.soft(result.lockfile.packages[childPath]).toEqual({
    version: BUNDLED_VERSION,
    inBundle: true,
  });
  expect.soft(result.lockfile.packages[`node_modules/${BUNDLED}`]).toBeUndefined();
  expect.soft(result.packages.some(({ name }) => name === BUNDLED)).toBe(false);
  expect.soft(registry.packumentReads.filter((name) => name === BUNDLED)).toEqual([]);
  expect.soft(registry.tarballReads.some((url) => url.includes(BUNDLED))).toBe(false);
  expect.soft(cache.gets.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect.soft(cache.puts.filter((entry) => entry.startsWith(`${BUNDLED}@`))).toEqual([]);
  expect.soft(await vfs.exists('/project/node_modules/napi-wasm')).toBe(false);
  const embeddedManifestPath = `/project/${childPath}/package.json`;
  const embeddedIndexPath = `/project/${childPath}/index.js`;
  const embeddedManifestExists = await vfs.exists(embeddedManifestPath);
  const embeddedIndexExists = await vfs.exists(embeddedIndexPath);
  expect.soft(embeddedManifestExists).toBe(true);
  expect.soft(embeddedIndexExists).toBe(true);
  if (embeddedManifestExists) {
    expect(JSON.parse(await vfs.readFileText(embeddedManifestPath))).toMatchObject({
      name: BUNDLED,
      version: BUNDLED_VERSION,
    });
  }
  if (embeddedIndexExists) {
    expect(await vfs.readFileText(embeddedIndexPath)).toBe(
      'module.exports = "bundled napi-wasm";\n',
    );
  }
  expect(await vfs.exists('/project/node_modules/.bin/lightningcss')).toBe(false);
  expect(await vfs.exists('/project/node_modules/.bin/acquired-only')).toBe(false);
  expect(reports).toContain(
    'npm: lightningcss@^1.32.0 materialized from shadow registry (rifty.shadow-substitution.lightningcss.v2)',
  );
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

  it.each(['root', 'nested'] as const)(
    'consumes exact embedded acquisition at the %s scope without a standalone child',
    expectFreshAuthority,
  );
});
