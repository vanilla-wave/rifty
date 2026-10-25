import { NotImplementedError } from '@riftydev/io';
import { internalsShims } from '@riftydev/shadow-registry';
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
import { install } from './index.ts';
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
    const versions =
      this.entries.get(name) ??
      (name === 'esbuild-wasm'
        ? new Map([['0.28.0', await exactEsbuildWasmRegistryEntry()]])
        : undefined);
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
    const name = match ? decodeURIComponent(match[1] ?? '') : '';
    const version = match?.[2] ?? '';
    const entry =
      this.entries.get(name)?.get(version) ??
      (name === 'esbuild-wasm' && version === '0.28.0'
        ? await exactEsbuildWasmRegistryEntry()
        : undefined);
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

let esbuildWasmRegistryEntry: Promise<RegistryEntry> | undefined;

function exactEsbuildWasmRegistryEntry(): Promise<RegistryEntry> {
  esbuildWasmRegistryEntry ??= registryEntry('esbuild-wasm', '0.28.0');
  return esbuildWasmRegistryEntry;
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

function writeText(data: string | Uint8Array): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const esbuildRecipe = (() => {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.id === 'rifty.shadow-substitution.esbuild.v2',
  );
  if (!recipe || recipe.acquisition.kind !== 'registry') {
    throw new Error('builtin esbuild registry-twin recipe is missing');
  }
  return recipe;
})();

const lightningRecipe = (() => {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.id === 'rifty.shadow-substitution.lightningcss.v2',
  );
  if (!recipe || recipe.acquisition.kind !== 'registry') {
    throw new Error('builtin LightningCSS registry recipe is missing');
  }
  return recipe;
})();

const rollupNativeShim = (() => {
  const content = internalsShims.rollup?.files['dist/native.js'];
  if (!content) throw new Error('builtin Rollup native shim is missing');
  return content;
})();

const REAL_ROLLUP_NATIVE = 'throw new Error("REAL-NATIVE-SENTINEL");\n';
const ESBUILD_REPORT =
  'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)';
const ESBUILD_REDIRECT_REPORT =
  'npm: esbuild@^0.28.0 → esbuild-wasm@0.28.0 (substituted from shadow registry, ADR-0051)';
const ROLLUP_REPORT = 'npm: rollup@4.62.2 internals patched from shadow registry';

type RegistryAliasScope = 'root' | 'nested';

interface RegistryAliasFixture {
  readonly aliasRoot: string;
  readonly dependencies: Record<string, string>;
  readonly entries: readonly RegistryEntry[];
  readonly registry: FixtureRegistry;
}

async function lightningEntries(
  bin?: Record<string, string>,
): Promise<readonly [RegistryEntry, RegistryEntry]> {
  return [
    await registryEntry('lightningcss-wasm', '1.32.0', {
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
      ...(bin === undefined ? {} : { bin }),
      files: {
        ...(bin === undefined ? {} : { 'bin/twin.js': 'throw new Error("acquired twin");\n' }),
        'node_modules/napi-wasm/package.json': JSON.stringify({
          name: 'napi-wasm',
          version: '1.1.3',
        }),
        'node_modules/napi-wasm/index.js': 'module.exports = "bundled napi-wasm";\n',
      },
    }),
    // Kept reachable while the acquired manifest's dependency projection is
    // still traversed; the recipe's bundled member remains the installed byte source.
    await registryEntry('napi-wasm', '1.1.3'),
  ];
}

async function registryAliasFixture(scope: RegistryAliasScope): Promise<RegistryAliasFixture> {
  const baseEntries = await lightningEntries();
  if (scope === 'root') {
    return {
      aliasRoot: '/project/node_modules/lightningcss',
      dependencies: { lightningcss: '^1.32.0' },
      entries: baseEntries,
      registry: registry(...baseEntries),
    };
  }

  const occupiedAcquisitionName = await registryEntry('lightningcss-wasm', '1.32.1');
  const nestedHost = await registryEntry('nested-host', '1.0.0', {
    dependencies: { lightningcss: '^1.32.0' },
  });
  const entries = [...baseEntries, occupiedAcquisitionName, nestedHost];
  return {
    aliasRoot: '/project/node_modules/nested-host/node_modules/lightningcss',
    dependencies: {
      'lightningcss-wasm': '1.32.1',
      'nested-host': '1.0.0',
    },
    entries,
    registry: registry(...entries),
  };
}

async function rollupEntries(): Promise<readonly [RegistryEntry, RegistryEntry]> {
  return [
    await registryEntry('rollup', '4.62.2', {
      files: { 'dist/native.js': REAL_ROLLUP_NATIVE },
    }),
    await registryEntry('@rollup/wasm-node', '4.62.2'),
  ];
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

async function expectExactRecipeFiles(
  vfs: MemoryVfs,
  root: string,
  files: readonly { readonly path: string; readonly content: string }[],
): Promise<void> {
  for (const file of files) {
    expect(await vfs.readFileText(`${root}/${file.path}`)).toBe(file.content);
  }
}

async function project(): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return vfs;
}

async function expectBinCollision(run: Promise<unknown>): Promise<NotImplementedError> {
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
  if (!(caught instanceof NotImplementedError)) {
    throw new Error('Expected npm-client.bin-collision-reify');
  }
  return caught;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow materialized-bin commit authority', () => {
  it('[fault: observable-order] completes exact files → aliases → one recipe bin → real shim → lock → reports', async () => {
    const vfs = await project();
    const lightning = await lightningEntries();
    const rollup = await rollupEntries();
    const aliasPaths = lightningRecipe.materialization.files.map(
      ({ path }) => `/project/node_modules/lightningcss/${path}`,
    );
    const packagePaths = [
      ...esbuildRecipe.materialization.files.map(
        ({ path }) => `/project/node_modules/esbuild/${path}`,
      ),
      '/project/node_modules/esbuild-wasm/package.json',
      '/project/node_modules/lightningcss-wasm/package.json',
      '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/index.js',
      '/project/node_modules/lightningcss-wasm/node_modules/napi-wasm/package.json',
      '/project/node_modules/rollup/dist/native.js',
      '/project/node_modules/rollup/package.json',
      '/project/node_modules/@rollup/wasm-node/package.json',
    ].sort();
    const binPaths = ['/project/node_modules/.bin/esbuild'];
    const shimPaths = ['/project/node_modules/rollup/dist/native.js'];
    const [lightningRedirectReport, lightningMaterializedReport] = expectedLightningReports('root');
    const expectedReports = [
      ESBUILD_REDIRECT_REPORT,
      lightningRedirectReport,
      ESBUILD_REPORT,
      lightningMaterializedReport,
      ROLLUP_REPORT,
    ];
    const phases: string[] = [];
    const completed = {
      files: [] as string[],
      aliases: [] as string[],
      bins: [] as string[],
      shims: [] as string[],
      locks: [] as string[],
      reports: [] as string[],
    };
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      await writeFile(path, data);
      if (path === '/project/package-lock.json') {
        phases.push('lock');
        completed.locks.push(path);
      } else if (aliasPaths.includes(path)) {
        phases.push('aliases');
        completed.aliases.push(path);
      } else if (binPaths.includes(path)) {
        phases.push('bins');
        completed.bins.push(path);
      } else if (path === shimPaths[0] && writeText(data) === rollupNativeShim) {
        phases.push('shims');
        completed.shims.push(path);
      } else if (path.startsWith('/project/node_modules/')) {
        phases.push('files');
        completed.files.push(path);
      }
    });

    const result = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0', lightningcss: '^1.32.0', rollup: '4.62.2' },
      {
        vfs,
        cwd: '/project',
        registry: registry(...lightning, ...rollup),
        onSubstitution: (line) => {
          phases.push('reports');
          completed.reports.push(line);
        },
      },
    );

    expect.soft(completed.files.sort()).toEqual(packagePaths);
    expect.soft(completed.aliases.sort()).toEqual([...aliasPaths].sort());
    expect.soft(completed.bins).toEqual(binPaths);
    expect.soft(completed.shims).toEqual(shimPaths);
    expect.soft(completed.locks).toEqual(['/project/package-lock.json']);
    expect.soft(completed.reports).toEqual(expectedReports);
    expect
      .soft(phases)
      .toEqual([
        ...Array<string>(packagePaths.length).fill('files'),
        ...Array<string>(aliasPaths.length).fill('aliases'),
        ...Array<string>(binPaths.length).fill('bins'),
        ...Array<string>(shimPaths.length).fill('shims'),
        'lock',
        ...Array<string>(expectedReports.length).fill('reports'),
      ]);
    expect.soft(await vfs.readFileText(binPaths[0]!)).toBe(launcher('esbuild', 'bin/esbuild'));
    expect.soft(result.lockfile.packages['node_modules/esbuild']?.bin).toEqual({
      esbuild: 'bin/esbuild',
    });
  });

  it('[fault: observable-order] reproduces exact esbuild recipe bytes, launcher, lock claim, and post-commit report on fresh + replay', async () => {
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

    expect
      .soft(freshEvents)
      .toEqual(['lock', `report:${ESBUILD_REDIRECT_REPORT}`, `report:${ESBUILD_REPORT}`]);
    await expectExactRecipeFiles(
      vfs,
      '/project/node_modules/esbuild',
      esbuildRecipe.materialization.files,
    );
    expect
      .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
      .toBe(launcher('esbuild', 'bin/esbuild'));
    expect.soft(fresh.lockfile.packages['node_modules/esbuild']?.bin).toEqual({
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
    expect.soft(replayReports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT]);
    await expectExactRecipeFiles(
      vfs,
      '/project/node_modules/esbuild',
      esbuildRecipe.materialization.files,
    );
    expect
      .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
      .toBe(launcher('esbuild', 'bin/esbuild'));
    expect(replay.lockfile).toEqual(fresh.lockfile);
  });

  it.each([
    ['shadow-first', { esbuild: '^0.28.0', 'provider-z': '1.0.0' }],
    ['ordinary-first', { 'provider-z': '1.0.0', esbuild: '^0.28.0' }],
  ])(
    '[fault: frozen-assumption] rejects current same-scope collision before effects (%s)',
    async (_name, dependencies) => {
      const rival = await registryEntry('provider-z', '1.0.0', {
        bin: { esbuild: 'bin/provider.js' },
        files: { 'bin/provider.js': 'throw new Error("provider-z");\n' },
      });
      const vfs = await project();
      const reports: string[] = [];

      const collision = await expectBinCollision(
        install('fixture', '1.0.0', dependencies, {
          vfs,
          cwd: '/project',
          registry: registry(rival),
          onSubstitution: (line) => reports.push(line),
        }),
      );
      expect(collision.message).toBe(
        'Not implemented: npm-client.bin-collision-reify (invariant=claim-uniqueness claimSet=current nodeModulesDir=node_modules command=esbuild firstOwner=provider-z secondOwner=esbuild)',
      );

      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/node_modules')).toBe(false);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);
    },
  );

  it('[fault: observable-order] rejects a prior owner transition with zero new effects', async () => {
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
      { vfs, cwd: '/project', registry: fixtureRegistry },
    );
    const oldLock = await vfs.readFileText('/project/package-lock.json');
    const reports: string[] = [];
    const writes: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.startsWith('/project/node_modules/') || path === '/project/package-lock.json') {
        writes.push(path);
      }
      await writeFile(path, data);
    });

    const collision = await expectBinCollision(
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
    expect(collision.message).toBe(
      'Not implemented: npm-client.bin-collision-reify (invariant=prior-owner-continuity nodeModulesDir=node_modules command=esbuild priorOwner=provider-z currentOwner=esbuild)',
    );

    expect.soft(reports).toEqual([]);
    expect.soft(writes).toEqual([]);
    expect.soft(await vfs.readFileText('/project/package-lock.json')).toBe(oldLock);
    expect.soft(await vfs.exists('/project/node_modules/esbuild')).toBe(false);
    expect(await vfs.readFileText('/project/node_modules/.bin/esbuild')).toBe(
      launcher('provider-z', 'bin/provider.js'),
    );
  });

  it('[fault: frozen-assumption] rejects a recorded prior duplicate with zero new effects', async () => {
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
    const writes: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.startsWith('/project/node_modules/') || path === lockPath) writes.push(path);
      await writeFile(path, data);
    });

    const collision = await expectBinCollision(
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
    expect(collision.message).toBe(
      'Not implemented: npm-client.bin-collision-reify (invariant=claim-uniqueness claimSet=prior nodeModulesDir=node_modules command=shared firstOwner=provider-a secondOwner=provider-z)',
    );

    expect.soft(reports).toEqual([]);
    expect.soft(writes).toEqual([]);
    expect.soft(await vfs.readFileText(lockPath)).toBe(priorLock);
    expect(await vfs.readFileText('/project/node_modules/.bin/shared')).toBe(
      launcher('provider-a', 'bin/a.js'),
    );
  });

  it('[fault: provenance-lie][fault: sibling-drift] names an npm-recorded prior owner omitted by the current install', async () => {
    const vfs = await project();
    const lockPath = '/project/package-lock.json';
    const priorLock = JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { version: '1.0.0' },
          'node_modules/@grpc/proto-loader': {
            version: '0.8.0',
            peer: true,
            bin: {
              'proto-loader-gen-types': 'build/bin/proto-loader-gen-types.js',
            },
          },
        },
      },
      null,
      2,
    );
    await vfs.writeFile(lockPath, priorLock);
    const writes: string[] = [];
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.startsWith('/project/node_modules/') || path === lockPath) writes.push(path);
      await writeFile(path, data);
    });

    const collision = await expectBinCollision(
      install('fixture', '1.0.0', {}, { vfs, cwd: '/project', registry: registry() }),
    );

    expect(collision.message).toBe(
      'Not implemented: npm-client.bin-collision-reify (invariant=prior-owner-continuity nodeModulesDir=node_modules command=proto-loader-gen-types priorOwner=@grpc/proto-loader currentOwner=<none>)',
    );
    expect.soft(writes).toEqual([]);
    expect(await vfs.readFileText(lockPath)).toBe(priorLock);
  });

  it('[fault: provenance-lie] excludes a unique acquired-twin command from disk, result, and acquisition lock entry', async () => {
    const lightning = await lightningEntries({ lightningcss: 'bin/twin.js' });
    const vfs = await project();

    const result = await install(
      'fixture',
      '1.0.0',
      { lightningcss: '^1.32.0' },
      {
        vfs,
        cwd: '/project',
        registry: registry(...lightning),
        onSubstitution: () => {},
      },
    );

    expect.soft(await vfs.exists('/project/node_modules/.bin/lightningcss')).toBe(false);
    expect
      .soft(result.packages.find(({ name }) => name === 'lightningcss-wasm')?.bin)
      .toBeUndefined();
    expect(result.lockfile.packages['node_modules/lightningcss-wasm']?.bin).toBeUndefined();
  });

  it.each([
    ['shadow-first', { lightningcss: '^1.32.0', 'provider-z': '1.0.0' }],
    ['ordinary-first', { 'provider-z': '1.0.0', lightningcss: '^1.32.0' }],
  ])(
    '[fault: provenance-lie / sibling-drift] excludes acquired twin claim while retaining ordinary sibling (%s)',
    async (_name, dependencies) => {
      const lightning = await lightningEntries({ shared: 'bin/twin.js' });
      const provider = await registryEntry('provider-z', '1.0.0', {
        bin: { shared: 'bin/provider.js' },
        files: { 'bin/provider.js': 'throw new Error("provider-z");\n' },
      });
      const vfs = await project();

      const result = await install('fixture', '1.0.0', dependencies, {
        vfs,
        cwd: '/project',
        registry: registry(...lightning, provider),
        onSubstitution: () => {},
      });

      expect
        .soft(await vfs.readFileText('/project/node_modules/.bin/shared'))
        .toBe(launcher('provider-z', 'bin/provider.js'));
      expect
        .soft(result.packages.find(({ name }) => name === 'lightningcss-wasm')?.bin)
        .toBeUndefined();
      expect.soft(result.lockfile.packages['node_modules/lightningcss-wasm']?.bin).toBeUndefined();
      expect(result.lockfile.packages['node_modules/provider-z']?.bin).toEqual({
        shared: 'bin/provider.js',
      });
    },
  );

  it('[fault: corrupt-input] keeps a missing real esbuild recipe target loud and repairs exactly on retry', async () => {
    const vfs = await project();
    const target = '/project/node_modules/esbuild/bin/esbuild';
    const failure = Object.assign(new Error(`ENOENT: no such file, open '${target}'`), {
      code: 'ENOENT',
      path: target,
    });
    const reports: string[] = [];
    const readFile = vfs.readFile.bind(vfs);
    const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
      if (path === target) throw failure;
      return await readFile(path);
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
    expect.soft(await vfs.exists('/project/node_modules/.bin/esbuild')).toBe(false);
    expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

    read.mockRestore();
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
    await expectExactRecipeFiles(
      vfs,
      '/project/node_modules/esbuild',
      esbuildRecipe.materialization.files,
    );
    expect
      .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
      .toBe(launcher('esbuild', 'bin/esbuild'));
    expect(reports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT]);
  });

  it('[fault: torn-state] keeps a parked esbuild bin abort unpublished and exact on retry', async () => {
    const vfs = await project();
    const target = '/project/node_modules/esbuild/bin/esbuild';
    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const reports: string[] = [];
    const readFile = vfs.readFile.bind(vfs);
    const read = vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
      if (path === target) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return await readFile(path);
    });
    const controller = new AbortController();
    const reason = new Error('cancel exact esbuild bin materialization');
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

    read.mockRestore();
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
    expect
      .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
      .toBe(launcher('esbuild', 'bin/esbuild'));
    expect(reports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT]);
  });

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a real esbuild %s bin write loud, unpublished, and exact on retry',
    async (code) => {
      const vfs = await project();
      const launcherPath = '/project/node_modules/.bin/esbuild';
      const failure = Object.assign(new Error(`${code}: package-bin write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectLauncher = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectLauncher && path === launcherPath) {
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
      expect.soft(await vfs.exists(launcherPath)).toBe(false);
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
      expect.soft(await vfs.readFileText(launcherPath)).toBe(launcher('esbuild', 'bin/esbuild'));
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT]);
    },
  );

  it.each(['root', 'nested'] as const)(
    '[fault: torn-state] stops a parked %s Lightning alias abort after one write and reconciles on retry',
    async (scope) => {
      const fixture = await registryAliasFixture(scope);
      const vfs = await project();
      const firstFile = lightningRecipe.materialization.files[0];
      if (!firstFile) throw new Error('test setup: Lightning recipe files missing');
      const firstPath = `${fixture.aliasRoot}/${firstFile.path}`;
      const laterPaths = lightningRecipe.materialization.files
        .slice(1)
        .map(({ path }) => `${fixture.aliasRoot}/${path}`);
      const aliasPaths = new Set([firstPath, ...laterPaths]);
      const aliasWrites: string[] = [];
      const writeStarted = deferred<void>();
      const releaseWrite = deferred<void>();
      const writeFile = vfs.writeFile.bind(vfs);
      const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (aliasPaths.has(path)) aliasWrites.push(path);
        if (path === firstPath) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await writeFile(path, data);
      });
      const controller = new AbortController();
      const reason = new Error(`cancel ${scope} Lightning alias materialization`);
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
      expect.soft(aliasWrites).toEqual([firstPath]);
      expect.soft(await vfs.readFileText(firstPath)).toBe(firstFile.content);
      for (const path of laterPaths) expect.soft(await vfs.exists(path), path).toBe(false);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      write.mockRestore();
      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRecipeFiles(vfs, fixture.aliasRoot, lightningRecipe.materialization.files);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports(scope));
    },
  );

  it.each(
    (['root', 'nested'] as const).flatMap((scope) =>
      (['ENOSPC', 'EACCES'] as const).map((code) => ({ code, scope })),
    ),
  )(
    '[fault: quota-perm-fail] keeps a $code $scope Lightning alias write loud, unpublished, and exact on retry',
    async ({ code, scope }) => {
      const fixture = await registryAliasFixture(scope);
      const vfs = await project();
      const firstFile = lightningRecipe.materialization.files[0];
      if (!firstFile) throw new Error('test setup: Lightning recipe files missing');
      const faultPath = `${fixture.aliasRoot}/${firstFile.path}`;
      const failure = Object.assign(new Error(`${code}: registry-alias write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectAlias = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectAlias && path === faultPath) {
          rejectAlias = false;
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
      expect.soft(await vfs.exists(faultPath)).toBe(false);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      await install('fixture', '1.0.0', fixture.dependencies, {
        vfs,
        cwd: '/project',
        registry: fixture.registry,
        onSubstitution: (line) => reports.push(line),
      });
      await expectExactRecipeFiles(vfs, fixture.aliasRoot, lightningRecipe.materialization.files);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual(expectedLightningReports(scope));
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a real Rollup %s shim write loud, unpublished, and exact on retry',
    async (code) => {
      const entries = await rollupEntries();
      const vfs = await project();
      const faultPath = '/project/node_modules/rollup/dist/native.js';
      const failure = Object.assign(new Error(`${code}: Rollup shim write denied`), { code });
      const reports: string[] = [];
      const writeFile = vfs.writeFile.bind(vfs);
      let rejectShim = true;
      vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
        if (rejectShim && path === faultPath && writeText(data) === rollupNativeShim) {
          rejectShim = false;
          throw failure;
        }
        await writeFile(path, data);
      });

      await expect(
        install(
          'fixture',
          '1.0.0',
          { esbuild: '^0.28.0', rollup: '4.62.2' },
          {
            vfs,
            cwd: '/project',
            registry: registry(...entries),
            onSubstitution: (line) => reports.push(line),
          },
        ),
      ).rejects.toBe(failure);
      expect.soft(await vfs.readFileText(faultPath)).toBe(REAL_ROLLUP_NATIVE);
      expect.soft(reports).toEqual([]);
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(false);

      await install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0', rollup: '4.62.2' },
        {
          vfs,
          cwd: '/project',
          registry: registry(...entries),
          onSubstitution: (line) => reports.push(line),
        },
      );
      expect.soft(await vfs.readFileText(faultPath)).toBe(rollupNativeShim);
      expect
        .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
        .toBe(launcher('esbuild', 'bin/esbuild'));
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT, ROLLUP_REPORT]);
    },
  );

  it.each(['ENOSPC', 'EACCES'] as const)(
    '[fault: quota-perm-fail] keeps a %s lock write loud, unpublished, and exact on retry',
    async (code) => {
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
      await expectExactRecipeFiles(
        vfs,
        '/project/node_modules/esbuild',
        esbuildRecipe.materialization.files,
      );
      expect
        .soft(await vfs.readFileText('/project/node_modules/.bin/esbuild'))
        .toBe(launcher('esbuild', 'bin/esbuild'));
      expect.soft(await vfs.exists('/project/package-lock.json')).toBe(true);
      expect(reports).toEqual([ESBUILD_REDIRECT_REPORT, ESBUILD_REPORT]);
    },
  );
});
