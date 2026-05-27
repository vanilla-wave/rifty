import { MemoryVfs } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

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
  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }
  override async getPackument(name: string): Promise<Packument> {
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    // tarballUrl format we use below: `fake://<name>/<version>`
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
});

describe('install — nested install for conflicting transitive versions (M11)', () => {
  // Pre-M11 (flat-only linker) this scenario threw EVERSIONCONFLICT and the
  // install died. The live express experiment on 2026-05-27 hit exactly this
  // shape on `ms: 2.1.3 vs 2.0.0` and pinned M11 nested install as a
  // prerequisite for M9 closure. The contract below documents the M11
  // semantics: first-seen wins flat; subsequent conflicting versions get
  // placed under the requesting parent's `node_modules/`.
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
