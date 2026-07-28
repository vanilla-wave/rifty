import {
  type BuiltinShadowSubstitutionRecipe,
  builtinShadowSubstitutionCatalog,
} from '@riftydev/shadow-registry/internal';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../_test-fixtures/tar-builder.ts';
import { install } from '../../installer.ts';
import type { Packument, VersionManifest } from '../../registry.ts';
import { RegistryClient } from '../../registry.ts';
import { type TarballCache, computeIntegrity } from '../../tarball-cache.ts';
import { attestBuiltinShadowSubstitution } from './planner.ts';

type RegistryManifest = VersionManifest & {
  bundleDependencies?: string[];
  bundledDependencies?: string[];
};

interface RegistryEntry {
  readonly manifest: RegistryManifest;
  readonly tarball: Uint8Array;
  readonly files: Readonly<Record<string, string>>;
}

const encoder = new TextEncoder();

async function entry(
  name: string,
  version: string,
  fields: Partial<Omit<RegistryManifest, 'dist' | 'name' | 'version'>> = {},
  files: Readonly<Record<string, string>> = {},
): Promise<RegistryEntry> {
  const manifest: RegistryManifest = {
    name,
    version,
    ...fields,
    dist: { tarball: `https://registry.test/${encodeURIComponent(name)}-${version}.tgz` },
  };
  const { dist: _dist, ...packageManifest } = manifest;
  const packageFiles = {
    'package.json': JSON.stringify(packageManifest),
    ...files,
  };
  const chunks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(packageFiles)) {
    const bytes = encoder.encode(content);
    chunks.push(buildHeader(`package/${path}`, bytes.byteLength), padToBlock(bytes));
  }
  const tarball = await gzip(concat(...chunks, TAR_TRAILER));
  manifest.dist.integrity = await computeIntegrity(tarball);
  return { manifest, tarball, files: packageFiles };
}

class PreseededTarballCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];

  constructor(entries: readonly RegistryEntry[]) {
    for (const candidate of entries) {
      const integrity = candidate.manifest.dist.integrity;
      if (!integrity) throw new Error(`preseeded ${candidate.manifest.name} has no integrity`);
      this.#entries.set(
        `${candidate.manifest.name}\0${candidate.manifest.version}\0${integrity}`,
        candidate.tarball.slice(),
      );
    }
  }

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.gets.push(`${name}@${version}`);
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string): Promise<string> {
    this.puts.push(`${name}@${version}`);
    throw new Error(`preseeded replay attempted cache write for ${name}@${version}`);
  }
}

class LedgerRegistry extends RegistryClient {
  readonly #entries: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>;
  readonly packumentReads: string[] = [];
  readonly tarballReads: string[] = [];
  #denyReads = false;

  constructor(entries: readonly RegistryEntry[]) {
    super({ baseUrl: '/contract-registry', fetch: async () => new Response('', { status: 599 }) });
    const grouped = new Map<string, Map<string, RegistryEntry>>();
    for (const candidate of entries) {
      const versions = grouped.get(candidate.manifest.name) ?? new Map();
      versions.set(candidate.manifest.version, candidate);
      grouped.set(candidate.manifest.name, versions);
    }
    this.#entries = grouped;
  }

  denyReads(): void {
    this.packumentReads.length = 0;
    this.tarballReads.length = 0;
    this.#denyReads = true;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads.push(name);
    if (this.#denyReads) throw new Error(`replay read packument ${name}`);
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
    if (this.#denyReads) throw new Error(`replay read tarball ${url}`);
    for (const versions of this.#entries.values()) {
      for (const candidate of versions.values()) {
        if (candidate.manifest.dist.tarball === url) return candidate.tarball.slice();
      }
    }
    throw new Error(`contract registry has no tarball for ${url}`);
  }
}

const lightningRecipe = builtinShadowSubstitutionCatalog.recipes.find(
  (recipe) => recipe.trigger.name === 'lightningcss',
);
if (!lightningRecipe || lightningRecipe.acquisition.kind !== 'registry') {
  throw new Error('builtin LightningCSS registry recipe is missing');
}
const checkedLightningRecipe: Readonly<BuiltinShadowSubstitutionRecipe> = lightningRecipe;
const lightningAcquisition = lightningRecipe.acquisition;
const lightningProjection = lightningAcquisition.dependencyProjection;
const lightningSourceUrl = `https://registry.test/${encodeURIComponent(
  lightningAcquisition.name,
)}-${lightningAcquisition.version}.tgz`;
const bundledNapiManifest = JSON.stringify({ name: 'napi-wasm', version: '1.1.3' });
const bundledNapiIndex = 'module.exports = "bundled napi-wasm";\n';

interface ProjectionFields {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  bundleDependencies: string[];
}

function expectedLightningFields(): ProjectionFields {
  return {
    dependencies: { 'napi-wasm': '^1.0.1' },
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: ['napi-wasm'],
  };
}

async function lightningEntry(fields = expectedLightningFields()): Promise<RegistryEntry> {
  return await entry(
    lightningAcquisition.name,
    lightningAcquisition.version,
    {
      ...fields,
      bin: {
        lightningcss: 'bin/acquired.js',
        'acquired-only': 'bin/acquired.js',
      },
    },
    {
      'bin/acquired.js': '#!/usr/bin/env node\nthrow new Error("acquired bin leaked");\n',
      'node_modules/napi-wasm/package.json': bundledNapiManifest,
      'node_modules/napi-wasm/index.js': bundledNapiIndex,
    },
  );
}

async function lightningRegistry(fields = expectedLightningFields()): Promise<LedgerRegistry> {
  return new LedgerRegistry([await lightningEntry(fields)]);
}

async function lightningDriftRegistry(fields: ProjectionFields): Promise<LedgerRegistry> {
  return new LedgerRegistry([
    await lightningEntry(fields),
    await entry('napi-wasm', '1.1.3'),
    await entry('napi-wasm', '9.9.9'),
    await entry('@drift/required', '1.0.0'),
    await entry('@drift/retained', '1.0.0'),
    await entry('@drift/omitted', '1.0.0'),
    await entry('@drift/peer', '1.0.0'),
    await entry('@drift/bundled', '1.0.0'),
  ]);
}

async function installFixture(
  vfs: MemoryVfs,
  registry: RegistryClient,
  dependencies: Readonly<Record<string, string>>,
  tarballCache?: TarballCache,
) {
  return await install(
    'fixture',
    '1.0.0',
    { ...dependencies },
    {
      vfs,
      cwd: '/project',
      registry,
      ...(tarballCache ? { tarballCache } : {}),
      onSubstitution: () => {},
    },
  );
}

type TreeEntry =
  | Readonly<{ kind: 'directory' }>
  | Readonly<{ kind: 'file'; bytes: readonly number[] }>;

async function snapshotTree(vfs: MemoryVfs, root: string): Promise<Record<string, TreeEntry>> {
  const snapshot: Record<string, TreeEntry> = {};
  const visit = async (path: string, relative: string): Promise<void> => {
    for (const child of await vfs.readdir(path)) {
      const childPath = `${path}/${child.name}`;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory) {
        snapshot[childRelative] = { kind: 'directory' };
        await visit(childPath, childRelative);
      } else {
        snapshot[childRelative] = {
          kind: 'file',
          bytes: [...(await vfs.readFile(childPath))],
        };
      }
    }
  };
  await visit(root, '');
  return snapshot;
}

type DesiredLockfile = Readonly<{
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  rifty?: unknown;
}>;

function integrityOf(candidate: RegistryEntry): string {
  const integrity = candidate.manifest.dist.integrity;
  if (!integrity) throw new Error(`${candidate.manifest.name} fixture has no integrity`);
  return integrity;
}

async function writeReplaySeed(
  vfs: MemoryVfs,
  dependencies: Readonly<Record<string, string>>,
  lockfile: DesiredLockfile,
): Promise<void> {
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies }),
  );
  await vfs.writeFile('/project/package-lock.json', JSON.stringify(lockfile, null, 2));
}

function withMaterializedBin(
  recipe: BuiltinShadowSubstitutionRecipe,
  fact: ReturnType<typeof attestBuiltinShadowSubstitution>,
) {
  return {
    ...fact,
    materialization: {
      ...fact.materialization,
      bin: { ...recipe.materialization.bin },
    },
  };
}

function desiredShadowReplayLock(source: RegistryEntry): DesiredLockfile {
  const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
    (recipe) => recipe.trigger.name === 'esbuild',
  );
  if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
  const sourceIntegrity = integrityOf(source);
  const esbuildFact = withMaterializedBin(
    esbuildRecipe,
    attestBuiltinShadowSubstitution({
      trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
      installPath: 'node_modules/esbuild',
      acquisition: { kind: 'synthetic' },
    }),
  );
  const lightningFact = withMaterializedBin(
    checkedLightningRecipe,
    attestBuiltinShadowSubstitution({
      trigger: { name: 'lightningcss', requestedRange: '1.32.0', version: '1.32.0' },
      installPath: 'node_modules/lightningcss',
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        resolved: source.manifest.dist.tarball,
        integrity: sourceIntegrity,
      },
    }),
  );
  return {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        version: '1.0.0',
        dependencies: { esbuild: '0.28.0', 'lightningcss-wasm': '1.32.0' },
      },
      'node_modules/esbuild': {
        version: '0.28.0',
        dependencies: {},
        bin: { esbuild: 'bin/esbuild' },
        resolved: `rifty:shadow-substitution/${esbuildRecipe.id}@${esbuildRecipe.digest}`,
        riftyShadowRecipe: esbuildRecipe.id,
      },
      'node_modules/lightningcss': {
        version: '1.32.0',
        riftyShadowRecipe: checkedLightningRecipe.id,
      },
      'node_modules/lightningcss-wasm': {
        version: '1.32.0',
        dependencies: { 'napi-wasm': '^1.0.1' },
        bundleDependencies: ['napi-wasm'],
        resolved: source.manifest.dist.tarball,
        integrity: sourceIntegrity,
      },
      'node_modules/lightningcss-wasm/node_modules/napi-wasm': {
        version: '1.1.3',
        inBundle: true,
      },
    },
    rifty: {
      shadowSubstitutions: {
        protocol: 'rifty.shadow-substitutions/v2',
        applied: [esbuildFact, lightningFact],
      },
    },
  };
}

function addExpectedFile(snapshot: Record<string, TreeEntry>, path: string, content: string): void {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    snapshot[parts.slice(0, index).join('/')] = { kind: 'directory' };
  }
  snapshot[path] = { kind: 'file', bytes: [...encoder.encode(content)] };
}

function expectedShadowReplayTree(source: RegistryEntry): Record<string, TreeEntry> {
  const expected: Record<string, TreeEntry> = {};
  for (const [path, content] of Object.entries(source.files)) {
    addExpectedFile(expected, `lightningcss-wasm/${path}`, content);
  }
  for (const file of checkedLightningRecipe.materialization.files) {
    addExpectedFile(expected, `lightningcss/${file.path}`, file.content);
  }
  const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
    (recipe) => recipe.trigger.name === 'esbuild',
  );
  if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
  for (const file of esbuildRecipe.materialization.files) {
    addExpectedFile(expected, `esbuild/${file.path}`, file.content);
  }
  addExpectedFile(
    expected,
    '.bin/esbuild',
    "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n",
  );
  return expected;
}

const projectionDrifts = [
  {
    label: 'dependencies range',
    mutate(fields: ProjectionFields): void {
      fields.dependencies['napi-wasm'] = '9.9.9';
    },
  },
  {
    label: 'dependencies scoped member',
    mutate(fields: ProjectionFields): void {
      fields.dependencies['@drift/required'] = '1.0.0';
    },
  },
  {
    label: 'retained optional scoped member',
    mutate(fields: ProjectionFields): void {
      fields.optionalDependencies['@drift/retained'] = '1.0.0';
    },
  },
  {
    label: 'omitted optional scoped member',
    mutate(fields: ProjectionFields): void {
      fields.optionalDependencies['@drift/omitted'] = '1.0.0';
    },
  },
  {
    label: 'peer scoped member',
    mutate(fields: ProjectionFields): void {
      fields.peerDependencies['@drift/peer'] = '^1.0.0';
    },
  },
  {
    label: 'bundled member removal',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies = [];
    },
  },
  {
    label: 'bundled scoped member',
    mutate(fields: ProjectionFields): void {
      fields.bundleDependencies.push('@drift/bundled');
    },
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 execution authority', () => {
  it.each(projectionDrifts)(
    '[fault: observable-order/provenance-lie] rejects builtin $label drift before tarball or VFS work',
    async ({ label, mutate }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fields = expectedLightningFields();
      mutate(fields);
      const registry = await lightningDriftRegistry(fields);
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const writers = [
        { name: 'mkdir', spy: vi.spyOn(vfs, 'mkdir') },
        { name: 'writeFile', spy: vi.spyOn(vfs, 'writeFile') },
        { name: 'rm', spy: vi.spyOn(vfs, 'rm') },
        { name: 'utimes', spy: vi.spyOn(vfs, 'utimes') },
      ];

      const outcome = await installFixture(vfs, registry, {
        lightningcss: '1.32.0',
      }).then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );

      expect.soft(outcome.status, `${label}: outcome`).toBe('rejected');
      const actualError = outcome.status === 'rejected' ? outcome.error : undefined;
      expect
        .soft(
          {
            name: actualError instanceof Error ? actualError.name : undefined,
            feature:
              actualError !== null && typeof actualError === 'object' && 'feature' in actualError
                ? actualError.feature
                : undefined,
          },
          `${label}: rejection`,
        )
        .toEqual({
          name: 'NotImplementedError',
          feature: lightningProjection.unsupportedFeature,
        });
      expect
        .soft(registry.packumentReads, `${label}: source manifest read`)
        .toContain(lightningAcquisition.name);
      expect.soft(registry.tarballReads, `${label}: pre-tarball rejection`).toEqual([]);
      for (const writer of writers) {
        expect.soft(writer.spy.mock.calls.length, `${label}: ${writer.name} calls`).toBe(0);
      }
      expect.soft(await vfs.exists('/project/node_modules'), `${label}: install tree`).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json'), `${label}: lockfile`).toBe(false);
    },
  );

  it('traverses retained projection, suppresses acquired bins, and publishes recipe bins', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await lightningRegistry();
    const result = await installFixture(vfs, registry, {
      lightningcss: '1.32.0',
      esbuild: '0.28.0',
    });

    expect(result.lockfile.packages['node_modules/lightningcss-wasm']).toMatchObject({
      version: '1.32.0',
      dependencies: lightningProjection.dependencies,
      bundleDependencies: ['napi-wasm'],
    });
    expect(
      result.lockfile.packages['node_modules/lightningcss-wasm/node_modules/napi-wasm'],
    ).toMatchObject({
      version: '1.1.3',
      inBundle: true,
    });
    expect(result.lockfile.packages['node_modules/lightningcss-wasm']).not.toHaveProperty('bin');
    expect(result.lockfile.packages['node_modules/napi-wasm']).toBeUndefined();
    expect(
      await vfs.readFileText(
        '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/package.json',
      ),
    ).toBe(bundledNapiManifest);
    expect(
      await vfs.readFileText(
        '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/index.js',
      ),
    ).toBe(bundledNapiIndex);
    await expect(vfs.exists('/project/node_modules/napi-wasm')).resolves.toBe(false);
    expect(registry.packumentReads).toEqual([lightningAcquisition.name]);
    expect(registry.tarballReads).toEqual([lightningSourceUrl]);
    for (const file of lightningRecipe.materialization.files) {
      expect(await vfs.readFileText(`/project/node_modules/lightningcss/${file.path}`)).toBe(
        file.content,
      );
    }
    await expect(vfs.exists('/project/node_modules/.bin/lightningcss')).resolves.toBe(false);
    await expect(vfs.exists('/project/node_modules/.bin/acquired-only')).resolves.toBe(false);

    const esbuildRecipe = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'esbuild',
    );
    if (!esbuildRecipe) throw new Error('builtin esbuild recipe is missing');
    expect(result.lockfile.packages['node_modules/esbuild']).toMatchObject({
      bin: esbuildRecipe.materialization.bin,
      riftyShadowRecipe: esbuildRecipe.id,
    });
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      "#!/usr/bin/env node\nimport('../esbuild/bin/esbuild');\n",
    );
  });

  it('replays a pre-seeded v2 LightningCSS + esbuild tree, bins, and lock with zero registry reads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    const dependencies = { lightningcss: '1.32.0', esbuild: '0.28.0' };
    const source = await lightningEntry();
    const lockfile = desiredShadowReplayLock(source);
    await writeReplaySeed(vfs, dependencies, lockfile);
    const lockBefore = await vfs.readFile('/project/package-lock.json');
    const registry = new LedgerRegistry([]);
    registry.denyReads();
    const cache = new PreseededTarballCache([source]);

    const result = await installFixture(vfs, registry, dependencies, cache);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(cache.gets).toEqual(['lightningcss-wasm@1.32.0']);
    expect(cache.puts).toEqual([]);
    expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(
      expectedShadowReplayTree(source),
    );
    expect(result.lockfile).toEqual(lockfile);
    expect(JSON.parse(await vfs.readFileText('/project/package-lock.json'))).toEqual(lockfile);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });
});
