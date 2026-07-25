import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

class FakeRegistry extends RegistryClient {
  constructor(
    private readonly db: Map<string, Map<string, FakeRegistryEntry>>,
    private readonly missing: Set<string> = new Set(),
  ) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
  }
  override async getPackument(name: string): Promise<Packument> {
    if (this.missing.has(name)) throw new Error(`registry: 404 ${name}`);
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, name, version] = match;
    if (this.missing.has(name ?? '')) throw new Error(`registry: 404 ${name}`);
    const entry = this.db.get(name ?? '')?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function makeEntry(
  name: string,
  version: string,
  extra: Partial<VersionManifest> = {},
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      dependencies: {},
      dist: { tarball: `fake://${name}/${version}` },
      ...extra,
    },
    tarball: await makePackageTarball(name, version),
  };
}

describe('install — peerDependencies', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('warns once when a peer dep is required by a package but not installed', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'plugin',
      new Map([
        [
          '1.0.0',
          await makeEntry('plugin', '1.0.0', {
            peerDependencies: { host: '^2.0.0' },
          }),
        ],
      ]),
    );
    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await install('root', '1.0.0', { plugin: '1.0.0' }, { vfs, cwd: '/proj', registry });

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('peer dependency');
    expect(msg).toContain('host');
    expect(msg).toContain('^2.0.0');
    expect(msg).toContain('plugin');
  });

  it('does not warn when a peer dep is satisfied by another installed package', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'plugin',
      new Map([
        [
          '1.0.0',
          await makeEntry('plugin', '1.0.0', {
            peerDependencies: { host: '^2.0.0' },
          }),
        ],
      ]),
    );
    db.set('host', new Map([['2.5.0', await makeEntry('host', '2.5.0')]]));
    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await install(
      'root',
      '1.0.0',
      { plugin: '1.0.0', host: '^2.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('install — optionalDependencies', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('installs an optional dep when registry has it', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'pkg',
      new Map([
        [
          '1.0.0',
          await makeEntry('pkg', '1.0.0', {
            optionalDependencies: { 'opt-ok': '1.0.0' },
          }),
        ],
      ]),
    );
    db.set('opt-ok', new Map([['1.0.0', await makeEntry('opt-ok', '1.0.0')]]));
    const registry = new FakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { pkg: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('opt-ok');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and skips when an optional dep cannot be resolved (registry 404)', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'pkg',
      new Map([
        [
          '1.0.0',
          await makeEntry('pkg', '1.0.0', {
            optionalDependencies: { 'opt-missing': '1.0.0' },
          }),
        ],
      ]),
    );
    const registry = new FakeRegistry(db, new Set(['opt-missing']));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { pkg: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );
    const names = result.packages.map((p) => p.name);
    expect(names).toContain('pkg');
    expect(names).not.toContain('opt-missing');
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('optional');
    expect(msg).toContain('opt-missing');
  });

  it('does not classify caller cancellation as an optional-dependency skip', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({
        name: 'root',
        version: '1.0.0',
        optionalDependencies: { opt: '1.0.0' },
      })}\n`,
    );
    let markTarballStarted!: () => void;
    const tarballStarted = new Promise<void>((resolve) => {
      markTarballStarted = resolve;
    });
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      fetch: async (url, init) => {
        if (String(url).endsWith('/opt')) {
          return new Response(
            JSON.stringify({
              name: 'opt',
              'dist-tags': { latest: '1.0.0' },
              versions: {
                '1.0.0': {
                  name: 'opt',
                  version: '1.0.0',
                  dependencies: {},
                  dist: { tarball: 'https://registry.test/opt/-/opt-1.0.0.tgz' },
                },
              },
            }),
          );
        }
        markTarballStarted();
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    });
    const controller = new AbortController();
    const reason = new Error('project closed during optional dependency');
    const installing = install({
      vfs,
      cwd: '/proj',
      registry,
      signal: controller.signal,
      tarballCache: {
        get: async () => null,
        put: async () => '',
      },
    });

    await tarballStarted;
    controller.abort(reason);

    await expect(installing).rejects.toBe(reason);
    expect(warn).not.toHaveBeenCalled();
    expect(await vfs.exists('/proj/package-lock.json')).toBe(false);
  });

  it('warns and skips when a required child of an optional subtree has an invalid archive', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'pkg',
      new Map([
        [
          '1.0.0',
          await makeEntry('pkg', '1.0.0', {
            optionalDependencies: { opt: '1.0.0' },
          }),
        ],
      ]),
    );
    db.set(
      'opt',
      new Map([['1.0.0', await makeEntry('opt', '1.0.0', { dependencies: { broken: '1.0.0' } })]]),
    );
    const broken = await makeEntry('broken', '1.0.0');
    broken.tarball = new Uint8Array([1, 2, 3]);
    db.set('broken', new Map([['1.0.0', broken]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const result = await install(
      'root',
      '1.0.0',
      { pkg: '1.0.0' },
      { vfs, cwd: '/proj', registry: new FakeRegistry(db) },
    );

    expect(result.packages.map((pkg) => pkg.name).sort()).toEqual(['opt', 'pkg']);
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining('optional dependency opt@1.0.0 of pkg could not be installed'),
    );
  });
});
