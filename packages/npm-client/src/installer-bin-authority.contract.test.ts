import { NotImplementedError } from '@riftydev/io';
import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
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
import { type ResolvedPackage, link } from './linker.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

type FixtureManifest = VersionManifest & {
  readonly bundleDependencies?: readonly string[];
};

interface RegistryEntry {
  readonly manifest: FixtureManifest;
  readonly tarball: Uint8Array;
}

interface EntryOptions {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly bundleDependencies?: readonly string[];
  readonly bin?: string | Record<string, string>;
  readonly files?: Record<string, string>;
}

class FixtureRegistry extends RegistryClient {
  constructor(private readonly entries: ReadonlyMap<string, ReadonlyMap<string, RegistryEntry>>) {
    super({ baseUrl: '/fixture', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    const versions = this.entries.get(name);
    if (!versions) throw new Error(`fixture registry has no ${name}`);
    const records = Object.fromEntries(
      [...versions].map(([version, entry]) => [version, entry.manifest]),
    );
    const latest = [...versions.keys()].sort().at(-1);
    if (!latest) throw new Error(`fixture registry has no version of ${name}`);
    return { name, 'dist-tags': { latest }, versions: records };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const match = /^fixture:\/\/([^|]+)\|(.+)$/.exec(url);
    const entry = match
      ? this.entries.get(decodeURIComponent(match[1] ?? ''))?.get(match[2] ?? '')
      : undefined;
    if (!entry) throw new Error(`fixture registry has no tarball ${url}`);
    return entry.tarball.slice();
  }
}

async function registryEntry(
  name: string,
  version: string,
  options: EntryOptions = {},
): Promise<RegistryEntry> {
  const manifestFields = {
    name,
    version,
    dependencies: options.dependencies ?? {},
    ...(options.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: options.optionalDependencies }),
    ...(options.peerDependencies === undefined
      ? {}
      : { peerDependencies: options.peerDependencies }),
    ...(options.bundleDependencies === undefined
      ? {}
      : { bundleDependencies: options.bundleDependencies }),
    ...(options.bin === undefined ? {} : { bin: options.bin }),
  };
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries({
    'package.json': JSON.stringify(manifestFields),
    ...(options.files ?? {}),
  })) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return {
    manifest: {
      ...manifestFields,
      dist: { tarball: `fixture://${encodeURIComponent(name)}|${version}` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
  };
}

function registry(...entries: readonly RegistryEntry[]): FixtureRegistry {
  const byName = new Map<string, Map<string, RegistryEntry>>();
  for (const entry of entries) {
    const versions = byName.get(entry.manifest.name) ?? new Map<string, RegistryEntry>();
    versions.set(entry.manifest.version, entry);
    byName.set(entry.manifest.name, versions);
  }
  return new FixtureRegistry(byName);
}

function launcher(packageName: string, target: string): string {
  return `#!/usr/bin/env node\nimport('../${packageName}/${target}');\n`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const lightningRecipe = (() => {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === 'lightningcss',
  );
  if (!recipe || recipe.acquisition.kind !== 'registry') {
    throw new Error('builtin LightningCSS registry recipe is missing');
  }
  return recipe;
})();

type RegistryAliasScope = 'root' | 'nested';

interface RegistryAliasFixture {
  readonly aliasRoot: string;
  readonly dependencies: Record<string, string>;
  readonly registry: FixtureRegistry;
}

async function registryAliasFixture(scope: RegistryAliasScope): Promise<RegistryAliasFixture> {
  const lightningTwin = await registryEntry('lightningcss-wasm', '1.32.0', {
    dependencies: { 'napi-wasm': '^1.0.1' },
    optionalDependencies: {},
    peerDependencies: {},
    bundleDependencies: ['napi-wasm'],
    files: {
      'node_modules/napi-wasm/package.json': JSON.stringify({
        name: 'napi-wasm',
        version: '1.1.3',
      }),
      'node_modules/napi-wasm/index.js': 'module.exports = "bundled napi-wasm";\n',
    },
  });
  // Current production traverses the bundled member externally. Keeping this
  // fixture reachable lets the fault hit registry-alias writes; recipe v2 must
  // instead consume the identical embedded member without this registry read.
  const standaloneNapi = await registryEntry('napi-wasm', '1.1.3');
  if (scope === 'root') {
    return {
      aliasRoot: '/project/node_modules/lightningcss',
      dependencies: { lightningcss: '^1.32.0' },
      registry: registry(lightningTwin, standaloneNapi),
    };
  }

  const occupiedAcquisitionName = await registryEntry('lightningcss-wasm', '1.32.1');
  const nestedHost = await registryEntry('nested-host', '1.0.0', {
    dependencies: { lightningcss: '^1.32.0' },
  });
  return {
    aliasRoot: '/project/node_modules/nested-host/node_modules/lightningcss',
    dependencies: {
      'lightningcss-wasm': '1.32.1',
      'nested-host': '1.0.0',
    },
    registry: registry(lightningTwin, standaloneNapi, occupiedAcquisitionName, nestedHost),
  };
}

async function expectExactRegistryAlias(vfs: MemoryVfs, aliasRoot: string): Promise<void> {
  for (const file of lightningRecipe.materialization.files) {
    expect(await vfs.readFileText(`${aliasRoot}/${file.path}`)).toBe(file.content);
  }
}

function expectedLightningReports(scope: RegistryAliasScope): string[] {
  return [
    'npm: lightningcss@^1.32.0 → lightningcss-wasm@1.32.0 (substituted from shadow registry, ADR-0051)',
    `npm: lightningcss@^1.32.0 materialized from shadow registry (${lightningRecipe.id})`,
    ...(scope === 'nested'
      ? ['npm: lightningcss@1.32.1 internals patched from shadow registry']
      : []),
  ];
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const encoder = new TextEncoder();

function linkedPackage(
  name: string,
  installPath: string,
  command: string,
  target: string,
): ResolvedPackage {
  return {
    name,
    version: '1.0.0',
    installPath,
    dependencies: {},
    bin: { [command]: target },
    files: {
      'package.json': encoder.encode(JSON.stringify({ name, version: '1.0.0' })),
      [target]: encoder.encode(`throw new Error(${JSON.stringify(name)});\n`),
    },
  };
}

async function expectBinCollision(run: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (error) {
    caught = error;
  }
  expect.soft(caught).toBeInstanceOf(NotImplementedError);
  expect
    .soft((caught as NotImplementedError | undefined)?.feature)
    .toBe('npm-client.bin-collision-reify');
}

describe('install package-bin authority', () => {
  it('[fault: observable-order] publishes collision-free esbuild only after lock commit and replays its exact launcher', async () => {
    const vfs = await project();
    const freshEvents: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      await writeFile(path, data);
      if (path === '/project/package-lock.json') freshEvents.push('lock');
    });

    const fresh = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(),
        onSubstitution: (line) => freshEvents.push(`report:${line}`),
      },
    );

    expect(freshEvents).toEqual([
      'lock',
      'report:npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
    ]);
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('esbuild', 'bin/esbuild'),
    );
    expect(fresh.lockfile.packages['node_modules/esbuild']?.bin).toEqual({
      esbuild: 'bin/esbuild',
    });

    vi.restoreAllMocks();
    const replayReports: string[] = [];
    const replay = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(),
        onSubstitution: (line) => replayReports.push(line),
      },
    );
    expect(replayReports).toEqual([
      'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
    ]);
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('esbuild', 'bin/esbuild'),
    );
    expect(replay.lockfile).toEqual(fresh.lockfile);
  });

  it.each([
    ['shadow-first', { esbuild: '^0.28.0', 'provider-z': '1.0.0' }],
    ['ordinary-first', { 'provider-z': '1.0.0', esbuild: '^0.28.0' }],
  ])(
    '[fault: frozen-assumption] rejects a current same-scope collision before tree/report/lock (%s)',
    async (_name, dependencies) => {
      const rival = await registryEntry('provider-z', '1.0.0', {
        bin: { esbuild: 'bin/provider.js' },
        files: { 'bin/provider.js': 'throw new Error("provider-z");\n' },
      });
      const vfs = await project();
      const reports: string[] = [];

      await expectBinCollision(
        install('fixture', '1.0.0', dependencies, {
          vfs,
          cwd: '/project',
          registry: registry(rival),
          onSubstitution: (line) => reports.push(line),
        }),
      );

      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);
    },
  );

  it.each([
    [
      'root',
      [
        linkedPackage('a-a', 'node_modules/a-a', 'shared', 'bin/a.js'),
        linkedPackage('a_a', 'node_modules/a_a', 'shared', 'bin/a.js'),
      ],
    ],
    [
      'nested',
      [
        linkedPackage('a-a', 'node_modules/host/node_modules/a-a', 'shared', 'bin/a.js'),
        linkedPackage('a_a', 'node_modules/host/node_modules/a_a', 'shared', 'bin/a.js'),
      ],
    ],
  ] as const)(
    '[fault: frozen-assumption] keeps the public linker collision ceiling scoped at %s',
    async (_scope, packages) => {
      const vfs = await project();
      await expectBinCollision(link(vfs, '/project', packages));
      expect(await vfs.exists('/project/node_modules')).toBe(false);
    },
  );

  it('[fault: observable-order] allows identical command text in independent root and nested scopes', async () => {
    const vfs = await project();
    await link(vfs, '/project', [
      linkedPackage('root-cli', 'node_modules/root-cli', 'shared', 'bin/root.js'),
      linkedPackage(
        'nested-cli',
        'node_modules/host/node_modules/nested-cli',
        'shared',
        'bin/nested.js',
      ),
    ]);

    expect(await vfs.readFileText('/project/node_modules/.bin/shared')).toBe(
      launcher('root-cli', 'bin/root.js'),
    );
    expect(await vfs.readFileText('/project/node_modules/host/node_modules/.bin/shared')).toBe(
      launcher('nested-cli', 'bin/nested.js'),
    );
  });

  it('[fault: observable-order] rejects a prior owner transition before shadow report or tree mutation', async () => {
    const rival = await registryEntry('provider-z', '1.0.0', {
      bin: { esbuild: 'bin/provider.js' },
      files: { 'bin/provider.js': 'throw new Error("provider-z");\n' },
    });
    const vfs = await project();
    const fixtureRegistry = registry(rival);
    await install(
      'fixture',
      '1.0.0',
      { 'provider-z': '1.0.0' },
      {
        vfs,
        cwd: '/project',
        registry: fixtureRegistry,
      },
    );
    const oldLock = await vfs.readFileText('/project/package-lock.json');
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('provider-z', 'bin/provider.js'),
    );

    const reports: string[] = [];
    await expectBinCollision(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: fixtureRegistry,
          onSubstitution: (line) => reports.push(line),
        },
      ),
    );

    expect.soft(reports).toEqual([]);
    expect.soft(await vfs.readFileText('/project/package-lock.json')).toBe(oldLock);
    expect.soft(await vfs.exists('/project/node_modules/esbuild')).toBe(false);
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('provider-z', 'bin/provider.js'),
    );
  });

  it('[fault: frozen-assumption] rejects a recorded prior collision even when the desired tree has one claimant', async () => {
    const providerA = await registryEntry('provider-a', '1.0.0', {
      bin: { shared: 'bin/a.js' },
      files: { 'bin/a.js': 'throw new Error("provider-a");\n' },
    });
    const providerZ = await registryEntry('provider-z', '1.0.0', {
      bin: { providerZ: 'bin/z.js' },
      files: { 'bin/z.js': 'throw new Error("provider-z");\n' },
    });
    const vfs = await project();
    const fixtureRegistry = registry(providerA, providerZ);
    await install(
      'fixture',
      '1.0.0',
      { 'provider-a': '1.0.0', 'provider-z': '1.0.0' },
      { vfs, cwd: '/project', registry: fixtureRegistry },
    );

    const lockPath = '/project/package-lock.json';
    const lockfile = JSON.parse(await vfs.readFileText(lockPath)) as {
      packages: Record<string, { bin?: Record<string, string> }>;
    };
    const priorProviderZ = lockfile.packages['node_modules/provider-z'];
    if (!priorProviderZ) throw new Error('test setup: provider-z lock entry missing');
    priorProviderZ.bin = { shared: 'bin/z.js' };
    await vfs.writeFile(lockPath, JSON.stringify(lockfile));
    const priorLock = await vfs.readFileText(lockPath);
    const reports: string[] = [];
    const treeWrites: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.startsWith('/project/node_modules/') || path === lockPath) treeWrites.push(path);
      await writeFile(path, data);
    });

    await expectBinCollision(
      install(
        'fixture',
        '1.0.0',
        { 'provider-a': '1.0.0' },
        {
          vfs,
          cwd: '/project',
          registry: fixtureRegistry,
          onSubstitution: (line) => reports.push(line),
        },
      ),
    );

    expect.soft(reports).toEqual([]);
    expect.soft(treeWrites).toEqual([]);
    expect.soft(await vfs.readFileText(lockPath)).toBe(priorLock);
    expect(await vfs.readFileText('/project/node_modules/.bin/shared')).toBe(
      launcher('provider-a', 'bin/a.js'),
    );
  });

  it('[fault: provenance-lie] excludes an acquired LightningCSS twin bin from disk and lock', async () => {
    const lightningTwin = await registryEntry('lightningcss-wasm', '1.32.0', {
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
      bin: { lightningcss: 'bin/twin.js' },
      files: {
        'bin/twin.js': 'throw new Error("acquired twin");\n',
        'node_modules/napi-wasm/package.json': JSON.stringify({
          name: 'napi-wasm',
          version: '1.1.3',
        }),
      },
    });
    const napiWasm = await registryEntry('napi-wasm', '1.1.3');
    const vfs = await project();

    const result = await install(
      'fixture',
      '1.0.0',
      { lightningcss: '^1.32.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(lightningTwin, napiWasm),
        onSubstitution: () => {},
      },
    );

    expect.soft(await vfs.exists('/project/node_modules/.bin/lightningcss')).toBe(false);
    expect
      .soft(result.packages.find(({ name }) => name === 'lightningcss-wasm')?.bin)
      .toBeUndefined();
    expect.soft(result.lockfile.packages['node_modules/lightningcss-wasm']?.bin).toBeUndefined();
  });

  it('[fault: sibling-drift] excludes an acquired twin before collision preflight', async () => {
    const lightningTwin = await registryEntry('lightningcss-wasm', '1.32.0', {
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
      bin: { shared: 'bin/twin.js' },
      files: {
        'bin/twin.js': 'throw new Error("acquired twin");\n',
        'node_modules/napi-wasm/package.json': JSON.stringify({
          name: 'napi-wasm',
          version: '1.1.3',
        }),
      },
    });
    const napiWasm = await registryEntry('napi-wasm', '1.1.3');
    const provider = await registryEntry('provider-z', '1.0.0', {
      bin: { shared: 'bin/provider.js' },
      files: { 'bin/provider.js': 'throw new Error("provider-z");\n' },
    });
    const vfs = await project();

    const result = await install(
      'fixture',
      '1.0.0',
      { lightningcss: '^1.32.0', 'provider-z': '1.0.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(lightningTwin, napiWasm, provider),
        onSubstitution: () => {},
      },
    );

    expect(await vfs.readFileText('/project/node_modules/.bin/shared')).toBe(
      launcher('provider-z', 'bin/provider.js'),
    );
    expect
      .soft(result.packages.find(({ name }) => name === 'lightningcss-wasm')?.bin)
      .toBeUndefined();
    expect.soft(result.lockfile.packages['node_modules/lightningcss-wasm']?.bin).toBeUndefined();
    expect(result.lockfile.packages['node_modules/provider-z']?.bin).toEqual({
      shared: 'bin/provider.js',
    });
  });

  it.each(['root', 'nested'] as const)(
    '[fault: torn-state] stops registry-alias writes after a parked %s abort and reconciles exact bytes on retry',
    async (scope) => {
      const fixture = await registryAliasFixture(scope);
      const vfs = await project();
      const firstAliasPath = `${fixture.aliasRoot}/${lightningRecipe.materialization.files[0]?.path}`;
      const laterAliasPaths = lightningRecipe.materialization.files
        .slice(1)
        .map((file) => `${fixture.aliasRoot}/${file.path}`);
      const aliasPaths = new Set([firstAliasPath, ...laterAliasPaths]);
      const aliasWrites: string[] = [];
      const writeStarted = deferred<void>();
      const releaseWrite = deferred<void>();
      const writeFile = vfs.writeFile.bind(vfs);
      const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (aliasPaths.has(path)) aliasWrites.push(path);
        if (path === firstAliasPath) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await writeFile(path, data);
      });
      const controller = new AbortController();
      const reason = new Error(`cancel ${scope} registry-alias materialization`);
      const reports: string[] = [];
      const installing = install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        signal: controller.signal,
        onSubstitution: (line) => reports.push(line),
      });

      await writeStarted.promise;
      controller.abort(reason);
      releaseWrite.resolve();
      await expect(installing).rejects.toBe(reason);
      expect.soft(aliasWrites).toEqual([firstAliasPath]);
      expect
        .soft(await vfs.readFileText(firstAliasPath))
        .toBe(lightningRecipe.materialization.files[0]?.content);
      for (const path of laterAliasPaths) {
        expect.soft(await vfs.exists(path), path).toBe(false);
      }
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      write.mockRestore();
      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRegistryAlias(vfs, fixture.aliasRoot);
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports(scope));
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) =>
      (['ENOSPC', 'EACCES'] as const).map((code) => ({ code, scope })),
    ),
  )(
    '[fault: quota-perm-fail] keeps a $code $scope registry-alias write loud, unpublished, and exact on retry',
    async ({ code, scope }) => {
      const fixture = await registryAliasFixture(scope);
      const vfs = await project();
      const faultPath = `${fixture.aliasRoot}/${lightningRecipe.materialization.files[0]?.path}`;
      const failure = Object.assign(new Error(`${code}: registry-alias write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (path === faultPath) throw failure;
        await writeFile(path, data);
      });

      await expect(
        install('fixture', '1.0.0', fixture.dependencies, {
          vfs,
          cwd: '/project',
          registry: fixture.registry,
          onSubstitution: (line) => reports.push(line),
        }),
      ).rejects.toBe(failure);
      expect.soft(await vfs.exists(faultPath)).toBe(false);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      write.mockRestore();
      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRegistryAlias(vfs, fixture.aliasRoot);
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports(scope));
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a %s internals-shim write unpublished and exact on retry',
    async (code) => {
      const fixture = await registryAliasFixture('nested');
      const vfs = await project();
      const shimRoot = '/project/node_modules/lightningcss';
      const faultPath = `${shimRoot}/${lightningRecipe.materialization.files[0]?.path}`;
      const failure = Object.assign(new Error(`${code}: internals-shim write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectShim = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectShim && path === faultPath) {
          rejectShim = false;
          throw failure;
        }
        await writeFile(path, data);
      });

      await expect(
        install('fixture', '1.0.0', fixture.dependencies, {
          vfs,
          cwd: '/project',
          registry: fixture.registry,
          onSubstitution: (line) => reports.push(line),
        }),
      ).rejects.toBe(failure);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists(faultPath)).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRegistryAlias(vfs, shimRoot);
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports('nested'));
    },
  );

  it('[fault: corrupt-input] rejects a missing bin target before lock publication and repairs on retry', async () => {
    const broken = await registryEntry('broken-cli', '1.0.0', {
      bin: { broken: 'bin/missing.js' },
    });
    const repaired = await registryEntry('broken-cli', '1.0.0', {
      bin: { broken: 'bin/missing.js' },
      files: { 'bin/missing.js': 'throw new Error("repaired");\n' },
    });
    const vfs = await project();

    await expect(
      install(
        'fixture',
        '1.0.0',
        { 'broken-cli': '1.0.0' },
        { vfs, cwd: '/project', registry: registry(broken) },
      ),
    ).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/project/node_modules/broken-cli/bin/missing.js',
    });
    expect(await vfs.exists('/project/package-lock.json')).toBe(false);

    await install(
      'fixture',
      '1.0.0',
      { 'broken-cli': '1.0.0' },
      { vfs, cwd: '/project', registry: registry(repaired) },
    );
    expect(await vfs.readFileText('/project/node_modules/.bin/broken')).toBe(
      launcher('broken-cli', 'bin/missing.js'),
    );
    expect(await vfs.exists('/project/package-lock.json')).toBe(true);
  });

  it('[fault: torn-state] keeps an aborted real esbuild bin read unreported and exact on retry', async () => {
    const vfs = await project();
    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const reports: string[] = [];
    const readFile = vfs.readFile.bind(vfs);
    vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
      if (path === '/project/node_modules/esbuild/bin/esbuild') {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return await readFile(path);
    });
    const controller = new AbortController();
    const reason = new Error('cancel package-bin materialization');
    const installing = install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(),
        signal: controller.signal,
        onSubstitution: (line) => reports.push(line),
      },
    );

    await readStarted.promise;
    controller.abort(reason);
    releaseRead.resolve();
    await expect(installing).rejects.toBe(reason);
    expect.soft(reports).toEqual([]);
    expect.soft(await vfs.exists('/project/node_modules/.bin/esbuild')).toBe(false);
    expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

    vi.restoreAllMocks();
    await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(),
        onSubstitution: (line) => reports.push(line),
      },
    );
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('esbuild', 'bin/esbuild'),
    );
    expect(reports).toEqual([
      'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
    ]);
  });

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a real esbuild %s bin write unreported and retryable',
    async (code) => {
      const vfs = await project();
      const failure = Object.assign(new Error(`${code}: package-bin write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectLauncher = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectLauncher && path === '/project/node_modules/.bin/esbuild') {
          rejectLauncher = false;
          throw failure;
        }
        await writeFile(path, data);
      });

      await expect(
        install(
          'fixture',
          '1.0.0',
          { esbuild: '^0.28.0' },
          {
            vfs,
            cwd: '/project',
            registry: registry(),
            onSubstitution: (line) => reports.push(line),
          },
        ),
      ).rejects.toBe(failure);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      await install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: registry(),
          onSubstitution: (line) => reports.push(line),
        },
      );
      expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
        launcher('esbuild', 'bin/esbuild'),
      );
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual([
        'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
      ]);
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a %s lock write unpublished and exact on retry',
    async (code) => {
      const fixture = await registryAliasFixture('nested');
      const vfs = await project();
      const failure = Object.assign(new Error(`${code}: lock write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectLock = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectLock && path === '/project/package-lock.json') {
          rejectLock = false;
          throw failure;
        }
        await writeFile(path, data);
      });

      await expect(
        install('fixture', '1.0.0', fixture.dependencies, {
          vfs,
          cwd: '/project',
          registry: fixture.registry,
          onSubstitution: (line) => reports.push(line),
        }),
      ).rejects.toBe(failure);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRegistryAlias(vfs, fixture.aliasRoot);
      await expectExactRegistryAlias(vfs, '/project/node_modules/lightningcss');
      expect(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports('nested'));
    },
  );
});
