/**
 * Override target parsing (npm-client/overrides-bare-version-spec): npm's
 * bare-version spelling `"vite": "8.0.16"` resolves as the KEY package at that
 * range, not as a package named "8.0.16" (today's 404). The rifty `name@range`
 * / `npm:` spellings and bare-name redirects keep their parse.
 */
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from './_test-fixtures/tar-builder.ts';
import { install } from './installer.ts';
import { resolveOverride } from './overrides.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

class FakeRegistry extends RegistryClient {
  private readonly db: Map<string, Map<string, FakeRegistryEntry>>;
  packumentReads = 0;

  constructor(db: Map<string, Map<string, FakeRegistryEntry>>) {
    super({ baseUrl: '/fake', fetch: async () => new Response('', { status: 599 }) });
    this.db = db;
  }
  override async getPackument(name: string): Promise<Packument> {
    this.packumentReads++;
    const versions = this.db.get(name);
    if (!versions) throw new Error(`fake registry: no packument for ${name}`);
    const versionsMap: Record<string, VersionManifest> = {};
    for (const [v, entry] of versions) versionsMap[v] = entry.manifest;
    const sorted = [...versions.keys()].sort();
    const latest = sorted[sorted.length - 1] ?? '0.0.0';
    return { name, 'dist-tags': { latest }, versions: versionsMap };
  }
  override async getTarball(tarballUrl: string): Promise<Uint8Array> {
    const match = /^fake:\/\/([^|]+)\|(.+)$/.exec(tarballUrl);
    if (!match) throw new Error(`fake registry: bad tarball url ${tarballUrl}`);
    const entry = this.db.get(decodeURIComponent(match[1] ?? ''))?.get(match[2] ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
}

async function makeEntry(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
): Promise<FakeRegistryEntry> {
  const chunks: Uint8Array[] = [];
  const packageJson = JSON.stringify({ name, version, dependencies });
  const bytes = new TextEncoder().encode(packageJson);
  chunks.push(buildHeader('package/package.json', bytes.length), padToBlock(bytes));
  return {
    manifest: {
      name,
      version,
      dependencies,
      dist: { tarball: `fake://${encodeURIComponent(name)}|${version}` },
    },
    tarball: await gzip(concat(...chunks, TAR_TRAILER)),
  };
}

function db(
  ...entries: [string, FakeRegistryEntry][]
): Map<string, Map<string, FakeRegistryEntry>> {
  const map = new Map<string, Map<string, FakeRegistryEntry>>();
  for (const [name, entry] of entries) {
    const versions = map.get(name) ?? new Map<string, FakeRegistryEntry>();
    versions.set(entry.manifest.version, entry);
    map.set(name, versions);
  }
  return map;
}

describe('override target parsing — npm bare-version spelling (→ I1)', () => {
  it('parses the npm spelling `"vite": "8.0.16"` as the SAME package at that range', () => {
    // npm 11.17.0 oracle (evidence §Oracle): `"overrides": {"vite": "8.0.16"}`
    // resolves one hoisted vite 8.0.16 for vitest's `^8` edge. A value with no
    // name part is the KEY package's spec, not a package name.
    expect(resolveOverride('vite', undefined, { vite: '8.0.16' })).toEqual({
      name: 'vite',
      range: '8.0.16',
      source: 'user',
    });
  });

  it('parses range-shaped bare values as same-name ranges', () => {
    for (const value of ['8.0.16', '^8.0.0', '2.x', '*'] as const) {
      expect(resolveOverride('vite', undefined, { vite: value })).toEqual({
        name: 'vite',
        range: value,
        source: 'user',
      });
    }
  });

  it('resolves the bare range through install(): one vite@8.0.16 for vitest (→ I1)', async () => {
    const registry = new FakeRegistry(
      db(
        ['vite', await makeEntry('vite', '8.0.16')],
        ['vitest', await makeEntry('vitest', '4.1.11', { vite: '^8.0.0' })],
      ),
    );
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        devDependencies: { vitest: '4.1.11' },
        overrides: { vite: '8.0.16' },
      }),
    );
    const result = await install(
      'root',
      '1.0.0',
      { vitest: '4.1.11' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { vite: '8.0.16' },
      },
    );
    const vitePkgs = result.packages.filter((p) => p.name === 'vite');
    expect(vitePkgs).toHaveLength(1);
    expect(vitePkgs[0]?.version).toBe('8.0.16');
    const linked = JSON.parse(
      new TextDecoder().decode(await vfs.readFile('/proj/node_modules/vite/package.json')),
    ) as { version: string };
    expect(linked.version).toBe('8.0.16');
    // No packument was requested for a package named "8.0.16" (today's 404 path).
    expect([...(await vfs.readdir('/proj/node_modules'))]).not.toContain('8.0.16');
  });

  it('keeps the rifty name@range and npm: spellings (→ scenario step 2)', () => {
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

  it('keeps bare package-name redirects (shadow-registry shape) as NAME with no range', () => {
    // bcrypt: 'bcryptjs' (baked) and alias targets ('esbuild-wasm@0.28.0') rely
    // on a bare non-range value meaning "this package, latest" (baseline).
    expect(resolveOverride('bcrypt', undefined, {})).toEqual({
      name: 'bcryptjs',
      range: null,
      source: 'baked',
    });
    expect(resolveOverride('esbuild', undefined, { esbuild: 'esbuild-wasm@0.28.0' })).toEqual({
      name: 'esbuild-wasm',
      range: '0.28.0',
      source: 'user',
    });
  });

  it('keeps parent>child keys in both spellings (baseline)', () => {
    expect(resolveOverride('foo', 'parent', { 'parent>foo': 'bar@2.0.0' })).toEqual({
      name: 'bar',
      range: '2.0.0',
      source: 'user',
    });
    expect(resolveOverride('foo', 'parent', { 'parent>foo': '2.0.0' })).toEqual({
      name: 'foo',
      range: '2.0.0',
      source: 'user',
    });
  });
});

describe('override target parsing — fault row (→ I1 loud corrupt-input)', () => {
  it('npm: alias values are NAMES, never bare ranges: npm:2.x aliases package "2.x"', () => {
    expect(resolveOverride('foo', undefined, { foo: 'npm:2.x' })).toEqual({
      name: '2.x',
      range: null,
      source: 'user',
    });
    expect(resolveOverride('foo', undefined, { foo: 'npm:vite' })).toEqual({
      name: 'vite',
      range: null,
      source: 'user',
    });
  });

  it('a malformed $ref value stays a package-name parse — the loud registry-404 path', () => {
    expect(resolveOverride('baz', undefined, { baz: '$baz' })).toEqual({
      name: '$baz',
      range: null,
      source: 'user',
    });
  });
});
