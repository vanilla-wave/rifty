/**
 * D-F regression tests — pipeline parity between the lockfile fast path and
 * the live-resolve path now that both routes share `fetchAndUnpackToCache`.
 *
 * Specifically covered:
 *   - peer-warning emission survives a fast-path install (lockfile entries
 *     now carry `peerDependencies` so the post-install warn pass sees them);
 *   - both paths run their fetch through the shared helper, so live-path's
 *     previously missing network-integrity verification now throws
 *     `EINTEGRITY` when the registry returns wrong bytes;
 *   - second install reuses cached bytes without re-fetching from the
 *     registry (parity with the live-path on its first run).
 */
import { MemoryVfs } from '@rifty/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';
import { computeIntegrity } from './tarball-cache.ts';

const enc = new TextEncoder();

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

class CountingFakeRegistry extends RegistryClient {
  readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  readonly calls = { packument: [] as string[], tarball: [] as string[] };
  /** When a `(name, version)` pair is present here, `getTarball` returns
   * the given bytes regardless of the registered entry — used to simulate
   * a server returning the wrong tarball for the (name, version) pair. */
  readonly substitutions = new Map<string, Uint8Array>();

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
    const key = `${name}@${version}`;
    const sub = this.substitutions.get(key);
    if (sub) return sub;
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
  const tarball = await makePackageTarball(name, version);
  return {
    manifest: {
      name,
      version,
      dependencies: {},
      dist: { tarball: `fake://${name}/${version}`, integrity: await computeIntegrity(tarball) },
      ...extra,
    },
    tarball,
  };
}

describe('D-F pipeline — peer warnings on fast-path', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('emits the missing-peer warning on the lockfile fast path too (not only on live-resolve)', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'plugin',
      new Map([
        ['1.0.0', await makeEntry('plugin', '1.0.0', { peerDependencies: { host: '^2.0.0' } })],
      ]),
    );

    const registry = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // First install: live-resolve path. Peer warn fires here as before.
    await install('root', '1.0.0', { plugin: '1.0.0' }, { vfs, cwd: '/proj', registry });
    expect(warn).toHaveBeenCalled();
    const liveWarnCount = warn.mock.calls.length;
    warn.mockClear();

    // Second install: lockfile fast path. The lockfile now carries
    // `peerDependencies`, so the post-install warn pass must still fire.
    const registry2 = new CountingFakeRegistry(db);
    await install('root', '1.0.0', { plugin: '1.0.0' }, { vfs, cwd: '/proj', registry: registry2 });
    // Sanity: fast path did skip the network (proves we're on the fast path).
    expect(registry2.calls.packument).toEqual([]);
    expect(registry2.calls.tarball).toEqual([]);
    // And the warning is consistent across paths.
    expect(warn.mock.calls.length).toBe(liveWarnCount);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('peer dependency');
    expect(msg).toContain('host');
    expect(msg).toContain('plugin');
  });
});

describe('D-F pipeline — network integrity verification (live-path divergence closed)', () => {
  it('throws EINTEGRITY on the live-resolve path when registry returns wrong tarball bytes', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0')]]));

    const registry = new CountingFakeRegistry(db);
    // Server lies: returns garbage for `foo@1.0.0`.
    registry.substitutions.set('foo@1.0.0', enc.encode('not a tarball'));

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    let caught: unknown;
    try {
      await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { code?: string; packageName?: string };
    expect(err.code).toBe('EINTEGRITY');
    expect(err.packageName).toBe('foo');
  });

  it('throws EINTEGRITY on the lockfile fast path when network returns wrong bytes after a cache wipe', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0')]]));

    const seed = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: seed });

    // Wipe cache so the fast path falls back to a network fetch but the
    // lockfile-pinned integrity must still be enforced.
    await vfs.rm('/.rifty/tarball-cache', { recursive: true, force: true });

    const registry = new CountingFakeRegistry(db);
    registry.substitutions.set('foo@1.0.0', enc.encode('imposter bytes'));

    let caught: unknown;
    try {
      await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { code?: string };
    expect(err.code).toBe('EINTEGRITY');
  });
});

describe('D-F pipeline — parity of side effects between paths', () => {
  it('second install (fast path) does not rewrite cache files or rerun network fetches', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set('foo', new Map([['1.0.0', await makeEntry('foo', '1.0.0')]]));

    const first = new CountingFakeRegistry(db);
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: first });
    expect(first.calls.tarball.length).toBe(1);

    const second = new CountingFakeRegistry(db);
    await install('root', '1.0.0', { foo: '1.0.0' }, { vfs, cwd: '/proj', registry: second });
    expect(second.calls.tarball).toEqual([]);
    expect(second.calls.packument).toEqual([]);
  });
});
