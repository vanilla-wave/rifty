import * as shadowRegistry from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { readyShadowAssetInstaller } from './_test-fixtures/shadow-assets.ts';
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
import { lockfileShadowSubstitutionRecipes } from './shadow-asset-lockfile-recipes.ts';
import type { TarballCache } from './tarball-cache.ts';

interface FixtureEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

interface SyntheticRecipeView {
  readonly recipeSha256: string;
  readonly files: Readonly<Record<string, string>>;
}

function builtinRecipe(): SyntheticRecipeView {
  const recipes = (
    shadowRegistry as typeof shadowRegistry & {
      readonly builtinSyntheticPackageRecipes?: readonly SyntheticRecipeView[];
    }
  ).builtinSyntheticPackageRecipes;
  if (!recipes?.[0]) throw new Error('Contract+RED: builtin synthetic recipe is absent');
  return recipes[0];
}

class FixtureRegistry extends RegistryClient {
  readonly calls = { packument: [] as string[], tarball: [] as string[] };

  constructor(private readonly db: ReadonlyMap<string, ReadonlyMap<string, FixtureEntry>>) {
    super({ baseUrl: '/fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.calls.packument.push(name);
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fixture registry has no packument for ${name}`);
    const manifests: Record<string, VersionManifest> = {};
    for (const [version, entry] of versions) manifests[version] = entry.manifest;
    return {
      name,
      'dist-tags': { latest: [...versions.keys()].at(-1) ?? '0.0.0' },
      versions: manifests,
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.calls.tarball.push(url);
    const match = /^fixture:\/\/([^|]+)\|(.+)$/.exec(url);
    const name = decodeURIComponent(match?.[1] ?? '');
    const version = match?.[2] ?? '';
    const entry = this.db.get(name)?.get(version);
    if (!entry) throw new Error(`fixture registry has no tarball for ${url}`);
    return entry.tarball;
  }

  reset(): void {
    this.calls.packument.length = 0;
    this.calls.tarball.length = 0;
  }
}

class TrackingTarballCache implements TarballCache {
  readonly calls = {
    get: [] as Array<{ name: string; version: string; integrity: string }>,
    put: [] as Array<{ name: string; version: string; integrity: string }>,
  };
  private readonly bytes = new Map<string, Uint8Array>();

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    this.calls.get.push({ name, version, integrity });
    return this.bytes.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    this.calls.put.push({ name, version, integrity });
    this.bytes.set(`${name}\0${version}\0${integrity}`, bytes.slice());
    return `/tracking/${encodeURIComponent(name)}/${version}`;
  }

  resetCalls(): void {
    this.calls.get.length = 0;
    this.calls.put.length = 0;
  }
}

async function entry(
  name: string,
  version: string,
  options: {
    readonly dependencies?: Record<string, string>;
    readonly scripts?: Record<string, string>;
    readonly files?: Record<string, string>;
  } = {},
): Promise<FixtureEntry> {
  const dependencies = options.dependencies ?? {};
  const packageJson = JSON.stringify({
    name,
    version,
    dependencies,
    ...(options.scripts ? { scripts: options.scripts } : {}),
  });
  const chunks: Uint8Array[] = [];
  for (const [path, contents] of Object.entries({
    'package.json': packageJson,
    ...options.files,
  })) {
    const bytes = new TextEncoder().encode(contents);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      name,
      version,
      dependencies,
      ...(options.scripts ? { scripts: options.scripts } : {}),
      dist: { tarball: `fixture://${encodeURIComponent(name)}|${version}` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
  };
}

function fixtureDb(
  ...values: readonly [name: string, value: FixtureEntry][]
): Map<string, Map<string, FixtureEntry>> {
  const db = new Map<string, Map<string, FixtureEntry>>();
  for (const [name, value] of values) {
    const versions = db.get(name) ?? new Map<string, FixtureEntry>();
    versions.set(value.manifest.version, value);
    db.set(name, versions);
  }
  return db;
}

async function esbuildFixtureDb(options: { readonly postinstall?: boolean } = {}) {
  return fixtureDb(
    [
      'esbuild',
      await entry('esbuild', '0.28.0', {
        ...(options.postinstall ? { scripts: { postinstall: 'node install.js' } } : {}),
        files: { 'ordinary.txt': 'public registry tarball bytes' },
      }),
    ],
    [
      '@esbuild/wasi-preview1',
      await entry('@esbuild/wasi-preview1', '0.28.0', {
        files: { 'alias.txt': 'historical alias tarball bytes' },
      }),
    ],
  );
}

function materializationMarker() {
  return {
    protocol: 'rifty.lockfile-package-materialization/v1',
    kind: 'synthesized-shadow-delegate',
    substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
    recipeSha256: builtinRecipe().recipeSha256,
  };
}

function markerOf(entry: unknown): unknown {
  return (entry as { rifty?: { materialization?: unknown } } | undefined)?.rifty?.materialization;
}

function esbuildProvenance(result: Awaited<ReturnType<typeof install>>) {
  return result.provenance.packages.filter((pkg) => pkg.name === 'esbuild');
}

const SYNTHESIS_LINE =
  'npm: esbuild@^0.28.0 → esbuild@0.28.0 (synthesized delegate from shadow registry, ADR-0298)';

describe('ADR-0298 synthesized delegate — fresh + replay contract', () => {
  it('selects public metadata, writes only recipe files, and records exact marker/trace/provenance', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/app', { recursive: true });
    const registry = new FixtureRegistry(await esbuildFixtureDb());
    const tarballCache = new TrackingTarballCache();
    const lines: string[] = [];
    const packages: Array<{ name: string; version: string }> = [];

    const result = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/app',
        registry,
        tarballCache,
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: (line) => lines.push(line),
        onPackage: ({ name, version }) => packages.push({ name, version }),
      },
    );

    expect(registry.calls).toEqual({ packument: ['esbuild'], tarball: [] });
    expect(tarballCache.calls).toEqual({ get: [], put: [] });
    expect(packages).toEqual([]);
    expect(await vfs.exists('/app/node_modules/@esbuild/wasi-preview1')).toBe(false);
    expect(await vfs.readFileText('/app/node_modules/esbuild/package.json')).toBe(
      builtinRecipe().files['package.json'],
    );
    expect(await vfs.readFileText('/app/node_modules/esbuild/lib/main.cjs')).toBe(
      builtinRecipe().files['lib/main.cjs'],
    );
    expect(Object.keys(result.packages[0]?.files ?? {}).sort()).toEqual([
      'lib/main.cjs',
      'package.json',
    ]);

    const lockEntry = result.lockfile.packages['node_modules/esbuild'];
    expect(lockEntry).toEqual({
      version: '0.28.0',
      dependencies: {},
      rifty: { materialization: materializationMarker() },
    });
    expect(lockEntry).not.toHaveProperty('resolved');
    expect(lockEntry).not.toHaveProperty('integrity');
    expect(result.lockfile.rifty?.shadowSubstitutions.applied).toEqual([
      {
        publicName: 'esbuild',
        requestedRange: '^0.28.0',
        resolvedPublicVersion: '0.28.0',
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
        substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      },
    ]);
    expect(lines).toEqual([SYNTHESIS_LINE]);
    expect(esbuildProvenance(result)).toEqual([
      { name: 'esbuild', version: '0.28.0', transport: 'synthesized' },
    ]);
  });

  it('replays byte-identically with zero packument/tarball/cache reads and the same line', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/app', { recursive: true });
    const registry = new FixtureRegistry(await esbuildFixtureDb());
    const tarballCache = new TrackingTarballCache();
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/app',
        registry,
        tarballCache,
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: () => {},
      },
    );
    const beforePackage = await vfs.readFile('/app/node_modules/esbuild/package.json');
    const beforeMain = await vfs.readFile('/app/node_modules/esbuild/lib/main.cjs');
    registry.reset();
    tarballCache.resetCalls();
    const lines: string[] = [];
    const onPackage: unknown[] = [];

    const replay = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/app',
        registry,
        tarballCache,
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: (line) => lines.push(line),
        onPackage: (event) => onPackage.push(event),
      },
    );

    expect(replay.provenance.resolution).toBe('lockfile');
    expect(registry.calls).toEqual({ packument: [], tarball: [] });
    expect(tarballCache.calls).toEqual({ get: [], put: [] });
    expect(onPackage).toEqual([]);
    expect(await vfs.readFile('/app/node_modules/esbuild/package.json')).toEqual(beforePackage);
    expect(await vfs.readFile('/app/node_modules/esbuild/lib/main.cjs')).toEqual(beforeMain);
    expect(lines).toEqual([SYNTHESIS_LINE]);
    expect(esbuildProvenance(replay)).toEqual([
      { name: 'esbuild', version: '0.28.0', transport: 'synthesized' },
    ]);
  });

  it('public registry failure and unsupported selected version win before synthesis', async () => {
    const failingRegistry = new (class extends RegistryClient {
      override async getPackument(): Promise<Packument> {
        throw new Error('PUBLIC-PACKUMENT-FAILURE');
      }
    })({ baseUrl: '/fixture', fetch: async () => new Response('', { status: 599 }) });
    const failedVfs = new MemoryVfs();
    await failedVfs.mkdir('/app', { recursive: true });
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs: failedVfs,
          cwd: '/app',
          registry: failingRegistry,
        },
      ),
    ).rejects.toThrow('PUBLIC-PACKUMENT-FAILURE');
    expect(await failedVfs.exists('/app/node_modules/esbuild')).toBe(false);

    const unsupportedDb = fixtureDb([
      'esbuild',
      await entry('esbuild', '0.29.0', { files: { 'ordinary.txt': 'future' } }),
    ]);
    const unsupportedVfs = new MemoryVfs();
    await unsupportedVfs.mkdir('/app', { recursive: true });
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '*' },
        {
          vfs: unsupportedVfs,
          cwd: '/app',
          registry: new FixtureRegistry(unsupportedDb),
        },
      ),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'shadow-registry.esbuild@0.29.0',
    });
    expect(await unsupportedVfs.exists('/app/node_modules/esbuild')).toBe(false);
  });
});

describe('ADR-0298 synthesized delegate — override precedence and materialization placement', () => {
  it.each([
    ['same-name', { esbuild: 'esbuild@0.28.0' }, 'esbuild'],
    ['parent-scoped', { 'root>esbuild': 'esbuild@0.28.0' }, 'esbuild'],
    ['redirect', { esbuild: 'ordinary-esbuild@0.28.0' }, 'ordinary-esbuild'],
  ] as const)(
    '%s user override bypasses builtin synthesis',
    async (_label, overrides, installedName) => {
      const base = await esbuildFixtureDb();
      if (installedName === 'ordinary-esbuild') {
        base.set(
          'ordinary-esbuild',
          new Map([
            [
              '0.28.0',
              await entry('ordinary-esbuild', '0.28.0', {
                files: { 'ordinary.txt': 'redirected public tarball bytes' },
              }),
            ],
          ]),
        );
      }
      const registry = new FixtureRegistry(base);
      const vfs = new MemoryVfs();
      await vfs.mkdir('/app', { recursive: true });
      const lines: string[] = [];
      const result = await install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/app',
          registry,
          overrides,
          onSubstitution: (line) => lines.push(line),
        },
      );

      expect(registry.calls.packument).toEqual([installedName]);
      expect(registry.calls.tarball).toHaveLength(1);
      expect(await vfs.readFileText(`/app/node_modules/${installedName}/ordinary.txt`)).toContain(
        'tarball bytes',
      );
      const lockEntry = result.lockfile.packages[`node_modules/${installedName}`];
      expect(lockEntry?.resolved).toContain(
        `fixture://${encodeURIComponent(installedName)}|0.28.0`,
      );
      expect(lockEntry?.integrity).toMatch(/^sha512-/);
      expect(markerOf(lockEntry)).toBeUndefined();
      expect(result.lockfile.rifty?.shadowSubstitutions.applied).toEqual([]);
      expect(lines).toEqual([]);
      expect(result.provenance.packages).toContainEqual({
        name: installedName,
        version: '0.28.0',
        transport: 'registry',
      });
    },
  );

  it('same-name user override retains the ordinary postinstall loud gap', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/app', { recursive: true });
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/app',
          registry: new FixtureRegistry(await esbuildFixtureDb({ postinstall: true })),
          overrides: { esbuild: 'esbuild@0.28.0' },
        },
      ),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'npm-client.lifecycle.postinstall',
    });
  });

  it.each([
    ['synthetic-hoisted', ['synth-parent', 'registry-parent'] as const],
    ['registry-hoisted', ['registry-parent', 'synth-parent'] as const],
  ] as const)(
    '%s keeps ordinary and synthesized esbuild@0.28.0 as distinct placements and provenance rows',
    async (_label, order) => {
      const base = await esbuildFixtureDb();
      base.set(
        'synth-parent',
        new Map([
          ['1.0.0', await entry('synth-parent', '1.0.0', { dependencies: { esbuild: '0.28.0' } })],
        ]),
      );
      base.set(
        'registry-parent',
        new Map([
          [
            '1.0.0',
            await entry('registry-parent', '1.0.0', {
              dependencies: { esbuild: '0.28.0' },
            }),
          ],
        ]),
      );
      const dependencies = Object.fromEntries(order.map((name) => [name, '1.0.0']));
      const vfs = new MemoryVfs();
      await vfs.mkdir('/app', { recursive: true });
      const result = await install('root', '1.0.0', dependencies, {
        vfs,
        cwd: '/app',
        registry: new FixtureRegistry(base),
        overrides: { 'registry-parent>esbuild': 'esbuild@0.28.0' },
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: () => {},
      });

      const syntheticPath =
        order[0] === 'synth-parent'
          ? 'node_modules/esbuild'
          : 'node_modules/synth-parent/node_modules/esbuild';
      const registryPath =
        order[0] === 'registry-parent'
          ? 'node_modules/esbuild'
          : 'node_modules/registry-parent/node_modules/esbuild';
      expect(markerOf(result.lockfile.packages[syntheticPath])).toEqual(materializationMarker());
      expect(markerOf(result.lockfile.packages[registryPath])).toBeUndefined();
      expect(result.lockfile.packages[registryPath]?.resolved).toContain(
        'fixture://esbuild|0.28.0',
      );
      expect(await vfs.readFileText(`/app/${syntheticPath}/lib/main.cjs`)).toBe(
        builtinRecipe().files['lib/main.cjs'],
      );
      expect(await vfs.readFileText(`/app/${registryPath}/ordinary.txt`)).toBe(
        'public registry tarball bytes',
      );
      expect(esbuildProvenance(result)).toEqual(
        expect.arrayContaining([
          { name: 'esbuild', version: '0.28.0', transport: 'synthesized' },
          { name: 'esbuild', version: '0.28.0', transport: 'registry' },
        ]),
      );
      expect(esbuildProvenance(result)).toHaveLength(2);
      expect(result.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
    },
  );
});

describe('ADR-0298 lockfile recipe ledger', () => {
  it('retains the alias v1 tombstone and adds only the active v2 synthesis rule', () => {
    expect(lockfileShadowSubstitutionRecipes).toEqual([
      {
        substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
        publicName: 'esbuild',
        materialization: { kind: 'package', name: '@esbuild/wasi-preview1' },
      },
      {
        substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
        publicName: 'esbuild',
        materialization: { kind: 'package', name: 'esbuild' },
      },
    ]);
  });
});

describe('ADR-0298 package-materialization marker faults', () => {
  async function seeded() {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/app', { recursive: true });
    const registry = new FixtureRegistry(await esbuildFixtureDb());
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/app',
        registry,
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: () => {},
      },
    );
    registry.reset();
    return { vfs, registry };
  }

  async function mutateLockfile(
    vfs: MemoryVfs,
    mutate: (lockfile: Record<string, unknown>) => void,
  ): Promise<void> {
    const lockfile = JSON.parse(await vfs.readFileText('/app/package-lock.json')) as Record<
      string,
      unknown
    >;
    mutate(lockfile);
    await vfs.writeFile('/app/package-lock.json', JSON.stringify(lockfile));
    await vfs.writeFile('/app/node_modules/esbuild/lib/main.cjs', 'PRE-VALIDATION-SENTINEL');
  }

  function marker(lockfile: Record<string, unknown>): Record<string, unknown> {
    const packages = lockfile.packages as Record<string, Record<string, unknown>>;
    const entry = packages['node_modules/esbuild'];
    const rifty = entry?.rifty as Record<string, unknown>;
    return rifty.materialization as Record<string, unknown>;
  }

  async function expectRejectedBeforeWrite(
    vfs: MemoryVfs,
    registry: FixtureRegistry,
    expected: { readonly name?: string; readonly code?: string; readonly feature?: string },
  ): Promise<void> {
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/app',
          registry,
          shadowAssets: { installer: readyShadowAssetInstaller },
          onSubstitution: () => {},
        },
      ),
    ).rejects.toMatchObject(expected);
    expect(await vfs.readFileText('/app/node_modules/esbuild/lib/main.cjs')).toBe(
      'PRE-VALIDATION-SENTINEL',
    );
    expect(registry.calls).toEqual({ packument: [], tarball: [] });
  }

  it.each([
    ['extra field', (value: Record<string, unknown>) => Object.assign(value, { extra: true })],
    [
      'wrong digest',
      (value: Record<string, unknown>) => Object.assign(value, { recipeSha256: '0'.repeat(64) }),
    ],
  ] as const)('%s is EBROKENLOCK before a file write', async (_label, mutate) => {
    const { vfs, registry } = await seeded();
    await mutateLockfile(vfs, (lockfile) => mutate(marker(lockfile)));
    await expectRejectedBeforeWrite(vfs, registry, { code: 'EBROKENLOCK' });
  });

  it.each([
    ['protocol', { protocol: 'rifty.lockfile-package-materialization/v999' }],
    ['kind', { kind: 'external-synthetic-recipe' }],
    [
      'external recipe id',
      { substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2-drift' },
    ],
  ] as const)('unknown %s is the named loud gap before a file write', async (_label, change) => {
    const { vfs, registry } = await seeded();
    await mutateLockfile(vfs, (lockfile) => Object.assign(marker(lockfile), change));
    await expectRejectedBeforeWrite(vfs, registry, {
      name: 'NotImplementedError',
      feature: 'npm-client.lockfile.packageMaterialization',
    });
  });

  it('trace/entry disagreement is EBROKENLOCK rather than inferred from name/version', async () => {
    const { vfs, registry } = await seeded();
    await mutateLockfile(vfs, (lockfile) => {
      const rifty = lockfile.rifty as { shadowSubstitutions: { applied: unknown[] } };
      rifty.shadowSubstitutions.applied = [];
    });
    await expectRejectedBeforeWrite(vfs, registry, { code: 'EBROKENLOCK' });
  });

  it('the historical v1 alias trace is a tombstone that forces public re-resolution and v2 rewrite', async () => {
    const { vfs, registry } = await seeded();
    const lockfile = JSON.parse(await vfs.readFileText('/app/package-lock.json')) as {
      packages: Record<string, Record<string, unknown>>;
      rifty: { shadowSubstitutions: { applied: Array<Record<string, unknown>> } };
    };
    const rootEntry = lockfile.packages[''];
    if (!rootEntry) throw new Error('setup: lockfile root entry absent');
    rootEntry.dependencies = { '@esbuild/wasi-preview1': '0.28.0' };
    Reflect.deleteProperty(lockfile.packages, 'node_modules/esbuild');
    lockfile.packages['node_modules/@esbuild/wasi-preview1'] = {
      version: '0.28.0',
      dependencies: {},
      resolved: 'fixture://%40esbuild%2Fwasi-preview1|0.28.0',
      integrity: `sha512-${'A'.repeat(86)}==`,
    };
    lockfile.rifty.shadowSubstitutions.applied = [
      {
        publicName: 'esbuild',
        requestedRange: '^0.28.0',
        resolvedPublicVersion: '0.28.0',
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
        substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      },
    ];
    await vfs.writeFile('/app/package-lock.json', JSON.stringify(lockfile));

    const result = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/app',
        registry,
        shadowAssets: { installer: readyShadowAssetInstaller },
        onSubstitution: () => {},
      },
    );

    expect(registry.calls).toEqual({ packument: ['esbuild'], tarball: [] });
    expect(result.lockfile.packages).not.toHaveProperty('node_modules/@esbuild/wasi-preview1');
    expect(markerOf(result.lockfile.packages['node_modules/esbuild'])).toEqual(
      materializationMarker(),
    );
    expect(result.lockfile.rifty?.shadowSubstitutions.applied[0]?.substitutionId).toBe(
      'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
    );
  });
});
