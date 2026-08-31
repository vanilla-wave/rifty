import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../_test-fixtures/tar-builder.ts';
import { install } from '../../installer.ts';
import type { Lockfile, LockfileEntry } from '../../linker.ts';
import type { Packument, VersionManifest } from '../../registry.ts';
import { RegistryClient } from '../../registry.ts';
import type { TarballCache } from '../../tarball-cache.ts';
import schemaOneShadowLockfile from './fixtures/schema-1-shadow-lockfile.json';
import { shadowAssetPlanForInstallResult } from './install-result.ts';
import { planShadowSubstitutionsFromLockfile } from './planner.ts';

type LightningManifest = VersionManifest & {
  readonly bundleDependencies: readonly string[];
};

type EsbuildManifest = VersionManifest & {
  readonly bundleDependencies: readonly string[];
};

class MemoryTarballCache implements TarballCache {
  readonly #entries = new Map<string, Uint8Array>();

  async get(name: string, version: string, integrity: string): Promise<Uint8Array | null> {
    return this.#entries.get(`${name}\0${version}\0${integrity}`)?.slice() ?? null;
  }

  async put(name: string, version: string, integrity: string, bytes: Uint8Array): Promise<string> {
    this.#entries.set(`${name}\0${version}\0${integrity}`, bytes.slice());
    return `memory:${name}@${version}`;
  }
}

class RejectingRegistry extends RegistryClient {
  reads = 0;

  constructor() {
    super({ baseUrl: '/must-not-read', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(_name: string): Promise<Packument> {
    this.reads += 1;
    throw new Error('synthetic esbuild must not read registry metadata');
  }

  override async getTarball(_url: string): Promise<Uint8Array> {
    this.reads += 1;
    throw new Error('synthetic esbuild must not read a registry tarball');
  }
}

class LightningRegistry extends RegistryClient {
  readonly #tarballs: ReadonlyMap<string, Uint8Array>;

  constructor(parentTarball: Uint8Array, compatibilityPoisonTarball: Uint8Array) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.#tarballs = new Map([
      ['https://registry.test/lightningcss-wasm-1.32.0.tgz', parentTarball],
      ['https://registry.test/napi-wasm-1.1.3.tgz', compatibilityPoisonTarball],
    ]);
  }

  override async getPackument(name: string): Promise<Packument> {
    let manifest: VersionManifest;
    if (name === 'lightningcss-wasm') {
      const parent: LightningManifest = {
        name,
        version: '1.32.0',
        dependencies: { 'napi-wasm': '^1.0.1' },
        optionalDependencies: {},
        peerDependencies: {},
        bundleDependencies: ['napi-wasm'],
        dist: { tarball: 'https://registry.test/lightningcss-wasm-1.32.0.tgz' },
      };
      manifest = parent;
    } else if (name === 'napi-wasm') {
      manifest = {
        name,
        version: '1.1.3',
        dist: { tarball: 'https://registry.test/napi-wasm-1.1.3.tgz' },
      };
    } else {
      throw new Error(`unexpected registry package ${name}`);
    }
    return {
      name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    const tarball = this.#tarballs.get(url);
    if (!tarball) throw new Error(`unexpected registry tarball ${url}`);
    return tarball.slice();
  }
}

class EsbuildRegistry extends RegistryClient {
  readonly reads: string[] = [];
  readonly #tarball: Uint8Array;

  constructor(tarball: Uint8Array) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.#tarball = tarball;
  }

  override async getPackument(name: string): Promise<Packument> {
    this.reads.push(`packument:${name}`);
    if (name !== 'esbuild-wasm') throw new Error(`unexpected registry package ${name}`);
    const manifest: EsbuildManifest = {
      name,
      version: '0.28.0',
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: [],
      dist: { tarball: 'https://registry.test/esbuild-wasm-0.28.0.tgz' },
    };
    return {
      name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.reads.push(`tarball:${url}`);
    if (url !== 'https://registry.test/esbuild-wasm-0.28.0.tgz') {
      throw new Error(`unexpected registry tarball ${url}`);
    }
    return this.#tarball.slice();
  }
}

async function fixtureTarball(files: Readonly<Record<string, string>>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (const [path, text] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(text);
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return gzip(concat(...chunks, TAR_TRAILER));
}

async function esbuildRegistry(): Promise<EsbuildRegistry> {
  return new EsbuildRegistry(
    await fixtureTarball({
      'package.json': JSON.stringify({
        name: 'esbuild-wasm',
        version: '0.28.0',
        dependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
        bundleDependencies: [],
      }),
      'esbuild.wasm': '\0asm-registry-twin-fixture',
    }),
  );
}

async function lightningRegistry(): Promise<LightningRegistry> {
  const parentTarball = await fixtureTarball({
    'package.json': JSON.stringify({
      name: 'lightningcss-wasm',
      version: '1.32.0',
      dependencies: { 'napi-wasm': '^1.0.1' },
      optionalDependencies: {},
      peerDependencies: {},
      bundleDependencies: ['napi-wasm'],
    }),
    'node_modules/napi-wasm/package.json': JSON.stringify({
      name: 'napi-wasm',
      version: '1.1.3',
    }),
    'node_modules/napi-wasm/index.js': 'module.exports = "bundled napi-wasm";\n',
  });
  const compatibilityPoisonTarball = await fixtureTarball({
    'package.json': JSON.stringify({ name: 'napi-wasm', version: '1.1.3' }),
    'index.js': 'module.exports = "standalone compatibility poison";\n',
  });
  return new LightningRegistry(parentTarball, compatibilityPoisonTarball);
}

async function freshLockfile(
  dependency: Readonly<Record<string, string>>,
  registry: RegistryClient,
): Promise<Lockfile> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  return (
    await install('fixture', '1.0.0', dependency, {
      vfs,
      cwd: '/project',
      registry,
      onSubstitution: () => {},
    })
  ).lockfile;
}

function expectShadowTraceDrift(lockfile: Lockfile): void {
  let caught: unknown;
  try {
    planShadowSubstitutionsFromLockfile(lockfile);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    code: 'EBROKENLOCK',
    reason: 'shadow-trace-drift',
  });
}

function schemaOneInstallerLockfile(kind: 'single' | 'reverse-multi'): unknown {
  const lockfile = structuredClone(schemaOneShadowLockfile) as unknown as {
    packages: Record<string, unknown>;
    rifty: {
      shadowSubstitutions: {
        applied: Array<{ trigger: { name: string } }>;
      };
    };
  };
  if (kind === 'reverse-multi') return lockfile;
  const esbuild = lockfile.packages['node_modules/esbuild'];
  if (!esbuild) throw new Error('schema-1 fixture is missing the esbuild entry');
  lockfile.packages = {
    '': {
      version: '1.0.0',
      dependencies: { esbuild: '0.28.0' },
    },
    'node_modules/esbuild': esbuild,
  };
  lockfile.rifty.shadowSubstitutions.applied = lockfile.rifty.shadowSubstitutions.applied.filter(
    ({ trigger }) => trigger.name === 'esbuild',
  );
  return lockfile;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow substitution installer boundary', () => {
  it('acquires and lockfile-replays the esbuild-wasm twin through the ordinary registry path', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const cache = new MemoryTarballCache();
    const firstRegistry = await esbuildRegistry();

    const first = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: firstRegistry,
        tarballCache: cache,
        onSubstitution: () => {},
      },
    );

    expect(firstRegistry.reads).toEqual([
      'packument:esbuild-wasm',
      'tarball:https://registry.test/esbuild-wasm-0.28.0.tgz',
    ]);
    expect(
      new TextDecoder().decode(
        await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm'),
      ),
    ).toBe('\0asm-registry-twin-fixture');
    expect(first.lockfile.packages['node_modules/esbuild-wasm']).toMatchObject({
      version: '0.28.0',
      resolved: 'https://registry.test/esbuild-wasm-0.28.0.tgz',
    });
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });

    const replayRegistry = new RejectingRegistry();
    const replay = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: replayRegistry,
        tarballCache: cache,
        onSubstitution: () => {},
      },
    );
    expect(replayRegistry.reads).toBe(0);
    expect(replay.lockfile).toEqual(first.lockfile);
    expect(
      new TextDecoder().decode(
        await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm'),
      ),
    ).toBe('\0asm-registry-twin-fixture');
  });

  it('projects the attested acquisition path as the only esbuild runtime binding', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const result = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: await esbuildRegistry(), onSubstitution: () => {} },
    );
    const internal = await import('./index.ts');
    const planFor = Reflect.get(internal, 'shadowSubstitutionPlanForInstallResult');
    expect(typeof planFor).toBe('function');
    if (typeof planFor !== 'function') return;
    const plan = Reflect.apply(planFor, undefined, [result]) as unknown;

    expect(plan).toMatchObject({
      bindings: [
        {
          adapterId: 'rifty.runtime-adapter.esbuild.v1',
          packagePath: 'node_modules/esbuild-wasm',
        },
      ],
    });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('materializes and lockfile-replays esbuild without registry acquisition', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const firstRegistry = new RejectingRegistry();

    const first = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: firstRegistry, onSubstitution: () => {} },
    );
    const firstMain = await vfs.readFile('/project/node_modules/esbuild/lib/main.cjs');
    const firstBin = await vfs.readFile('/project/node_modules/esbuild/bin/esbuild');
    const firstPackage = await vfs.readFile('/project/node_modules/esbuild/package.json');
    const plan = shadowAssetPlanForInstallResult(first);

    expect(firstRegistry.reads).toBe(0);
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });
    expect(first.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
    expect(plan.bindings).toEqual([
      {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    ]);

    const replayRegistry = new RejectingRegistry();
    const replay = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: replayRegistry, onSubstitution: () => {} },
    );

    expect(replayRegistry.reads).toBe(0);
    expect(await vfs.readFile('/project/node_modules/esbuild/lib/main.cjs')).toEqual(firstMain);
    expect(await vfs.readFile('/project/node_modules/esbuild/bin/esbuild')).toEqual(firstBin);
    expect(await vfs.readFile('/project/node_modules/esbuild/package.json')).toEqual(firstPackage);
    expect(shadowAssetPlanForInstallResult(replay)).toEqual(plan);
  });

  it.each([
    ['single', { esbuild: '^0.28.0' }, 'esbuild'],
    ['reverse-multi', { esbuild: '^0.28.0', lightningcss: '^1.32.0' }, 'lightningcss'],
  ] as const)(
    'rejects the schema-1 %s trace before registry, Eddy, or VFS mutation',
    async (kind, dependencies, packageName) => {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      await vfs.writeFile(
        '/project/package.json',
        JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies }),
      );
      await vfs.writeFile(
        '/project/package-lock.json',
        JSON.stringify(schemaOneInstallerLockfile(kind)),
      );

      const registry = new RejectingRegistry();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status: 599 }));
      const writers = [
        vi.spyOn(vfs, 'writeFile'),
        vi.spyOn(vfs, 'mkdir'),
        vi.spyOn(vfs, 'rm'),
        vi.spyOn(vfs, 'utimes'),
      ];

      let caught: unknown;
      try {
        await install({
          vfs,
          cwd: '/project',
          registry,
          resolverUrl: 'https://eddy.test/resolve',
          tarballCache: new MemoryTarballCache(),
          onSubstitution: () => {},
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'EBROKENLOCK',
        reason: 'shadow-trace-drift',
        packageName,
      });
      expect(registry.reads).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const writer of writers) expect(writer).not.toHaveBeenCalled();
    },
  );
});

describe('shadow substitution lockfile provenance', () => {
  let synthetic: Lockfile;
  let registry: Lockfile;

  beforeAll(async () => {
    synthetic = await freshLockfile({ esbuild: '^0.28.0' }, new RejectingRegistry());
    registry = await freshLockfile({ lightningcss: '^1.32.0' }, await lightningRegistry());
  });

  it.each([
    ['per-entry marker', false],
    ['reserved resolved identity', true],
  ] as const)('loudly names the missing trace when only a %s survives', (_label, removeMarker) => {
    const { rifty: _trace, ...withoutTrace } = structuredClone(synthetic);
    const entry = withoutTrace.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh synthetic lockfile entry missing');
    // biome-ignore lint/performance/noDelete: corruption fixture must remove the field.
    if (removeMarker) delete entry.riftyShadowRecipe;

    let caught: unknown;
    try {
      planShadowSubstitutionsFromLockfile(withoutTrace);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({
      feature: 'npm-client.lockfile.shadowSubstitutionTrace',
    });
  });

  it.each([
    // biome-ignore lint/performance/noDelete: corruption fixture must remove the field.
    ['missing resolved sentinel', (entry: LockfileEntry) => delete entry.resolved],
    [
      'missing rifty scheme',
      (entry: LockfileEntry) => {
        entry.resolved = 'shadow-substitution/rifty.shadow-substitution.esbuild.v2';
      },
    ],
    [
      'forged URL',
      (entry: LockfileEntry) => {
        entry.resolved = 'https://registry.test/esbuild-0.28.0.tgz';
      },
    ],
    [
      'wrong recipe id',
      (entry: LockfileEntry) => {
        entry.resolved = `rifty:shadow-substitution/forged@${'0'.repeat(64)}`;
      },
    ],
    [
      'wrong recipe digest',
      (entry: LockfileEntry) => {
        entry.resolved = `rifty:shadow-substitution/rifty.shadow-substitution.esbuild.v2@${'0'.repeat(64)}`;
      },
    ],
    [
      'registry integrity',
      (entry: LockfileEntry) => {
        entry.integrity = `sha512-${btoa(String.fromCharCode(...new Uint8Array(64)))}`;
      },
    ],
  ] as const)('rejects synthetic entry provenance drift: %s', (_label, tamper) => {
    const lockfile = structuredClone(synthetic);
    const entry = lockfile.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh synthetic lockfile entry missing');
    tamper(entry);

    expectShadowTraceDrift(lockfile);
  });

  it.each([
    [
      'missing acquisition entry',
      (lockfile: Lockfile) => {
        // biome-ignore lint/performance/noDelete: corruption fixture must remove the entry.
        delete lockfile.packages['node_modules/lightningcss-wasm'];
      },
    ],
    [
      'wrong acquisition version',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.version = '0.0.0';
      },
    ],
    [
      'wrong acquisition resolved URL',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.resolved = 'https://registry.test/forged.tgz';
      },
    ],
    [
      'wrong acquisition integrity',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/lightningcss-wasm'];
        if (entry) entry.integrity = 'sha512-forged';
      },
    ],
  ] as const)('rejects registry acquisition provenance drift: %s', (_label, tamper) => {
    const lockfile = structuredClone(registry);
    tamper(lockfile);

    expectShadowTraceDrift(lockfile);
  });

  it.each(['resolved', 'integrity'] as const)(
    'rejects forged %s provenance on the registry materialization alias',
    (field) => {
      const lockfile = structuredClone(registry);
      const alias = lockfile.packages['node_modules/lightningcss'];
      const acquisition = lockfile.packages['node_modules/lightningcss-wasm'];
      if (!alias || !acquisition) throw new Error('fresh registry lockfile entries missing');
      alias[field] = acquisition[field];

      expectShadowTraceDrift(lockfile);
    },
  );
});
