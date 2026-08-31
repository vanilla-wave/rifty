import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
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
import { computeIntegrity } from '../../tarball-cache.ts';
import schemaOneShadowLockfile from './fixtures/schema-1-shadow-lockfile.json';
import { shadowSubstitutionPlanForInstallResult } from './install-result.ts';
import { planShadowSubstitutionsFromLockfile } from './planner.ts';

type LightningManifest = VersionManifest & {
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

  replace(name: string, version: string, integrity: string, bytes: Uint8Array): void {
    this.#entries.set(`${name}\0${version}\0${integrity}`, bytes.slice());
  }
}

class RejectingRegistry extends RegistryClient {
  reads = 0;

  constructor() {
    super({ baseUrl: '/must-not-read', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(_name: string): Promise<Packument> {
    this.reads += 1;
    throw new Error('offline replay must not read registry metadata');
  }

  override async getTarball(_url: string): Promise<Uint8Array> {
    this.reads += 1;
    throw new Error('offline replay must not read a registry tarball');
  }
}

class EsbuildRegistry extends RegistryClient {
  packumentReads = 0;
  tarballReads = 0;

  constructor(
    private readonly tarball: Uint8Array,
    private readonly integrity: string,
    private readonly options: Readonly<{
      dependencies?: Readonly<Record<string, string>>;
      optionalDependencies?: Readonly<Record<string, string>>;
      peerDependencies?: Readonly<Record<string, string>>;
      bundleDependencies?: readonly string[];
      returnedTarball?: Uint8Array;
    }> = {},
  ) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads += 1;
    if (name !== 'esbuild-wasm') throw new Error(`unexpected registry package ${name}`);
    const manifest: VersionManifest & { readonly bundleDependencies?: readonly string[] } = {
      name,
      version: '0.28.0',
      dependencies: { ...(this.options.dependencies ?? {}) },
      optionalDependencies: { ...(this.options.optionalDependencies ?? {}) },
      peerDependencies: { ...(this.options.peerDependencies ?? {}) },
      ...(this.options.bundleDependencies === undefined
        ? {}
        : { bundleDependencies: [...this.options.bundleDependencies] }),
      dist: {
        tarball: 'https://registry.test/esbuild-wasm-0.28.0.tgz',
        integrity: this.integrity,
      },
    };
    return {
      name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.tarballReads += 1;
    if (url !== 'https://registry.test/esbuild-wasm-0.28.0.tgz') {
      throw new Error(`unexpected registry tarball ${url}`);
    }
    return (this.options.returnedTarball ?? this.tarball).slice();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class StallingEsbuildRegistry extends EsbuildRegistry {
  readonly reached = deferred<void>();

  override async getTarball(
    _url: string,
    options: Parameters<RegistryClient['getTarball']>[1] = {},
  ): Promise<Uint8Array> {
    this.tarballReads += 1;
    this.reached.resolve(undefined);
    return await new Promise<Uint8Array>((_resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
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

async function fixtureTarball(
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    chunks.push(buildHeader(`package/${path}`, bytes.length), padToBlock(bytes));
  }
  return gzip(concat(...chunks, TAR_TRAILER));
}

const requireFromRegistry = createRequire(
  new URL('../../../../../tools/shadow-registry/package.json', import.meta.url),
);
const exactEsbuildWasm = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);
const exactEsbuildWasmSha256 = createHash('sha256').update(exactEsbuildWasm).digest('hex');
const fixtureEsbuildTarballIntegrity =
  'sha512-55tsopeJgNV0B+Pha3VS0T7X4oGZhbaMVDCiv/VPCsyy3OQGXhGLeRwfzOP+AHr02GHuh7FLnYlMCoz+MDzC6g==';

let esbuildTarballPromise: Promise<Readonly<{ bytes: Uint8Array; integrity: string }>> | undefined;

async function esbuildTarball(): Promise<Readonly<{ bytes: Uint8Array; integrity: string }>> {
  esbuildTarballPromise ??= (async () => {
    const tarball = await fixtureTarball({
      'package.json': JSON.stringify({
        name: 'esbuild-wasm',
        version: '0.28.0',
        dependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
      }),
      'esbuild.wasm': exactEsbuildWasm,
    });
    const integrity = await computeIntegrity(tarball);
    if (integrity !== fixtureEsbuildTarballIntegrity) {
      throw new Error(`esbuild-wasm registry fixture integrity drifted: ${integrity}`);
    }
    return Object.freeze({ bytes: tarball, integrity: fixtureEsbuildTarballIntegrity });
  })();
  return esbuildTarballPromise;
}

async function esbuildRegistry(
  options?: ConstructorParameters<typeof EsbuildRegistry>[2],
): Promise<EsbuildRegistry> {
  const tarball = await esbuildTarball();
  return new EsbuildRegistry(tarball.bytes, tarball.integrity, options);
}

function adaptVfs(base: Vfs, writeFile: Vfs['writeFile']): Vfs {
  return {
    readFile: (path) => base.readFile(path),
    readFileText: (path, encoding) => base.readFileText(path, encoding),
    writeFile,
    readdir: (path) => base.readdir(path),
    mkdir: (path, options) => base.mkdir(path, options),
    rm: (path, options) => base.rm(path, options),
    stat: (path) => base.stat(path),
    exists: (path) => base.exists(path),
    utimes: (path, atimeMs, mtimeMs) => base.utimes(path, atimeMs, mtimeMs),
    openReadable: (path, options) => base.openReadable(path, options),
  };
}

async function snapshotTree(vfs: Vfs, root: string): Promise<Record<string, readonly number[]>> {
  const files: Record<string, readonly number[]> = {};
  const visit = async (path: string): Promise<void> => {
    for (const entry of await vfs.readdir(path)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) await visit(child);
      else files[child.slice(root.length)] = [...(await vfs.readFile(child))];
    }
  };
  if (await vfs.exists(root)) await visit(root);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function exactEsbuildProjectTree(): Promise<Record<string, readonly number[]>> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await install(
    'fixture',
    '1.0.0',
    { esbuild: '^0.28.0' },
    {
      vfs,
      cwd: '/project',
      registry: await esbuildRegistry(),
    },
  );
  return snapshotTree(vfs, '/project');
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
  it('keeps a bare ordinary esbuild-wasm install outside executable adapter authority', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const result = await install(
      'fixture',
      '1.0.0',
      { 'esbuild-wasm': '0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: await esbuildRegistry(),
      },
    );

    expect(shadowSubstitutionPlanForInstallResult(result)).toEqual({
      substitutions: [],
      bindings: [],
    });
    expect(await vfs.exists('/project/node_modules/esbuild')).toBe(false);
    expect(await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(
      exactEsbuildWasm,
    );
  });

  it('acquires the exact esbuild-wasm twin in-tree and lockfile-replays it offline', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const firstRegistry = await esbuildRegistry();

    const first = await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      { vfs, cwd: '/project', registry: firstRegistry, onSubstitution: () => {} },
    );
    const firstMain = await vfs.readFile('/project/node_modules/esbuild/lib/main.cjs');
    const firstBin = await vfs.readFile('/project/node_modules/esbuild/bin/esbuild');
    const firstPackage = await vfs.readFile('/project/node_modules/esbuild/package.json');
    const firstWasm = await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm');

    expect(firstRegistry.packumentReads).toBe(1);
    expect(firstRegistry.tarballReads).toBe(1);
    expect(firstWasm.byteLength).toBe(13_918_738);
    expect(createHash('sha256').update(firstWasm).digest('hex')).toBe(exactEsbuildWasmSha256);
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });
    expect(first.lockfile.packages['node_modules/esbuild-wasm']).toMatchObject({
      version: '0.28.0',
      integrity: fixtureEsbuildTarballIntegrity,
      resolved: 'https://registry.test/esbuild-wasm-0.28.0.tgz',
    });
    expect(first.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);

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
    expect(await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(
      firstWasm,
    );
    expect(replay.lockfile).toEqual(first.lockfile);
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

describe('esbuild-wasm registry-twin fault publication', () => {
  it.each([
    ['dependencies', { dependencies: { forged: '1.0.0' } }],
    ['optionalDependencies', { optionalDependencies: { forged: '1.0.0' } }],
    ['peerDependencies', { peerDependencies: { forged: '1.0.0' } }],
    ['bundleDependencies', { bundleDependencies: ['forged'] }],
  ] as const)(
    '[fault: corrupt-input / provenance-lie] rejects %s projection drift before tarball or VFS work',
    async (_field, projection) => {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/project', { recursive: true });
      const registry = await esbuildRegistry(projection);

      await expect(
        install('fixture', '1.0.0', { esbuild: '^0.28.0' }, { vfs, cwd: '/project', registry }),
      ).rejects.toMatchObject({ feature: 'esbuild.acquisition' });

      expect(registry.packumentReads).toBe(1);
      expect(registry.tarballReads).toBe(0);
      expect(await vfs.exists('/project/node_modules')).toBe(false);
      expect(await vfs.exists('/project/package-lock.json')).toBe(false);
    },
  );

  it('[fault: unbounded-read / observable-order] forwards abort to a reached twin tarball stall and retries exactly', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const source = await esbuildTarball();
    const registry = new StallingEsbuildRegistry(source.bytes, source.integrity);
    const abort = new AbortController();
    const treeBefore = await snapshotTree(vfs, '/project/node_modules');
    const installing = install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry,
        signal: abort.signal,
      },
    );
    await registry.reached.promise;
    const reason = new Error('abort reached esbuild-wasm tarball stall');
    abort.abort(reason);

    await expect(installing).rejects.toBe(reason);
    expect(await snapshotTree(vfs, '/project/node_modules')).toEqual(treeBefore);
    expect(await vfs.exists('/project/package-lock.json')).toBe(false);
    await expect(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: await esbuildRegistry(),
        },
      ),
    ).resolves.toMatchObject({ lockfile: { lockfileVersion: 3 } });
  });

  it('[fault: corrupt-input / provenance-lie] keeps wrong-integrity bytes unpublished and retries exactly', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const source = await esbuildTarball();
    const corrupt = source.bytes.slice();
    corrupt[Math.floor(corrupt.byteLength / 2)]! ^= 0xff;
    const reports: string[] = [];

    await expect(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: await esbuildRegistry({ returnedTarball: corrupt }),
          onSubstitution: (line) => reports.push(line),
        },
      ),
    ).rejects.toThrow(/integrity/i);
    expect(reports).toEqual([]);
    expect(await vfs.exists('/project/node_modules')).toBe(false);
    expect(await vfs.exists('/project/package-lock.json')).toBe(false);

    await expect(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: await esbuildRegistry(),
        },
      ),
    ).resolves.toMatchObject({ lockfile: { lockfileVersion: 3 } });
    expect(await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(
      exactEsbuildWasm,
    );
  });

  it.each(
    (['ENOSPC', 'EACCES'] as const).flatMap((code) =>
      (
        [
          ['twin', '/node_modules/esbuild-wasm/esbuild.wasm'],
          ['facade', '/node_modules/esbuild/lib/main.cjs'],
          ['bin', '/node_modules/.bin/esbuild'],
        ] as const
      ).map(([surface, suffix]) => ({ code, surface, suffix })),
    ),
  )(
    '[fault: quota-perm-fail / torn-state] keeps a $code $surface write loud and reconciles the exact complete tree',
    async ({ code, suffix }) => {
      const base = new MemoryVfs();
      await base.mkdir('/project', { recursive: true });
      const reports: string[] = [];
      const faultVfs = adaptVfs(base, async (path, bytes) => {
        if (path.endsWith(suffix)) {
          throw Object.assign(new Error(`${code}: ${suffix} write refused`), { code });
        }
        await base.writeFile(path, bytes);
      });

      await expect(
        install(
          'fixture',
          '1.0.0',
          { esbuild: '^0.28.0' },
          {
            vfs: faultVfs,
            cwd: '/project',
            registry: await esbuildRegistry(),
            onSubstitution: (line) => reports.push(line),
          },
        ),
      ).rejects.toMatchObject({ code });
      expect(reports).toEqual([]);
      expect(await base.exists('/project/package-lock.json')).toBe(false);
      const partialTree = await snapshotTree(base, '/project');
      expect(partialTree['/package-lock.json']).toBeUndefined();

      await expect(
        install(
          'fixture',
          '1.0.0',
          { esbuild: '^0.28.0' },
          {
            vfs: base,
            cwd: '/project',
            registry: await esbuildRegistry(),
          },
        ),
      ).resolves.toMatchObject({ lockfile: { lockfileVersion: 3 } });
      expect(await snapshotTree(base, '/project')).toEqual(await exactEsbuildProjectTree());
    },
  );

  it('[fault: poisoned-cache / provenance-lie] refuses corrupt offline replay bytes and succeeds after exact repair', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/project', { recursive: true });
    const cache = new MemoryTarballCache();
    const source = await esbuildTarball();
    await install(
      'fixture',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/project',
        registry: await esbuildRegistry(),
        tarballCache: cache,
      },
    );
    await vfs.rm('/project/node_modules', { recursive: true });
    const corrupt = source.bytes.slice();
    corrupt[0]! ^= 0xff;
    cache.replace('esbuild-wasm', '0.28.0', source.integrity, corrupt);

    await expect(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: new RejectingRegistry(),
          tarballCache: cache,
        },
      ),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK' });
    expect(await vfs.exists('/project/node_modules')).toBe(false);

    cache.replace('esbuild-wasm', '0.28.0', source.integrity, source.bytes);
    await expect(
      install(
        'fixture',
        '1.0.0',
        { esbuild: '^0.28.0' },
        {
          vfs,
          cwd: '/project',
          registry: new RejectingRegistry(),
          tarballCache: cache,
        },
      ),
    ).resolves.toMatchObject({ lockfile: { lockfileVersion: 3 } });
    expect(await vfs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm')).toEqual(
      exactEsbuildWasm,
    );
  });
});

describe('shadow substitution lockfile provenance', () => {
  let synthetic: Lockfile;
  let registry: Lockfile;

  beforeAll(async () => {
    synthetic = await freshLockfile({ esbuild: '^0.28.0' }, await esbuildRegistry());
    registry = await freshLockfile({ lightningcss: '^1.32.0' }, await lightningRegistry());
  });

  it('loudly names the missing trace when only the per-entry marker survives', () => {
    const { rifty: _trace, ...withoutTrace } = structuredClone(synthetic);
    const entry = withoutTrace.packages['node_modules/esbuild'];
    if (!entry) throw new Error('fresh registry-twin lockfile entry missing');

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
  ] as const)('rejects registry materialization alias provenance drift: %s', (_label, tamper) => {
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

  it.each([
    [
      'missing esbuild acquisition entry',
      (lockfile: Lockfile) => {
        // biome-ignore lint/performance/noDelete: corruption fixture removes the exact entry.
        delete lockfile.packages['node_modules/esbuild-wasm'];
      },
    ],
    [
      'wrong esbuild acquisition version',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/esbuild-wasm'];
        if (entry) entry.version = '0.0.0';
      },
    ],
    [
      'wrong esbuild acquisition resolved URL',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/esbuild-wasm'];
        if (entry) entry.resolved = 'https://registry.test/forged.tgz';
      },
    ],
    [
      'wrong esbuild acquisition integrity',
      (lockfile: Lockfile) => {
        const entry = lockfile.packages['node_modules/esbuild-wasm'];
        if (entry) entry.integrity = 'sha512-forged';
      },
    ],
  ] as const)('rejects %s', (_label, tamper) => {
    const lockfile = structuredClone(synthetic);
    tamper(lockfile);
    expectShadowTraceDrift(lockfile);
  });

  it.each(['name', 'version', 'resolved', 'integrity'] as const)(
    'rejects esbuild trace acquisition %s drift',
    (field) => {
      const lockfile = structuredClone(synthetic);
      const fact = lockfile.rifty?.shadowSubstitutions.applied.find(
        ({ trigger }) => trigger.name === 'esbuild',
      );
      if (!fact) throw new Error('fresh esbuild trace fact missing');
      const acquisition = fact.acquisition as unknown as Record<string, unknown>;
      acquisition[field] = field === 'version' ? '0.0.0' : `forged-${field}`;
      expectShadowTraceDrift(lockfile);
    },
  );

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
