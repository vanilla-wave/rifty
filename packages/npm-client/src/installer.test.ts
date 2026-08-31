import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  makePackageTarball,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import type { TarballCache } from './tarball-cache.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

/**
 * Construct a `RegistryClient` whose network methods are overridden to read
 * from an in-memory map. We extend the real class so the structural type
 * (which has private fields under `RegistryClient`) lines up.
 */
class FakeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  private readonly distTags: Map<string, Record<string, string>>;
  private readonly onTarball: () => void;
  constructor(
    db: Map<string, Map<string, FakeRegistryEntry>>,
    distTags: Map<string, Record<string, string>> = new Map(),
    onTarball: () => void = () => {},
  ) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
    this.distTags = distTags;
    this.onTarball = onTarball;
  }
  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest, ...this.distTags.get(name) }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    this.onTarball();
    // tarballUrl format we use below: `fake://<name>/<version>`
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, encodedName, version] = match;
    const name = decodeURIComponent(encodedName ?? '');
    const entry = this.db.get(name)?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

function recordingVfs(vfs: MemoryVfs, calls: string[], armed: () => boolean): Vfs {
  return new Proxy(vfs, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        if (armed()) calls.push(String(property));
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function makeEntry(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
  manifestExtras: Partial<Omit<VersionManifest, 'name' | 'version' | 'dependencies' | 'dist'>> = {},
  files?: Record<string, string>,
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      dependencies,
      ...manifestExtras,
      dist: { tarball: `fake://${encodeURIComponent(name)}/${version}` },
    },
    tarball: files
      ? await makePackageTarballWithFiles(name, version, manifestExtras, files)
      : await makePackageTarball(name, version),
  };
}

async function makePackageTarballWithFiles(
  name: string,
  version: string,
  manifestExtras: Partial<Omit<VersionManifest, 'name' | 'version' | 'dependencies' | 'dist'>>,
  files: Record<string, string>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const packageJson = JSON.stringify({ name, version, ...manifestExtras });
  for (const [entry, body] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(body);
    chunks.push(buildHeader(`package/${entry}`, bytes.length), padToBlock(bytes));
  }
  return await gzip(concat(...chunks, TAR_TRAILER));
}

describe('install — lifecycle cancellation (ADR-0314)', () => {
  it('aborts a hung standard registry request with the caller reason before tree writes', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const observedRequest: { signal?: AbortSignal } = {};
    const registry = new RegistryClient({
      baseUrl: '/registry',
      maxRetries: 0,
      fetch: async (_url, init) => {
        if (init?.signal instanceof AbortSignal) observedRequest.signal = init.signal;
        markFetchStarted();
        return await new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    const reason = new Error('project closed during npm install');
    const installing = install(
      'root',
      '1.0.0',
      { kleur: '4.1.5' },
      {
        vfs,
        cwd: '/proj',
        registry,
        signal: controller.signal,
      },
    );

    await fetchStarted;
    controller.abort(reason);

    await expect(installing).rejects.toBe(reason);
    expect(observedRequest.signal?.aborted).toBe(true);
    expect(await vfs.exists('/proj/node_modules')).toBe(false);
    expect(await vfs.exists('/proj/package-lock.json')).toBe(false);
  });

  it('does not turn an Eddy abort into a standard-registry fallback', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(new Map());
    const packument = vi.spyOn(registry, 'getPackument');
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.stubGlobal('fetch', async () => {
      markFetchStarted();
      return await new Promise<Response>(() => {});
    });
    const controller = new AbortController();
    const reason = new Error('project closed during Eddy acquisition');
    try {
      const installing = install(
        'root',
        '1.0.0',
        { kleur: '4.1.5' },
        {
          vfs,
          cwd: '/proj',
          registry,
          resolverUrl: 'https://resolver.test/bundle',
          signal: controller.signal,
        },
      );
      await fetchStarted;
      controller.abort(reason);

      await expect(installing).rejects.toBe(reason);
      expect(packument).not.toHaveBeenCalled();
      expect(await vfs.exists('/proj/node_modules')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts a stalled Eddy prefetch wait without trying another Eddy or registry request', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(new Map());
    const packument = vi.spyOn(registry, 'getPackument');
    const resolverPrefetch = {
      take: () => new Promise<Response>(() => {}),
    };
    const fetch = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const reason = new Error('project closed during Eddy prefetch');
    try {
      const installing = install(
        'root',
        '1.0.0',
        { kleur: '4.1.5' },
        {
          vfs,
          cwd: '/proj',
          registry,
          resolverUrl: 'https://resolver.test/bundle',
          resolverPrefetch,
          signal: controller.signal,
        },
      );
      controller.abort(reason);

      await expect(installing).rejects.toBe(reason);
      expect(fetch).not.toHaveBeenCalled();
      expect(packument).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the caller reason when a linker VFS rejection races the abort', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('kleur', new Map([['4.1.5', await makeEntry('kleur', '4.1.5')]]));
    const backing = new MemoryVfs();
    await backing.mkdir('/proj', { recursive: true });
    const controller = new AbortController();
    const reason = new Error('project closed during node_modules creation');
    const vfs: Vfs = new Proxy(backing, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== 'mkdir' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (...args: readonly unknown[]) => {
          if (args[0] === '/proj/node_modules') {
            controller.abort(reason);
            throw new Error('node_modules creation failed');
          }
          return Reflect.apply(value, target, args);
        };
      },
    });

    await expect(
      install(
        'root',
        '1.0.0',
        { kleur: '4.1.5' },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(db),
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(reason);
  });

  it('[fault: torn-state] observes an abort parked in lock commit before reports or result', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('esbuild-wasm', new Map([['0.28.0', await makeEntry('esbuild-wasm', '0.28.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const writeFile = vfs.writeFile.bind(vfs);
    let parkLock = true;
    const write = vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (parkLock && path === '/proj/package-lock.json') {
        parkLock = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      await writeFile(path, data);
    });
    const controller = new AbortController();
    const reason = new DOMException('project closed during package-lock commit', 'AbortError');
    const reports: string[] = [];
    const installing = install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(db),
        signal: controller.signal,
        onSubstitution: (line) => reports.push(line),
      },
    );

    await writeStarted.promise;
    controller.abort(reason);
    releaseWrite.resolve();
    await expect(installing).rejects.toBe(reason);
    expect.soft(reports).toEqual([]);
    expect.soft(await vfs.exists('/proj/package-lock.json')).toBe(true);

    write.mockRestore();
    const result = await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(db),
        onSubstitution: (line) => reports.push(line),
      },
    );
    expect.soft(result.lockfile.packages['node_modules/esbuild']?.bin).toEqual({
      esbuild: 'bin/esbuild',
    });
    expect(reports).toEqual([
      'npm: esbuild@^0.28.0 → esbuild-wasm@0.28.0 (substituted from shadow registry, ADR-0051)',
      'npm: esbuild@^0.28.0 materialized from shadow registry (rifty.shadow-substitution.esbuild.v2)',
    ]);
  });
});

describe('install — package ingress preflight (ADR-0261)', () => {
  it('rejects a mixed resolved traversal path before any post-acquisition VFS call', async () => {
    const name = '@scope/../../../outside/node_modules/bad-cli';
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('good', new Map([['1.0.0', await makeEntry('good', '1.0.0')]]));
    db.set(name, new Map([['1.0.0', await makeEntry(name, '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    let armed = false;
    const vfsCalls: string[] = [];
    const observedVfs = recordingVfs(vfs, vfsCalls, () => armed);
    const cacheEntries = new Map<string, Uint8Array>();
    const tarballCache: TarballCache = {
      async get(packageName, version, integrity) {
        return cacheEntries.get(`${packageName}\0${version}\0${integrity}`)?.slice() ?? null;
      },
      async put(packageName, version, integrity, bytes) {
        cacheEntries.set(`${packageName}\0${version}\0${integrity}`, bytes.slice());
        return `memory:${packageName}@${version}`;
      },
    };

    await expect(
      install(
        'root',
        '1.0.0',
        { good: '1.0.0', [name]: '1.0.0' },
        {
          vfs: observedVfs,
          cwd: '/proj',
          registry: new FakeRegistry(db, new Map(), () => {
            armed = true;
          }),
          tarballCache,
          assertPortablePaths: () => {},
        },
      ),
    ).rejects.toMatchObject({
      code: 'EINVALIDPACKAGETAR',
      path: `node_modules/${name}`,
    });

    expect(vfsCalls).toEqual([]);
    expect(await vfs.exists('/proj/node_modules')).toBe(false);
    expect(await vfs.exists('/outside/node_modules/bad-cli')).toBe(false);
    expect(await vfs.exists('/proj/package-lock.json')).toBe(false);
  });

  it('rejects a tar entry that escapes its package before linking any bytes', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'good',
      new Map([['1.0.0', await makeEntry('good', '1.0.0', {}, {}, { 'ok.js': 'ok' })]]),
    );
    db.set(
      'evil',
      new Map([
        [
          '1.0.0',
          await makeEntry('evil', '1.0.0', {}, {}, { '../.rifty-install-stamp.json': 'forged' }),
        ],
      ]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await expect(
      install(
        'root',
        '1.0.0',
        { good: '1.0.0', evil: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(db),
        },
      ),
    ).rejects.toMatchObject({ code: 'EINVALIDPACKAGETAR' });

    expect(await vfs.exists('/proj/node_modules')).toBe(false);
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it.each(['root', 'transitive', 'subtree-child'] as const)(
    'keeps structural tar-path corruption loud across a %s optional boundary',
    async (boundary) => {
      const db = new Map<string, Map<string, FakeRegistryEntry>>();
      db.set(
        'evil',
        new Map([
          [
            '1.0.0',
            await makeEntry('evil', '1.0.0', {}, {}, { '../.rifty-install-stamp.json': 'forged' }),
          ],
        ]),
      );
      if (boundary !== 'root') {
        const optionalName = boundary === 'transitive' ? 'evil' : 'optional-parent';
        db.set(
          'parent',
          new Map([
            [
              '1.0.0',
              await makeEntry(
                'parent',
                '1.0.0',
                {},
                { optionalDependencies: { [optionalName]: '1.0.0' } },
              ),
            ],
          ]),
        );
        if (boundary === 'subtree-child') {
          db.set(
            'optional-parent',
            new Map([['1.0.0', await makeEntry('optional-parent', '1.0.0', { evil: '1.0.0' })]]),
          );
        }
      }
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });
      if (boundary === 'root') {
        await vfs.writeFile(
          '/proj/package.json',
          JSON.stringify({
            name: 'root',
            version: '1.0.0',
            optionalDependencies: { evil: '1.0.0' },
          }),
        );
      }

      const installing =
        boundary === 'root'
          ? install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) })
          : install(
              'root',
              '1.0.0',
              { parent: '1.0.0' },
              { vfs, cwd: '/proj', registry: new FakeRegistry(db) },
            );

      await expect(installing).rejects.toMatchObject({ code: 'EINVALIDPACKAGETAR' });
      expect(await vfs.exists('/proj/node_modules')).toBe(false);
    },
  );

  it('preflights every actual target through the host policy before the first link write', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'good',
      new Map([['1.0.0', await makeEntry('good', '1.0.0', {}, {}, { 'ok.js': 'ok' })]]),
    );
    db.set(
      'evil',
      new Map([
        [
          '1.0.0',
          await makeEntry(
            'evil',
            '1.0.0',
            {},
            {},
            { 'node_modules/.rifty-install-stamp.json': 'forged' },
          ),
        ],
      ]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const preflights: string[][] = [];
    const options = {
      vfs,
      cwd: '/proj',
      registry: new FakeRegistry(db),
      assertPortablePaths(paths: readonly string[]): void {
        preflights.push([...paths]);
        const reserved = paths.find((path) =>
          path.endsWith('/node_modules/.rifty-install-stamp.json'),
        );
        if (reserved) {
          throw Object.assign(new Error(`EPERM: reserved install claim ${reserved}`), {
            code: 'EPERM',
          });
        }
      },
    };

    await expect(
      install('root', '1.0.0', { good: '1.0.0', evil: '1.0.0' }, options),
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(preflights).toHaveLength(1);
    expect(preflights[0]).toContain('/proj/node_modules/good/ok.js');
    expect(preflights[0]).toContain(
      '/proj/node_modules/evil/node_modules/.rifty-install-stamp.json',
    );
    expect(await vfs.exists('/proj/node_modules')).toBe(false);
  });

  it('contains and preflights package targets when the install root is /', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'good',
      new Map([['1.0.0', await makeEntry('good', '1.0.0', {}, {}, { 'ok.js': 'ok' })]]),
    );
    const vfs = new MemoryVfs();
    const preflights: string[][] = [];

    await install(
      'root',
      '1.0.0',
      { good: '1.0.0' },
      {
        vfs,
        cwd: '/',
        registry: new FakeRegistry(db),
        assertPortablePaths(paths): void {
          preflights.push([...paths]);
        },
      },
    );

    expect(preflights).toHaveLength(1);
    expect(preflights[0]).toContain('/node_modules/good/ok.js');
    expect(await vfs.readFileText('/node_modules/good/ok.js')).toBe('ok');
  });
});

describe('install — package.json defaults', () => {
  it('reads dependencies, devDependencies, optionalDependencies, overrides, name, and version from package.json when called with only options', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('dep', new Map([['1.0.0', await makeEntry('dep', '1.0.0')]]));
    db.set('dev', new Map([['1.0.0', await makeEntry('dev', '1.0.0')]]));
    db.set('opt', new Map([['1.0.0', await makeEntry('opt', '1.0.0')]]));
    db.set('pure', new Map([['1.0.0', await makeEntry('pure', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '2.3.4',
        dependencies: { dep: '^1.0.0', native: '1.0.0' },
        devDependencies: { dev: '1.0.0' },
        optionalDependencies: { opt: '1.0.0' },
        overrides: { native: 'pure@1.0.0' },
        engines: { node: '>=22' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.lockfile.name).toBe('app');
    expect(result.lockfile.version).toBe('2.3.4');
    expect(result.packages.map((p) => p.name).sort()).toEqual(['dep', 'dev', 'opt', 'pure']);
    expect(await vfs.exists('/proj/node_modules/dep/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/dev/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/opt/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/pure/package.json')).toBe(true);
  });

  it('writes declared root dependency maps instead of the hoisted transitive closure', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('direct', new Map([['1.0.0', await makeEntry('direct', '1.0.0', { leaf: '^1.0.0' })]]));
    db.set('leaf', new Map([['1.0.0', await makeEntry('leaf', '1.0.0')]]));
    db.set('dev', new Map([['1.0.0', await makeEntry('dev', '1.0.0')]]));
    db.set('optional', new Map([['1.0.0', await makeEntry('optional', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '2.3.4',
        dependencies: { direct: '^1.0.0' },
        devDependencies: { dev: '~1.0.0' },
        optionalDependencies: { optional: '1.x' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.lockfile.packages['']).toEqual({
      version: '2.3.4',
      dependencies: { direct: '^1.0.0' },
      devDependencies: { dev: '~1.0.0' },
      optionalDependencies: { optional: '1.x' },
    });
    expect(result.lockfile.packages['node_modules/leaf']).toBeDefined();
  });

  it('keeps root optionalDependencies non-fatal when package.json drives install', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('dep', new Map([['1.0.0', await makeEntry('dep', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { dep: '1.0.0' },
        optionalDependencies: { missing: '1.0.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.packages.map((p) => p.name)).toEqual(['dep']);
    expect(await vfs.exists('/proj/node_modules/dep/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/missing/package.json')).toBe(false);
  });

  it('treats a root optionalDependency as optional even when dependencies repeats the same name', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('dep', new Map([['1.0.0', await makeEntry('dep', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { dep: '1.0.0', duplicate: '1.0.0' },
        optionalDependencies: { duplicate: '1.0.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.packages.map((p) => p.name)).toEqual(['dep']);
    expect(await vfs.exists('/proj/node_modules/duplicate/package.json')).toBe(false);
  });

  it('throws a named NotImplementedError for package.json non-registry dependency specs', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { local: 'file:../local' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.dependency-spec.file');
  });

  it('throws a named NotImplementedError for package.json GitHub shorthand specs', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { express: 'expressjs/express' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.dependency-spec.git');
  });

  it('throws a named NotImplementedError for package.json GitHub shorthand package names', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { 'expressjs/express': 'latest' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.dependency-spec.git');
  });

  it('throws a named NotImplementedError for package.json path-like local specs', async () => {
    for (const spec of ['.', '..', '../local']) {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });
      await vfs.writeFile(
        '/proj/package.json',
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { local: spec },
        }),
      );

      let caught: unknown;
      try {
        await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NotImplementedError);
      expect((caught as NotImplementedError).feature).toBe('npm-client.dependency-spec.file');
    }
  });

  it('throws for non-registry package.json specs before root overrides can hide them', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('dep', new Map([['1.0.0', await makeEntry('dep', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { local: 'file:../local' },
        overrides: { local: 'dep@1.0.0' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.dependency-spec.file');
  });

  it('throws a named NotImplementedError for registry package lifecycle scripts', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'with-script',
      new Map([
        [
          '1.0.0',
          await makeEntry(
            'with-script',
            '1.0.0',
            {},
            { scripts: { postinstall: 'node build.js' } },
          ),
        ],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { 'with-script': '1.0.0' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.lifecycle.postinstall');
  });

  it('still rejects root prepare scripts when package.json drives install', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        scripts: { prepare: 'node build.js' },
      }),
    );

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.lifecycle.prepare');
  });

  it('ignores registry package prepare scripts during tarball installs', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'with-prepare',
      new Map([
        [
          '1.0.0',
          await makeEntry(
            'with-prepare',
            '1.0.0',
            {},
            { scripts: { prepare: 'node scripts/prepare.js' } },
          ),
        ],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { 'with-prepare': '1.0.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.packages.map((p) => p.name)).toEqual(['with-prepare']);
    expect(await vfs.exists('/proj/node_modules/with-prepare/package.json')).toBe(true);
  });

  it('materializes the esbuild alias beside its exact registry twin', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('esbuild-wasm', new Map([['0.28.0', await makeEntry('esbuild-wasm', '0.28.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { esbuild: '^0.28.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.packages.map((p) => `${p.name}@${p.version}`)).toEqual(['esbuild-wasm@0.28.0']);
    expect(await vfs.exists('/proj/node_modules/esbuild/package.json')).toBe(true);
    expect(await vfs.readFileText('/proj/node_modules/esbuild/lib/main.cjs')).toContain(
      '__rifty?.esbuild',
    );
    expect(result.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });
    expect(result.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
  });

  it('replays a transitive esbuild registry twin on the lockfile fast path', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('host', new Map([['1.0.0', await makeEntry('host', '1.0.0', { esbuild: '^0.28.0' })]]));
    db.set('esbuild-wasm', new Map([['0.28.0', await makeEntry('esbuild-wasm', '0.28.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { host: '1.0.0' } }),
    );

    const first = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    expect(first.lockfile.packages['node_modules/esbuild']).toMatchObject({
      version: '0.28.0',
      riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
    });

    const second = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    expect(second.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual([
      'esbuild-wasm@0.28.0',
      'host@1.0.0',
    ]);
    expect(second.lockfile.rifty?.shadowSubstitutions.applied).toHaveLength(1);
  });

  it('re-resolves an override redirect that no longer admits the locked target version', async () => {
    // An override range is current package policy. If foo → bar@1.0.0 becomes
    // foo → bar@2.0.0, ADR-0023 treats that edge as a metadata frontier rather
    // than replaying the stale target or requiring lockfile deletion.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('host', new Map([['1.0.0', await makeEntry('host', '1.0.0', { foo: '1.0.0' })]]));
    db.set(
      'bar',
      new Map([
        ['1.0.0', await makeEntry('bar', '1.0.0')],
        ['2.0.0', await makeEntry('bar', '2.0.0')],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const pkg = (barTarget: string) =>
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { host: '1.0.0' },
        overrides: { foo: barTarget },
      });

    // First install: override foo → bar@1.0.0 → lockfile pins node_modules/bar@1.0.0.
    await vfs.writeFile('/proj/package.json', pkg('bar@1.0.0'));
    const first = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    expect(first.lockfile.packages['node_modules/bar']?.version).toBe('1.0.0');

    // Second install: only the changed override edge re-resolves.
    await vfs.writeFile('/proj/package.json', pkg('bar@2.0.0'));
    const second = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });
    expect(second.lockfile.packages['node_modules/bar']?.version).toBe('2.0.0');
    expect(second.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual([
      'bar@2.0.0',
      'host@1.0.0',
    ]);
  });

  it('throws a deliberate error for malformed root package.json shapes', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile('/proj/package.json', '[]');

    let caught: unknown;
    try {
      await install({ vfs, cwd: '/proj', registry: new FakeRegistry(new Map()) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('package.json');
    expect((caught as Error).message).toContain('object');
  });

  it('propagates package bin metadata into node_modules/.bin and package-lock replay', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'cli',
      new Map([
        [
          '1.0.0',
          await makeEntry(
            'cli',
            '1.0.0',
            {},
            { bin: { cli: 'bin/cli.js' } },
            { 'bin/cli.js': '#!/usr/bin/env node\nconsole.log("cli");\n' },
          ),
        ],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { cli: '1.0.0' } }),
    );

    const firstRegistry = new FakeRegistry(db);
    const first = await install({ vfs, cwd: '/proj', registry: firstRegistry });

    expect(first.lockfile.packages['node_modules/cli']?.bin).toEqual({ cli: 'bin/cli.js' });
    expect(await vfs.readFileText('/proj/node_modules/.bin/cli')).toBe(
      "#!/usr/bin/env node\nimport('../cli/bin/cli.js');\n",
    );

    await vfs.rm('/proj/node_modules/.bin/cli');
    const second = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(second.lockfile.packages['node_modules/cli']?.bin).toEqual({ cli: 'bin/cli.js' });
    expect(await vfs.readFileText('/proj/node_modules/.bin/cli')).toBe(
      "#!/usr/bin/env node\nimport('../cli/bin/cli.js');\n",
    );
  });
});

describe('install — idempotent lockfile write', () => {
  it('does not rewrite package-lock.json byte-for-byte across two installs (mtime stable)', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0')]]));

    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // First install: writes lockfile from scratch.
    await install('root', '1.0.0', { a: '1.0.0' }, { vfs, cwd: '/proj', registry });
    const lockfilePath = '/proj/package-lock.json';
    const firstBytes = await vfs.readFile(lockfilePath);
    const firstStat = await vfs.stat(lockfilePath);

    // Force a measurable mtime delta between writes so any rewrite is visible.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    // Second install: same inputs. The fast path should detect cache-hit and
    // avoid rewriting. Even if it goes through the live-resolve branch, the
    // diff-before-write guard must skip the writeFile.
    await install('root', '1.0.0', { a: '1.0.0' }, { vfs, cwd: '/proj', registry });
    const secondBytes = await vfs.readFile(lockfilePath);
    const secondStat = await vfs.stat(lockfilePath);

    expect(secondBytes).toEqual(firstBytes);
    expect(secondStat.mtime).toBe(firstStat.mtime);
  });

  it('does not bump mtime when the lockfile already matches what live-resolve would produce', async () => {
    // Pre-seed a project with the canonical lockfile (computed by running
    // install once on a separate vfs). The target vfs has no tarball cache,
    // so the fast path's `allCached` is false and falls through to a rewrite.
    // After diff-before-write, that rewrite is skipped because bytes match.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0')]]));

    const registry = new FakeRegistry(db);
    const seedVfs = new MemoryVfs();
    await seedVfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { a: '1.0.0' }, { vfs: seedVfs, cwd: '/proj', registry });
    const canonical = await seedVfs.readFile('/proj/package-lock.json');

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const lockfilePath = '/proj/package-lock.json';
    await vfs.writeFile(lockfilePath, canonical);
    const beforeStat = await vfs.stat(lockfilePath);

    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    await install('root', '1.0.0', { a: '1.0.0' }, { vfs, cwd: '/proj', registry });

    const afterBytes = await vfs.readFile(lockfilePath);
    const afterStat = await vfs.stat(lockfilePath);
    // Bytes unchanged.
    expect(afterBytes).toEqual(canonical);
    // And mtime stable — diff-before-write skipped the rewrite.
    expect(afterStat.mtime).toBe(beforeStat.mtime);
  });
});

describe('install — explicit range never falls through to dist-tags.latest', () => {
  it('throws "No matching version" when an explicit range matches no published version', async () => {
    // Regression for the 2026-05-27 live-express experiment: the installer
    // used to silently fall back to `dist-tags.latest` whenever
    // `pickBestVersion` returned null. With the partial-range semver fix
    // already in place, the pickBestVersion path almost always succeeds —
    // but if it ever doesn't, the operator must see "no matching version"
    // rather than an unannounced major version jump.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    // Only 4.x available; user asks for ^5 — must fail loud, not return 4.x.
    db.set(
      'express',
      new Map([
        ['4.17.1', await makeEntry('express', '4.17.1')],
        ['4.21.0', await makeEntry('express', '4.21.0')],
      ]),
    );

    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    let caught: unknown;
    try {
      await install('root', '1.0.0', { express: '^5' }, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('No matching version for express@^5');
  });

  it('still uses dist-tags.latest when the range is `*` (unconstrained)', async () => {
    // The fallback path is intact for the genuinely unconstrained case — only
    // explicit ranges are protected. We use `*` here; in practice that's
    // mostly relevant for `npm install <name>` with no explicit version.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0')]]));
    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install('root', '1.0.0', { a: '*' }, { vfs, cwd: '/proj', registry });
    expect(result.packages[0]?.name).toBe('a');
    expect(result.packages[0]?.version).toBe('1.0.0');
  });

  it('prefers dist-tags.latest over a higher prerelease for unconstrained installs', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'prettier',
      new Map([
        ['3.8.3', await makeEntry('prettier', '3.8.3')],
        ['4.0.0-alpha.13', await makeEntry('prettier', '4.0.0-alpha.13')],
      ]),
    );
    const registry = new FakeRegistry(
      db,
      new Map([['prettier', { latest: '3.8.3', next: '4.0.0-alpha.13' }]]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { prettier: '*' },
      { vfs, cwd: '/proj', registry },
    );
    expect(result.packages.find((p) => p.name === 'prettier')?.version).toBe('3.8.3');
  });
});

describe('install — nested install for conflicting transitive versions (M11)', () => {
  // Pre-M11 (flat-only linker) this scenario threw EVERSIONCONFLICT and the
  // install died. The live express experiment on 2026-05-27 hit exactly this
  // shape on `ms: 2.1.3 vs 2.0.0` and pinned M11 nested install as a
  // prerequisite for M9 closure. The contract below documents the M11
  // semantics: direct requests reserve flat identities first; among descendant
  // requests, first-seen wins and later conflicts nest under their parent.
  it.each([
    ['parent first', { parent: '1.0.0', shared: '2.0.0' }],
    ['direct dependency first', { shared: '2.0.0', parent: '1.0.0' }],
  ])(
    '[fault: observable-order] reserves the root-visible slot for a direct dependency (%s)',
    async (_label, request) => {
      const db = new Map<string, Map<string, FakeRegistryEntry>>();
      db.set(
        'parent',
        new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]),
      );
      db.set(
        'shared',
        new Map([
          ['1.0.0', await makeEntry('shared', '1.0.0')],
          ['2.0.0', await makeEntry('shared', '2.0.0')],
        ]),
      );
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });

      const result = await install('root', '1.0.0', request, {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(db),
      });

      expect(result.lockfile.packages['node_modules/shared']?.version).toBe('2.0.0');
      expect(result.lockfile.packages['node_modules/parent/node_modules/shared']?.version).toBe(
        '1.0.0',
      );
      expect(result.lockfile.packages['/node_modules/shared']).toBeUndefined();
    },
  );

  it('dedupes a direct root and an earlier transitive request for the same identity', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { parent: '1.0.0', shared: '1.0.0' },
      { vfs, cwd: '/proj', registry: new FakeRegistry(db) },
    );

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('1.0.0');
    expect(result.lockfile.packages['node_modules/parent/node_modules/shared']).toBeUndefined();
    expect(result.packages.filter((pkg) => pkg.name === 'shared')).toHaveLength(1);
  });

  it('does not reserve a root slot for an optional direct dependency whose acquisition fails', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]));
    db.set(
      'shared',
      new Map([
        ['1.0.0', await makeEntry('shared', '1.0.0')],
        ['2.0.0', await makeEntry('shared', '2.0.0')],
      ]),
    );
    class FailingOptionalRegistry extends FakeRegistry {
      override async getTarball(tarballUrl: string): Promise<Uint8Array> {
        if (tarballUrl === 'fake://shared/2.0.0') {
          throw new Error('optional shared@2 acquisition failed');
        }
        return await super.getTarball(tarballUrl);
      }
    }
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: { parent: '1.0.0' },
        optionalDependencies: { shared: '2.0.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FailingOptionalRegistry(db) });

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('1.0.0');
    expect(result.lockfile.packages['node_modules/parent/node_modules/shared']).toBeUndefined();
  });

  it('[fault: torn-state] does not reserve a root slot for an optional direct dependency whose archive is invalid', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]));
    const invalidOptional = await makeEntry('shared', '2.0.0');
    invalidOptional.tarball = new Uint8Array([1, 2, 3]);
    db.set(
      'shared',
      new Map([
        ['1.0.0', await makeEntry('shared', '1.0.0')],
        ['2.0.0', invalidOptional],
      ]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: { parent: '1.0.0' },
        optionalDependencies: { shared: '2.0.0' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('1.0.0');
    expect(result.lockfile.packages['node_modules/parent/node_modules/shared']).toBeUndefined();
  });

  it('[fault: torn-state] does not let a failed optional materialization suppress a later required visit', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'optional-parent',
      new Map([
        [
          '1.0.0',
          await makeEntry(
            'optional-parent',
            '1.0.0',
            {},
            { optionalDependencies: { shared: '1.0.0' } },
          ),
        ],
      ]),
    );
    db.set(
      'required-parent',
      new Map([['1.0.0', await makeEntry('required-parent', '1.0.0', { shared: '1.0.0' })]]),
    );
    const invalidShared = await makeEntry('shared', '1.0.0');
    invalidShared.tarball = new Uint8Array([1, 2, 3]);
    db.set('shared', new Map([['1.0.0', invalidShared]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        install(
          'root',
          '1.0.0',
          { 'optional-parent': '1.0.0', 'required-parent': '1.0.0' },
          { vfs, cwd: '/proj', registry: new FakeRegistry(db) },
        ),
      ).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it('nests the second version under the requesting parent (simple diamond)', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0', { c: '1.0.0' })]]));
    db.set('b', new Map([['1.0.0', await makeEntry('b', '1.0.0', { c: '2.0.0' })]]));
    db.set(
      'c',
      new Map([
        ['1.0.0', await makeEntry('c', '1.0.0')],
        ['2.0.0', await makeEntry('c', '2.0.0')],
      ]),
    );

    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { a: '1.0.0', b: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    // Both placements made it to disk. `a`'s `c@1.0.0` wins the flat slot
    // because `a` is visited first; `b`'s `c@2.0.0` gets nested under `b`.
    expect(await vfs.exists('/proj/node_modules/c/package.json')).toBe(true);
    const flat = JSON.parse(await vfs.readFileText('/proj/node_modules/c/package.json')) as {
      version: string;
    };
    expect(flat.version).toBe('1.0.0');

    expect(await vfs.exists('/proj/node_modules/b/node_modules/c/package.json')).toBe(true);
    const nested = JSON.parse(
      await vfs.readFileText('/proj/node_modules/b/node_modules/c/package.json'),
    ) as { version: string };
    expect(nested.version).toBe('2.0.0');

    // Lockfile records the actual install paths (npm v3 shape — keys ARE the
    // path strings, not just names).
    const lockfile = result.lockfile;
    expect(lockfile.packages['node_modules/c']?.version).toBe('1.0.0');
    expect(lockfile.packages['node_modules/b/node_modules/c']?.version).toBe('2.0.0');

    // No EVERSIONCONFLICT was thrown and `conflicts` stays empty (it has been
    // an empty-array shape since A-031; nested install keeps the same).
    expect(result.conflicts).toEqual([]);
  });

  it('mirrors the live express diamond (`ms 2.1.3` flat, `ms 2.0.0` nested under finalhandler)', async () => {
    // Exact shape the 2026-05-27 live-registry run reported.
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'express',
      new Map([
        [
          '4.21.0',
          await makeEntry('express', '4.21.0', {
            debug: '^2.6.9',
            finalhandler: '^1.3.0',
          }),
        ],
      ]),
    );
    db.set('debug', new Map([['2.6.9', await makeEntry('debug', '2.6.9', { ms: '^2.1.0' })]]));
    db.set(
      'finalhandler',
      new Map([['1.3.0', await makeEntry('finalhandler', '1.3.0', { ms: '2.0.0' })]]),
    );
    db.set(
      'ms',
      new Map([
        ['2.0.0', await makeEntry('ms', '2.0.0')],
        ['2.1.3', await makeEntry('ms', '2.1.3')],
      ]),
    );

    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { express: '^4' },
      { vfs, cwd: '/proj', registry },
    );

    // Top-level layout: express + debug + finalhandler + the flat-hoisted ms.
    expect(await vfs.exists('/proj/node_modules/express/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/finalhandler/package.json')).toBe(true);

    // `ms@2.1.3` (debug's request) wins the flat slot because debug is
    // visited first under express's dep order.
    const flatMs = JSON.parse(await vfs.readFileText('/proj/node_modules/ms/package.json')) as {
      version: string;
    };
    expect(flatMs.version).toBe('2.1.3');

    // `ms@2.0.0` (finalhandler's request) gets nested.
    expect(await vfs.exists('/proj/node_modules/finalhandler/node_modules/ms/package.json')).toBe(
      true,
    );
    const nestedMs = JSON.parse(
      await vfs.readFileText('/proj/node_modules/finalhandler/node_modules/ms/package.json'),
    ) as { version: string };
    expect(nestedMs.version).toBe('2.0.0');

    // Lockfile keys carry the path; both ms entries are distinct.
    expect(result.lockfile.packages['node_modules/ms']?.version).toBe('2.1.3');
    expect(result.lockfile.packages['node_modules/finalhandler/node_modules/ms']?.version).toBe(
      '2.0.0',
    );
  });
});

describe('install — onPackage progress hook (ADR-0134)', () => {
  async function diamondDb(): Promise<Map<string, Map<string, FakeRegistryEntry>>> {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('a', new Map([['1.0.0', await makeEntry('a', '1.0.0', { b: '^1.0.0' })]]));
    db.set('b', new Map([['1.2.0', await makeEntry('b', '1.2.0')]]));
    return db;
  }

  it('fires once per unique (name, version) with cacheHit=false on a cold live install', async () => {
    const db = await diamondDb();
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const events: { name: string; version: string; cacheHit: boolean }[] = [];

    await install(
      'root',
      '1.0.0',
      { a: '^1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(db),
        onPackage: (event) => events.push(event),
      },
    );

    expect(events.map((e) => `${e.name}@${e.version}`).sort()).toEqual(['a@1.0.0', 'b@1.2.0']);
    expect(events.every((e) => e.cacheHit === false)).toBe(true);
  });

  it('fires on the lockfile fast path with cacheHit=true once the tarball cache is warm', async () => {
    const db = await diamondDb();
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db);
    await install('root', '1.0.0', { a: '^1.0.0' }, { vfs, cwd: '/proj', registry });

    const events: { name: string; version: string; cacheHit: boolean }[] = [];
    await install(
      'root',
      '1.0.0',
      { a: '^1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onPackage: (event) => events.push(event),
      },
    );

    expect(events.map((e) => `${e.name}@${e.version}`).sort()).toEqual(['a@1.0.0', 'b@1.2.0']);
    expect(events.every((e) => e.cacheHit === true)).toBe(true);
  });

  it('returns exact metadata/registry then lockfile/cache acquisition provenance', async () => {
    const db = await diamondDb();
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db);

    const cold = await install('root', '1.0.0', { a: '^1.0.0' }, { vfs, cwd: '/proj', registry });
    expect(cold.provenance).toEqual({
      resolution: 'metadata',
      packages: [
        { name: 'a', version: '1.0.0', transport: 'registry' },
        { name: 'b', version: '1.2.0', transport: 'registry' },
      ],
    });

    const warm = await install('root', '1.0.0', { a: '^1.0.0' }, { vfs, cwd: '/proj', registry });
    expect(warm.provenance).toEqual({
      resolution: 'lockfile',
      packages: [
        { name: 'a', version: '1.0.0', transport: 'cache' },
        { name: 'b', version: '1.2.0', transport: 'cache' },
      ],
    });
  });

  it('does not let the progress hook rewrite acquisition provenance', async () => {
    const db = await diamondDb();
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { a: '^1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(db),
        onPackage: (event) => {
          (event as { cacheHit: boolean }).cacheHit = true;
        },
      },
    );

    expect(result.provenance).toEqual({
      resolution: 'metadata',
      packages: [
        { name: 'a', version: '1.0.0', transport: 'registry' },
        { name: 'b', version: '1.2.0', transport: 'registry' },
      ],
    });
  });

  it('preserves Eddy and validating-registry causes when fallback also fails', async () => {
    const eddyFailure = new Error('eddy connection refused');
    const registryFailure = new Error('registry unavailable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw eddyFailure;
      }),
    );
    class FailingRegistry extends FakeRegistry {
      override async getPackument(): Promise<Packument> {
        throw registryFailure;
      }
    }
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });
      let caught: unknown;
      try {
        await install(
          'root',
          '1.0.0',
          { missing: '1.0.0' },
          {
            vfs,
            cwd: '/proj',
            registry: new FailingRegistry(new Map()),
            resolverUrl: 'https://eddy.invalid/resolve',
          },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([eddyFailure, registryFailure]);
    } finally {
      console.warn = originalWarn;
      vi.unstubAllGlobals();
    }
  });

  it('a throwing hook is warned and does not abort the install', async () => {
    const db = await diamondDb();
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      const result = await install(
        'root',
        '1.0.0',
        { a: '^1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(db),
          onPackage: () => {
            throw new Error('sink failed');
          },
        },
      );
      expect(result.packages.map((p) => p.name).sort()).toEqual(['a', 'b']);
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.some((w) => w.includes('onPackage'))).toBe(true);
    expect(await vfs.exists('/proj/node_modules/a/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/b/package.json')).toBe(true);
  });

  it('does not fire for a skipped optional dependency whose fetch fails', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    const broken = await makeEntry('broken', '1.0.0');
    broken.manifest.dist = { tarball: 'fake://missing/9.9.9' };
    db.set(
      'host',
      new Map([
        [
          '1.0.0',
          await makeEntry('host', '1.0.0', {}, { optionalDependencies: { broken: '1.0.0' } }),
        ],
      ]),
    );
    db.set('broken', new Map([['1.0.0', broken]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const events: { name: string }[] = [];
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await install(
        'root',
        '1.0.0',
        { host: '^1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry: new FakeRegistry(db),
          onPackage: (event) => events.push(event),
        },
      );
    } finally {
      console.warn = originalWarn;
    }
    expect(events.map((e) => e.name)).toEqual(['host']);
  });
});
