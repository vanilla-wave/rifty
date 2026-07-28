import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
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

type RegistryManifest = VersionManifest & {
  bundleDependencies?: string[];
  bundledDependencies?: string[];
};

interface RegistryEntry {
  readonly manifest: RegistryManifest;
  readonly tarball: Uint8Array;
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
  const chunks: Uint8Array[] = [];
  for (const [path, content] of Object.entries({
    'package.json': JSON.stringify(packageManifest),
    ...files,
  })) {
    const bytes = encoder.encode(content);
    chunks.push(buildHeader(`package/${path}`, bytes.byteLength), padToBlock(bytes));
  }
  return { manifest, tarball: await gzip(concat(...chunks, TAR_TRAILER)) };
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
    dependencies: { ...lightningProjection.dependencies },
    optionalDependencies: {
      ...lightningProjection.optionalDependencies,
      ...lightningProjection.omittedOptionalDependencies,
    },
    peerDependencies: { ...lightningProjection.peerDependencies },
    bundleDependencies: [...lightningProjection.bundledDependencies],
  };
}

async function lightningRegistry(fields = expectedLightningFields()): Promise<LedgerRegistry> {
  return new LedgerRegistry([
    await entry(
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
    ),
  ]);
}

async function installFixture(
  vfs: MemoryVfs,
  registry: RegistryClient,
  dependencies: Readonly<Record<string, string>>,
) {
  return await install(
    'fixture',
    '1.0.0',
    { ...dependencies },
    {
      vfs,
      cwd: '/project',
      registry,
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

async function peerRegistry(): Promise<LedgerRegistry> {
  return new LedgerRegistry([
    await entry('contract-source', '1.0.0', {
      peerDependencies: { 'contract-peer': '^2.0.0' },
    }),
    await entry('contract-peer', '1.0.0'),
    await entry('contract-peer', '2.0.0', {
      dependencies: { 'contract-leaf': '1.0.0' },
    }),
    await entry('contract-leaf', '1.0.0'),
    await entry('contract-host', '1.0.0', {
      dependencies: { 'contract-source': '1.0.0' },
    }),
  ]);
}

const peerSuccessCases = [
  {
    label: 'direct missing peer',
    dependencies: { 'contract-source': '1.0.0' },
    paths: {
      'node_modules/contract-source': '1.0.0',
      'node_modules/contract-peer': '2.0.0',
      'node_modules/contract-leaf': '1.0.0',
    },
    peerPaths: ['node_modules/contract-peer', 'node_modules/contract-leaf'],
  },
  {
    label: 'nested missing peer',
    dependencies: { 'contract-host': '1.0.0' },
    paths: {
      'node_modules/contract-host': '1.0.0',
      'node_modules/contract-source': '1.0.0',
      'node_modules/contract-peer': '2.0.0',
      'node_modules/contract-leaf': '1.0.0',
    },
    peerPaths: ['node_modules/contract-peer', 'node_modules/contract-leaf'],
  },
  {
    label: 'nested conflicting root peer',
    dependencies: { 'contract-host': '1.0.0', 'contract-peer': '1.0.0' },
    paths: {
      'node_modules/contract-host': '1.0.0',
      'node_modules/contract-peer': '1.0.0',
      'node_modules/contract-host/node_modules/contract-source': '1.0.0',
      'node_modules/contract-host/node_modules/contract-peer': '2.0.0',
      'node_modules/contract-leaf': '1.0.0',
    },
    peerPaths: [
      'node_modules/contract-host/node_modules/contract-peer',
      'node_modules/contract-leaf',
    ],
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow recipe v2 execution authority', () => {
  it.each(projectionDrifts)(
    '[fault: observable-order/provenance-lie] rejects builtin $label drift before tarball or VFS work',
    async ({ mutate }) => {
      const fields = expectedLightningFields();
      mutate(fields);
      const registry = await lightningRegistry(fields);
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const writers = [
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      await expect(installFixture(vfs, registry, { lightningcss: '1.32.0' })).rejects.toMatchObject(
        {
          name: 'NotImplementedError',
          feature: lightningProjection.unsupportedFeature,
        },
      );

      expect(registry.packumentReads).toContain(lightningAcquisition.name);
      expect(registry.tarballReads).not.toContain(lightningSourceUrl);
      for (const writer of writers) expect(writer).not.toHaveBeenCalled();
      await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
      await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
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

  it('recreates the exact recipe tree and lock with zero registry reads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await lightningRegistry();
    const dependencies = { lightningcss: '1.32.0', esbuild: '0.28.0' };
    await installFixture(vfs, registry, dependencies);
    const treeBefore = await snapshotTree(vfs, '/project/node_modules');
    const lockBefore = await vfs.readFile('/project/package-lock.json');

    await vfs.rm('/project/node_modules', { recursive: true });
    registry.denyReads();
    await installFixture(vfs, registry, dependencies);

    expect(registry.packumentReads).toEqual([]);
    expect(registry.tarballReads).toEqual([]);
    expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(treeBefore);
    expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
  });
});

describe('npm 11 peer placement oracle', () => {
  it.each(peerSuccessCases)(
    '$label traverses, places, and replays byte-identically',
    async (testCase) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await peerRegistry();
      const first = await installFixture(vfs, registry, testCase.dependencies);

      for (const [path, version] of Object.entries(testCase.paths)) {
        expect(first.lockfile.packages[path], path).toMatchObject({ version });
        await expect(vfs.exists(`/project/${path}/package.json`), path).resolves.toBe(true);
      }
      for (const path of testCase.peerPaths) {
        expect(first.lockfile.packages[path], path).toMatchObject({ peer: true });
      }

      const treeBefore = await snapshotTree(vfs, '/project/node_modules');
      const lockBefore = await vfs.readFile('/project/package-lock.json');
      await vfs.rm('/project/node_modules', { recursive: true });
      registry.denyReads();
      await installFixture(vfs, registry, testCase.dependencies);

      expect(registry.packumentReads).toEqual([]);
      expect(registry.tarballReads).toEqual([]);
      expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(treeBefore);
      expect(await vfs.readFile('/project/package-lock.json')).toEqual(lockBefore);
    },
  );

  it('rejects a direct conflicting root peer with ERESOLVE before writes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const registry = await peerRegistry();

    await expect(
      installFixture(vfs, registry, {
        'contract-source': '1.0.0',
        'contract-peer': '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'ERESOLVE' });

    expect(registry.tarballReads).toEqual([]);
    await expect(vfs.exists('/project/node_modules')).resolves.toBe(false);
    await expect(vfs.exists('/project/package-lock.json')).resolves.toBe(false);
  });
});
