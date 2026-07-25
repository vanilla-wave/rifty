import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs, joinPath } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { readExistingLockfile } from './installer-lockfile-reader.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

class CountingFakeRegistry extends RegistryClient {
  readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  readonly calls = { packument: [] as string[], tarball: [] as string[] };

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }
  override async getPackument(name: string): Promise<Packument> {
    this.calls.packument.push(name);
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    this.calls.tarball.push(tarballUrl);
    const match = /^fake:\/\/([^/]+)\/(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const [, name, version] = match;
    const entry = this.db.get(name ?? '')?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function makeEntry(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
): Promise<FakeRegistryEntry> {
  return {
    manifest: {
      name,
      version,
      dependencies,
      dist: { tarball: `fake://${name}/${version}` },
    },
    tarball: await makePackageTarball(name, version),
  };
}

/**
 * If `package-lock.json` exists but is not valid JSON, `install` previously
 * caught the parse error and silently fell back to a full live re-resolve.
 * That hides corruption from the operator. We now throw with `{ cause }`
 * carrying the original SyntaxError.
 */
describe('install — corrupt lockfile', () => {
  it('throws a clear error with cause when package-lock.json is unparseable', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(joinPath('/proj', 'package-lock.json'), '{not valid json');

    // Registry never gets hit because we should fail before that.
    const registry = new RegistryClient({
      baseUrl: '/never',
      fetch: async () => new Response('', { status: 599 }),
    });

    let caught: unknown;
    try {
      await install('root', '1.0.0', {}, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    expect(err.message).toContain('lockfile corrupt');
    expect(err.message).toContain('/proj/package-lock.json');
    // `cause` is the original JSON SyntaxError. Node typings expose it as unknown.
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });
});

/**
 * lockfileVersion 1 (npm 5/6) and 2 (npm 7) use a different shape than v3
 * (npm 7+). Previously the reader silently returned `null` for those, which
 * caused `install` to do a full fresh resolve and overwrite the user's
 * lockfile with a v3. That's data loss disguised as caching. The reader now
 * throws `NotImplementedError('npm-client.lockfile.v{1,2}')` so the caller
 * sees the gap.
 */
describe('readExistingLockfile — legacy lockfileVersion', () => {
  it('throws NotImplementedError for lockfileVersion 1', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', lockfileVersion: 1, dependencies: {} }),
    );

    let caught: unknown;
    try {
      await readExistingLockfile(vfs, '/proj');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    const err = caught as NotImplementedError;
    expect(err.feature).toBe('npm-client.lockfile.v1');
  });

  it('throws NotImplementedError for lockfileVersion 2', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 2,
        packages: {},
        dependencies: {},
      }),
    );

    let caught: unknown;
    try {
      await readExistingLockfile(vfs, '/proj');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    const err = caught as NotImplementedError;
    expect(err.feature).toBe('npm-client.lockfile.v2');
  });

  it('propagates NotImplementedError through install()', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', lockfileVersion: 1, dependencies: {} }),
    );

    // Registry never gets hit; we should fail at the reader step.
    const registry = new RegistryClient({
      baseUrl: '/never',
      fetch: async () => new Response('', { status: 599 }),
    });

    let caught: unknown;
    try {
      await install('root', '1.0.0', {}, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.lockfile.v1');
  });
});

/**
 * P1 semantic divergence (ADR-0023 follow-up): the lockfile fast path used to
 * replay pins verbatim, ignoring overrides. So if a user shipped a lockfile
 * pinning `foo@1.0.0` and then added an override redirecting `foo → bar`, the
 * next `install()` would happily reuse the `foo` pin and the override would
 * silently no-op until a full live resolve was forced. The fix walks each
 * top-level dep + every subgraph entry through `resolveOverride()` and falls
 * through to live-resolve when an override would redirect to a name that the
 * lockfile does not already pin.
 */
describe('install — lockfile fast path re-applies overrides', () => {
  it('falls through to live-resolve when a user override redirects a locked dep to a new name', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0')]]));
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));

    // Step 1: produce a lockfile that pins `foo@1.0.0`, no overrides yet.
    const seedRegistry = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: seedRegistry });
    expect(await vfs.exists('/proj/node_modules/foo/package.json')).toBe(true);

    // Step 2: same vfs (so the lockfile and tarball cache are intact), new
    // registry with fresh counters, and a user override that redirects
    // `foo → bar`. The fast path must NOT replay the `foo` pin — it has to
    // fall through to live resolve so `bar` ends up installed.
    const registry = new CountingFakeRegistry(db);
    const result = await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { foo: 'bar@1.0.0' },
      },
    );

    // Live resolve fetched bar's packument and tarball — proof the fast path
    // was skipped.
    expect(registry.calls.packument).toContain('bar');
    expect(registry.calls.tarball.some((url) => url.includes('bar'))).toBe(true);
    // And the installed package is `bar`, not `foo`.
    expect(result.packages.map((p) => p.name)).toContain('bar');
    expect(await vfs.exists('/proj/node_modules/bar/package.json')).toBe(true);
  });

  it('replays an override-redirected top-level dependency from lockfile on the second install', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const firstRegistry = new CountingFakeRegistry(db);
    const overrides = { foo: 'bar@1.0.0' };

    const first = await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      { vfs, cwd: '/proj', registry: firstRegistry, overrides },
    );
    expect(first.packages.map((p) => p.name)).toEqual(['bar']);
    expect(await vfs.exists('/proj/node_modules/bar/package.json')).toBe(true);

    const secondRegistry = new CountingFakeRegistry(db);
    const second = await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      { vfs, cwd: '/proj', registry: secondRegistry, overrides },
    );

    expect(second.packages.map((p) => p.name)).toEqual(['bar']);
    expect(secondRegistry.calls.packument).toEqual([]);
    expect(secondRegistry.calls.tarball).toEqual([]);
  });

  it('replays an unchanged parent-scoped override without consulting metadata', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { child: '1.0.0' })]]));
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const overrides = { 'parent>child': 'bar@1.0.0' };
    await install(
      'root',
      '1.0.0',
      { parent: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db), overrides },
    );
    expect(await vfs.exists('/proj/node_modules/bar/package.json')).toBe(true);

    const registry = new CountingFakeRegistry(db);
    const result = await install(
      'root',
      '1.0.0',
      { parent: '1.0.0' },
      { vfs, cwd: '/proj', registry, overrides },
    );

    expect(result.packages.map((p) => p.name).sort()).toEqual(['bar', 'parent']);
    expect(registry.calls).toEqual({ packument: [], tarball: [] });
  });

  it('falls through when an override changes the locked range to one the pin no longer satisfies', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'foo',
      new Map([
        ['1.0.0', await makeEntry('foo', '1.0.0')],
        ['2.0.0', await makeEntry('foo', '2.0.0')],
      ]),
    );

    // Seed with foo@1.0.0 locked.
    const seedRegistry = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { foo: '^1.0.0' },
      { vfs, cwd: '/proj', registry: seedRegistry },
    );

    // Now ask for `foo: ^1.0.0` again — same range as last time — but layer
    // an override that pins foo to `2.0.0`. The lockfile's `foo@1.0.0` no
    // longer satisfies the override's effective range, so the fast path must
    // bail and live-resolve must run.
    const registry = new CountingFakeRegistry(db);
    const result = await install(
      'root',
      '1.0.0',
      { foo: '^1.0.0' },
      { vfs, cwd: '/proj', registry, overrides: { foo: 'foo@2.0.0' } },
    );

    expect(registry.calls.packument).toContain('foo');
    expect(result.packages.find((p) => p.name === 'foo')?.version).toBe('2.0.0');
  });

  it('still hits the fast path when no override touches the locked subgraph', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0')]]));

    const seed = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: seed });

    // Same install, override for an unrelated package. The fast path stays
    // engaged and no network calls happen.
    const registry = new CountingFakeRegistry(db);
    await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      { vfs, cwd: '/proj', registry, overrides: { 'unrelated-pkg': 'something-else' } },
    );
    expect(registry.calls.packument).toEqual([]);
    expect(registry.calls.tarball).toEqual([]);
  });
});

describe('install — partial lockfile reuse', () => {
  it('[fault: frozen-assumption] re-resolves only a transitive range-drifted lock entry', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { child: '^1.0.0' })]]));
    db.set(
      'child',
      new Map([
        ['1.0.0', await makeEntry('child', '1.0.0')],
        ['2.0.0', await makeEntry('child', '2.0.0')],
      ]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { parent: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );
    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockfile = JSON.parse(await vfs.readFileText(lockPath)) as {
      packages: Record<string, { dependencies?: Record<string, string>; version?: string }>;
    };
    const lockedParent = lockfile.packages['node_modules/parent'];
    if (!lockedParent?.dependencies) throw new Error('seed lockfile missing parent dependencies');
    lockedParent.dependencies.child = '^2.0.0';
    await vfs.writeFile(lockPath, JSON.stringify(lockfile));
    const eddyFetch = vi.fn(async () => {
      throw new Error('expected Eddy probe failure');
    });
    vi.stubGlobal('fetch', eddyFetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new CountingFakeRegistry(db);
      const result = await install(
        'root',
        '1.0.0',
        { parent: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry,
          resolverUrl: 'https://eddy.invalid/resolve',
        },
      );

      expect(eddyFetch).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('standard');
      expect(result.provenance.eddyFallback?.reason).toMatch(/expected Eddy probe failure/);
      expect(result.provenance.resolution).toBe('metadata');
      expect(registry.calls).toEqual({
        packument: ['child'],
        tarball: ['fake://child/2.0.0'],
      });
      expect(result.lockfile.packages['node_modules/parent']?.version).toBe('1.0.0');
      expect(result.lockfile.packages['node_modules/child']?.version).toBe('2.0.0');
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('retries a failed root optional without re-resolving the retained required graph', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('stable', new Map([['1.0.0', await makeEntry('stable', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: { stable: '1.0.0' },
        optionalDependencies: { missing: '1.0.0' },
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seedRegistry = new CountingFakeRegistry(db);
    await install({ vfs, cwd: '/proj', registry: seedRegistry });

    const replayRegistry = new CountingFakeRegistry(db);
    const result = await install({ vfs, cwd: '/proj', registry: replayRegistry });

    expect(replayRegistry.calls.packument.length).toBeGreaterThan(0);
    expect(new Set(replayRegistry.calls.packument)).toEqual(new Set(['missing']));
    expect(replayRegistry.calls.tarball).toEqual([]);
    expect(result.provenance.resolution).toBe('metadata');
    expect(result.packages.map(({ name }) => name)).toEqual(['stable']);
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining('optional dependency missing@1.0.0 of root could not be installed'),
    );
    warn.mockRestore();
  });

  it('preserves compatible flat and nested pins while resolving only a new root', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'flat-parent',
      new Map([['1.0.0', await makeEntry('flat-parent', '1.0.0', { shared: '2.0.0' })]]),
    );
    db.set(
      'nested-parent',
      new Map([['1.0.0', await makeEntry('nested-parent', '1.0.0', { shared: '^1.0.0' })]]),
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
    const initialRequest = { 'flat-parent': '1.0.0', 'nested-parent': '1.0.0' };
    const seeded = await install('root', '1.0.0', initialRequest, {
      vfs,
      cwd: '/proj',
      registry: new CountingFakeRegistry(db),
    });
    const retainedEntries = Object.fromEntries(
      [
        'node_modules/flat-parent',
        'node_modules/nested-parent',
        'node_modules/shared',
        'node_modules/nested-parent/node_modules/shared',
      ].map((path) => [path, structuredClone(seeded.lockfile.packages[path])]),
    );

    db.get('shared')?.set('1.1.0', await makeEntry('shared', '1.1.0'));
    db.set('newcomer', new Map([['1.0.0', await makeEntry('newcomer', '1.0.0')]]));
    const registry = new CountingFakeRegistry(db);
    const result = await install(
      'root',
      '1.0.0',
      { ...initialRequest, newcomer: '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    expect(result.provenance.resolution).toBe('metadata');
    expect(registry.calls).toEqual({
      packument: ['newcomer'],
      tarball: ['fake://newcomer/1.0.0'],
    });
    for (const [path, entry] of Object.entries(retainedEntries)) {
      expect(result.lockfile.packages[path]).toEqual(entry);
    }
    expect(
      result.lockfile.packages['node_modules/nested-parent/node_modules/shared']?.version,
    ).toBe('1.0.0');
    expect(result.lockfile.packages['node_modules/newcomer']?.version).toBe('1.0.0');
  });

  it('keeps request-order placement when a new subgraph conflicts with a retained pin', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'retained-parent',
      new Map([['1.0.0', await makeEntry('retained-parent', '1.0.0', { shared: '1.0.0' })]]),
    );
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { 'retained-parent': '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      },
    );

    db.set(
      'new-parent',
      new Map([['1.0.0', await makeEntry('new-parent', '1.0.0', { shared: '2.0.0' })]]),
    );
    db.get('shared')?.set('2.0.0', await makeEntry('shared', '2.0.0'));
    const registry = new CountingFakeRegistry(db);
    const result = await install(
      'root',
      '1.0.0',
      { 'new-parent': '1.0.0', 'retained-parent': '1.0.0' },
      { vfs, cwd: '/proj', registry },
    );

    expect(registry.calls.packument).toEqual(['new-parent', 'shared']);
    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('2.0.0');
    expect(
      result.lockfile.packages['node_modules/retained-parent/node_modules/shared']?.version,
    ).toBe('1.0.0');
  });

  it('lets a new direct root own flat while relocating its retained transitive copy', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { parent: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      },
    );

    db.get('shared')?.set('2.0.0', await makeEntry('shared', '2.0.0'));
    const result = await install(
      'root',
      '1.0.0',
      { shared: '2.0.0', parent: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('2.0.0');
    expect(result.lockfile.packages['node_modules/parent/node_modules/shared']?.version).toBe(
      '1.0.0',
    );
    expect(result.lockfile.packages['/node_modules/shared']).toBeUndefined();
  });

  it('lets a later-requested direct root own flat while relocating its retained transitive copy', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('parent', new Map([['1.0.0', await makeEntry('parent', '1.0.0', { shared: '1.0.0' })]]));
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { parent: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      },
    );

    db.get('shared')?.set('2.0.0', await makeEntry('shared', '2.0.0'));
    const result = await install(
      'root',
      '1.0.0',
      { parent: '1.0.0', shared: '2.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('2.0.0');
    expect(result.lockfile.packages['node_modules/parent/node_modules/shared']?.version).toBe(
      '1.0.0',
    );
    expect(result.lockfile.packages['/node_modules/shared']).toBeUndefined();
  });

  it('relocates a replayed pin when a changed root subtree claims its old flat path first', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'wrapper',
      new Map([['1.0.0', await makeEntry('wrapper', '1.0.0', { shared: '1.0.0' })]]),
    );
    db.set('shared', new Map([['1.0.0', await makeEntry('shared', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { wrapper: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      },
    );

    db.get('wrapper')?.set(
      '2.0.0',
      await makeEntry('wrapper', '2.0.0', { 'new-parent': '1.0.0', shared: '1.0.0' }),
    );
    db.set(
      'new-parent',
      new Map([['1.0.0', await makeEntry('new-parent', '1.0.0', { shared: '2.0.0' })]]),
    );
    db.get('shared')?.set('2.0.0', await makeEntry('shared', '2.0.0'));
    const result = await install(
      'root',
      '1.0.0',
      { wrapper: '2.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );

    expect(result.lockfile.packages['node_modules/shared']?.version).toBe('2.0.0');
    expect(result.lockfile.packages['node_modules/wrapper/node_modules/shared']?.version).toBe(
      '1.0.0',
    );
  });

  it('rebases retained descendants under the actual path of a relocated parent', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('blocker', new Map([['1.0.0', await makeEntry('blocker', '1.0.0', { dep: '2.0.0' })]]));
    db.set('owner', new Map([['1.0.0', await makeEntry('owner', '1.0.0', { pkg: '1.0.0' })]]));
    db.set('pkg', new Map([['1.0.0', await makeEntry('pkg', '1.0.0', { dep: '1.0.0' })]]));
    db.set(
      'dep',
      new Map([
        ['1.0.0', await makeEntry('dep', '1.0.0')],
        ['2.0.0', await makeEntry('dep', '2.0.0')],
      ]),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { blocker: '1.0.0', owner: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );

    db.get('pkg')?.set('2.0.0', await makeEntry('pkg', '2.0.0'));
    const result = await install(
      'root',
      '1.0.0',
      { pkg: '2.0.0', blocker: '1.0.0', owner: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );

    expect(result.lockfile.packages['node_modules/pkg']?.version).toBe('2.0.0');
    expect(result.lockfile.packages['node_modules/owner/node_modules/pkg']?.version).toBe('1.0.0');
    expect(
      result.lockfile.packages['node_modules/owner/node_modules/pkg/node_modules/dep']?.version,
    ).toBe('1.0.0');
    expect(result.lockfile.packages['node_modules/pkg/node_modules/dep']).toBeUndefined();
  });

  it('re-resolves a changed global override without drifting an unrelated retained root', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('host', new Map([['1.0.0', await makeEntry('host', '1.0.0', { foo: '1.0.0' })]]));
    db.set(
      'bar',
      new Map([
        ['1.0.0', await makeEntry('bar', '1.0.0')],
        ['2.0.0', await makeEntry('bar', '2.0.0')],
      ]),
    );
    db.set('newcomer', new Map([['1.0.0', await makeEntry('newcomer', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { host: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
        overrides: { foo: 'bar@1.0.0' },
      },
    );
    const before = JSON.parse(await vfs.readFileText(joinPath('/proj', 'package-lock.json'))) as {
      packages: Record<string, unknown>;
    };
    const registry = new CountingFakeRegistry(db);

    const result = await install(
      'root',
      '1.0.0',
      { host: '1.0.0', newcomer: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { foo: 'bar@2.0.0' },
      },
    );

    expect(registry.calls.packument.sort()).toEqual(['bar', 'newcomer']);
    expect(result.lockfile.packages['node_modules/host']).toEqual(
      before.packages['node_modules/host'],
    );
    expect(result.lockfile.packages['node_modules/bar']?.version).toBe('2.0.0');
    expect(result.lockfile.packages['node_modules/newcomer']?.version).toBe('1.0.0');
  });

  it('does not call an override-drifted lock zero-network when deciding whether to use Eddy', async () => {
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
    await install(
      'root',
      '1.0.0',
      { host: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
        overrides: { foo: 'bar@1.0.0' },
      },
    );
    const eddyFetch = vi.fn(async () => {
      throw new Error('expected Eddy probe failure');
    });
    vi.stubGlobal('fetch', eddyFetch);
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const registry = new CountingFakeRegistry(db);
      const result = await install(
        'root',
        '1.0.0',
        { host: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry,
          overrides: { foo: 'bar@2.0.0' },
          resolverUrl: 'https://eddy.invalid/resolve',
        },
      );

      expect(eddyFetch).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('standard');
      expect(result.provenance.eddyFallback?.reason).toMatch(/expected Eddy probe failure/);
      expect(registry.calls.packument).toEqual(['bar']);
      expect(result.lockfile.packages['node_modules/bar']?.version).toBe('2.0.0');
    } finally {
      console.warn = originalWarn;
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['alias first', { foo: '1.0.0', bar: '2.0.0' }],
    ['target first', { bar: '2.0.0', foo: '1.0.0' }],
  ])(
    '[fault: lossy-aggregate] rejects incompatible direct effective-name collisions (%s)',
    async (_label, request) => {
      const db = new Map<string, Map<string, FakeRegistryEntry>>();
      db.set(
        'bar',
        new Map([
          ['1.0.0', await makeEntry('bar', '1.0.0')],
          ['2.0.0', await makeEntry('bar', '2.0.0')],
        ]),
      );
      const vfs = new MemoryVfs();
      await vfs.mkdir('/proj', { recursive: true });
      const overrides = { foo: 'bar@1.0.0' };
      await install(
        'root',
        '1.0.0',
        { foo: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry: new CountingFakeRegistry(db),
          overrides,
        },
      );
      const lockPath = joinPath('/proj', 'package-lock.json');
      const before = await vfs.readFile(lockPath);

      await expect(
        install('root', '1.0.0', request, {
          vfs,
          cwd: '/proj',
          registry: new CountingFakeRegistry(db),
          overrides,
        }),
      ).rejects.toMatchObject({
        code: 'EINSTALLPATHCONFLICT',
        installPath: 'node_modules/bar',
      });
      expect(await vfs.readFile(lockPath)).toEqual(before);
      expect(await vfs.exists('/node_modules/bar')).toBe(false);
    },
  );

  it('[fault: corrupt-input] never swallows retained lock corruption through a root optional boundary', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('optional', new Map([['1.0.0', await makeEntry('optional', '1.0.0')]]));
    db.set('newcomer', new Map([['1.0.0', await makeEntry('newcomer', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const packageJson = (withNewcomer: boolean) =>
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: withNewcomer ? { newcomer: '1.0.0' } : {},
        optionalDependencies: { optional: '1.0.0' },
      });
    await vfs.writeFile('/proj/package.json', packageJson(false));
    await install({ vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) });
    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockfile = JSON.parse(await vfs.readFileText(lockPath)) as {
      packages: Record<string, { integrity?: string }>;
    };
    // biome-ignore lint/performance/noDelete: fault injection needs a malformed retained entry
    delete lockfile.packages['node_modules/optional']?.integrity;
    await vfs.writeFile(lockPath, JSON.stringify(lockfile));
    const before = await vfs.readFile(lockPath);
    await vfs.writeFile('/proj/package.json', packageJson(true));

    await expect(
      install({
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      }),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK', reason: 'malformed-entry' });
    expect(await vfs.readFile(lockPath)).toEqual(before);
    expect(await vfs.exists('/proj/node_modules/newcomer')).toBe(false);
  });

  it('keeps a corrupt retained subgraph loud and publishes no partial mutation', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0', { bar: '1.0.0' })]]));
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));
    db.set('newcomer', new Map([['1.0.0', await makeEntry('newcomer', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry: new CountingFakeRegistry(db),
      },
    );
    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockfile = JSON.parse(await vfs.readFileText(lockPath)) as {
      packages: Record<string, { integrity?: string }>;
    };
    // biome-ignore lint/performance/noDelete: fault injection needs a malformed retained entry
    delete lockfile.packages['node_modules/bar']?.integrity;
    await vfs.writeFile(lockPath, JSON.stringify(lockfile));
    const corruptBytes = await vfs.readFile(lockPath);
    const registry = new CountingFakeRegistry(db);

    await expect(
      install(
        'root',
        '1.0.0',
        { foo: '1.0.0', newcomer: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry,
        },
      ),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK', reason: 'malformed-entry' });
    expect(registry.calls.tarball).toEqual([]);
    expect(await vfs.readFile(lockPath)).toEqual(corruptBytes);
    expect(await vfs.exists('/proj/node_modules/newcomer')).toBe(false);
  });

  it('[fault: torn-state] settles an earlier acquisition before publishing a later retained-lock failure', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0', { broken: '1.0.0' })]]));
    db.set('broken', new Map([['1.0.0', await makeEntry('broken', '1.0.0')]]));
    db.set('newcomer', new Map([['1.0.0', await makeEntry('newcomer', '1.0.0')]]));
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install(
      'root',
      '1.0.0',
      { foo: '1.0.0' },
      { vfs, cwd: '/proj', registry: new CountingFakeRegistry(db) },
    );
    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockfile = JSON.parse(await vfs.readFileText(lockPath)) as {
      packages: Record<string, { integrity?: string }>;
    };
    // biome-ignore lint/performance/noDelete: fault injection needs malformed retained data
    delete lockfile.packages['node_modules/broken']?.integrity;
    await vfs.writeFile(lockPath, JSON.stringify(lockfile));

    let releaseGate: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    class GatedRegistry extends CountingFakeRegistry {
      override async getTarball(tarballUrl: string): Promise<Uint8Array> {
        if (tarballUrl === 'fake://newcomer/1.0.0') {
          markStarted?.();
          await gate;
        }
        return await super.getTarball(tarballUrl);
      }
    }
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const observed = install(
      'root',
      '1.0.0',
      { newcomer: '1.0.0', foo: '1.0.0' },
      { vfs, cwd: '/proj', registry: new GatedRegistry(db) },
    ).then(
      () => {
        outcome = 'resolved';
        return undefined;
      },
      (error: unknown) => {
        outcome = 'rejected';
        return error;
      },
    );

    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(outcome).toBe('pending');
    releaseGate?.();
    await expect(observed).resolves.toMatchObject({
      code: 'EBROKENLOCK',
      reason: 'malformed-entry',
    });
  });
});

/**
 * Lockfile-replay was previously tolerating malformed entries (missing
 * `resolved`/`integrity`) by returning `null` from the source — the walk
 * silently stopped and produced a partial install. That hid corruption.
 * Follow-ups doc item #21 promoted this to a hard `EBROKENLOCK` throw so
 * the operator sees the gap.
 */
describe('install — lockfile fast path rejects malformed entries (EBROKENLOCK)', () => {
  it('throws when a transitive subgraph entry is missing `integrity`', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0', { bar: '1.0.0' })]]));
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));

    // Seed a valid lockfile, then hand-edit it to drop `integrity` on bar.
    const seedRegistry = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: seedRegistry });

    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockText = await vfs.readFileText(lockPath);
    const lock = JSON.parse(lockText) as {
      packages: Record<string, { integrity?: string; resolved?: string }>;
    };
    // biome-ignore lint/performance/noDelete: test corruption requires actual key deletion
    delete lock.packages['node_modules/bar']?.integrity;
    await vfs.writeFile(lockPath, JSON.stringify(lock));

    // Re-install with the corrupted lockfile. The fast path must throw.
    const registry = new CountingFakeRegistry(db);
    let caught: unknown;
    try {
      await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { code?: string; packageName?: string; reason?: string };
    expect(err.code).toBe('EBROKENLOCK');
    expect(err.packageName).toBe('bar');
    expect(err.reason).toBe('malformed-entry');
    expect(err.message).toContain('integrity');
  });

  it('throws when a transitive subgraph entry is missing `resolved`', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0', { bar: '1.0.0' })]]));
    db.set('bar', new Map([['1.0.0', await makeEntry('bar', '1.0.0')]]));

    const seedRegistry = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: seedRegistry });

    const lockPath = joinPath('/proj', 'package-lock.json');
    const lockText = await vfs.readFileText(lockPath);
    const lock = JSON.parse(lockText) as {
      packages: Record<string, { integrity?: string; resolved?: string }>;
    };
    // biome-ignore lint/performance/noDelete: test corruption requires actual key deletion
    delete lock.packages['node_modules/bar']?.resolved;
    await vfs.writeFile(lockPath, JSON.stringify(lock));

    const registry = new CountingFakeRegistry(db);
    let caught: unknown;
    try {
      await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    const err = caught as Error & { code?: string; packageName?: string; reason?: string };
    expect(err.code).toBe('EBROKENLOCK');
    expect(err.reason).toBe('malformed-entry');
    expect(err.message).toContain('resolved');
  });
});
