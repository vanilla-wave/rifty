import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { makePackageTarball } from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { resolveOverride } from './overrides.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

/** In-memory registry; a fetch for an unknown name throws (the 404 stand-in). */
class FakeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  readonly packumentFetches: string[] = [];
  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }
  override async getPackument(name: string): Promise<Packument> {
    this.packumentFetches.push(name);
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
    const name = decodeURIComponent(match[1] ?? '');
    const entry = this.db.get(name)?.get(match[2] ?? '');
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
      dist: { tarball: `fake://${encodeURIComponent(name)}/${version}` },
    },
    tarball: await makePackageTarball(name, version),
  };
}

describe('resolveOverride — npm bare-version spelling (I1)', () => {
  it('parses a bare version as a range on the keyed package', () => {
    expect(resolveOverride('vite', undefined, { vite: '8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it.each(['^8', '8.x', '*', '>=8.0.0 <9', '<=8.0.16', '=8.0.16', '>8.0.16', '8.0.16+01'])(
    'parses bare range %s as a range on the keyed package',
    (range) => {
      expect(resolveOverride('vite', undefined, { vite: range })).toEqual({
        name: 'vite',
        range,
        source: 'user',
      });
    },
  );

  it('binds a nested-key bare range to the leaf package', () => {
    expect(resolveOverride('vite', 'vitest', { 'vitest>vite': '8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it('keeps the rifty name@range extension spelling working', () => {
    expect(resolveOverride('vite', undefined, { vite: 'vite@8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
    expect(resolveOverride('vite', undefined, { vite: 'npm:vite@8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it('keeps replacement-name semantics for bare non-range values', () => {
    expect(resolveOverride('native', undefined, { native: 'pure' })).toEqual({
      name: 'pure',
      range: null,
      source: 'user',
    });
    expect(resolveOverride('native', undefined, { native: 'pure@1.0.0' })).toEqual({
      name: 'pure',
      range: '1.0.0',
      source: 'user',
    });
  });

  it('throws a named gap for $ref values instead of fetching a $-packument', () => {
    let caught: unknown;
    try {
      resolveOverride('vite', undefined, { vite: '$dep' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.overrides.dollar-ref');
  });

  it('does not classify range forms rifty semver cannot evaluate as ranges', () => {
    // Hyphen ranges stay on the loud packument-404 path (out of scope).
    expect(resolveOverride('vite', undefined, { vite: '8.0.0 - 8.9.9' })).toEqual({
      name: '8.0.0 - 8.9.9',
      range: null,
      source: 'user',
    });
  });

  it.each(['x.1', 'x.1.2', '8.x.2'])(
    'keeps name semantics for wildcard-with-trailing-component %s (not a range)',
    (value) => {
      expect(resolveOverride('vite', undefined, { vite: value })).toEqual({
        name: value,
        range: null,
        source: 'user',
      });
    },
  );

  it('never reads the npm: alias form as a keyed-package range', () => {
    expect(resolveOverride('vite', undefined, { vite: 'npm:8' })).toEqual({
      name: '8',
      range: null,
      source: 'user',
    });
    expect(resolveOverride('vite', undefined, { vite: 'npm:x' })).toEqual({
      name: 'x',
      range: null,
      source: 'user',
    });
  });

  it.each([
    // Valid npm ranges rifty's evaluator mis-reads → loud 404 path, not a
    // silently wrong resolution (out of scope).
    '<8.x',
    '^8.x',
    '~8.x',
    '=8.x',
    '1.2+build',
    // npm zero-fills partial bases UP for these operators (`>8` → `>=9.0.0`,
    // `<=8` → `<9.0.0-0`, `=8` → `8.x`); rifty zero-fills DOWN → name path.
    '>8',
    '<=8',
    '=8',
    '>8.0',
    '>8 <9',
    // node-semver reads an empty `||` branch as `*`; rifty drops it → name path.
    '8 ||',
    '|| 8',
    '8 || || 9',
    // node-semver rejects these (dist-tags in npm) → name semantics.
    '1.2-beta',
    '>=1.2-beta',
    '8.0.16-beta..1',
    '8.0.16-01',
    '8.0.16+..build',
  ])('keeps name semantics for %s', (value) => {
    expect(resolveOverride('vite', undefined, { vite: value })).toEqual({
      name: value,
      range: null,
      source: 'user',
    });
  });

  it('classifies a full version with prerelease as a range', () => {
    expect(resolveOverride('vite', undefined, { vite: '8.0.16-beta.1' })).toEqual({
      name: 'vite',
      range: '8.0.16-beta.1',
      source: 'user',
    });
  });
});

describe('install — npm bare-version override end to end (I1)', () => {
  it('pins vite to the bare-version override for a vitest ^8 edge', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'vitest',
      new Map([['4.1.11', await makeEntry('vitest', '4.1.11', { vite: '^8.0.0' })]]),
    );
    db.set(
      'vite',
      new Map([
        ['8.0.16', await makeEntry('vite', '8.0.16')],
        ['8.3.0', await makeEntry('vite', '8.3.0')],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        devDependencies: { vitest: '4.1.11' },
        overrides: { vite: '8.0.16' },
      }),
    );

    const registry = new FakeRegistry(db);
    const result = await install({ vfs, cwd: '/proj', registry });

    const vite = result.packages.filter((p) => p.name === 'vite');
    expect(vite.map((p) => p.version)).toEqual(['8.0.16']);
    expect(registry.packumentFetches).not.toContain('8.0.16');
    const pinned = JSON.parse(
      new TextDecoder().decode(await vfs.readFile('/proj/node_modules/vite/package.json')),
    ) as { version: string };
    expect(pinned.version).toBe('8.0.16');
    expect(await vfs.exists('/proj/node_modules/vitest/node_modules/vite/package.json')).toBe(
      false,
    );
  });
});
