/**
 * Install-time shadow shims (ADR-0188, backlog npm-client/install-time-shadow-shims):
 * internals shims written into the ACTUAL installed dirs (nested included),
 * companion lockstep pins, range gate, and the substitution provenance lines —
 * fresh install AND lockfile replay.
 */
import { internalsShims } from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { matchesRange } from './semver.ts';
import { applyInternalsShims } from './shadow-shims.ts';

interface FakeRegistryEntry {
  manifest: VersionManifest;
  tarball: Uint8Array;
}

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
  files: Record<string, string> = {},
): Promise<FakeRegistryEntry> {
  const chunks: Uint8Array[] = [];
  const packageJson = JSON.stringify({ name, version, dependencies });
  for (const [entry, body] of Object.entries({ 'package.json': packageJson, ...files })) {
    const bytes = new TextEncoder().encode(body);
    chunks.push(buildHeader(`package/${entry}`, bytes.length), padToBlock(bytes));
  }
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

async function readText(vfs: MemoryVfs, path: string): Promise<string> {
  return await vfs.readFileText(path);
}

const REAL_ROLLUP_NATIVE = 'throw new Error("REAL-NATIVE-SENTINEL");';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install-time shadow shims — rollup internals patch + companion', () => {
  async function rollupDb(version = '4.62.2') {
    return db(
      ['rollup', await makeEntry('rollup', version, {}, { 'dist/native.js': REAL_ROLLUP_NATIVE })],
      ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', version)],
    );
  }

  it('patches rollup/dist/native.js in place and installs the same-version companion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const lines: string[] = [];
    const result = await install(
      'root',
      '1.0.0',
      { rollup: '4.62.2' },
      {
        vfs,
        cwd: '/proj',
        registry: new FakeRegistry(await rollupDb()),
        onSubstitution: (line) => lines.push(line),
      },
    );

    const native = await readText(vfs, '/proj/node_modules/rollup/dist/native.js');
    expect(native).toContain("require('@rollup/wasm-node/dist/native.js')");
    expect(native).not.toContain('REAL-NATIVE-SENTINEL');
    // Companion joined the walk: installed AND pinned in the lockfile.
    expect(result.lockfile.packages['node_modules/@rollup/wasm-node']?.version).toBe('4.62.2');
    expect(await vfs.exists('/proj/node_modules/@rollup/wasm-node/package.json')).toBe(true);
    expect(lines).toContain('npm: rollup@4.62.2 internals patched from shadow registry');
  });

  it('patches a NESTED rollup copy at its actual install path with a lockstep companion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db(
        [
          'rollup',
          await makeEntry('rollup', '4.63.0', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
        ],
        [
          'rollup',
          await makeEntry('rollup', '4.62.2', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
        ],
        ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', '4.63.0')],
        ['@rollup/wasm-node', await makeEntry('@rollup/wasm-node', '4.62.2')],
        ['uses-old-rollup', await makeEntry('uses-old-rollup', '1.0.0', { rollup: '4.62.2' })],
      ),
    );
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { rollup: '4.63.0', 'uses-old-rollup': '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => lines.push(line),
      },
    );

    const nestedNative = await readText(
      vfs,
      '/proj/node_modules/uses-old-rollup/node_modules/rollup/dist/native.js',
    );
    expect(nestedNative).toContain("require('@rollup/wasm-node/dist/native.js')");
    // Each copy got its own same-version companion, resolvable by walk-up.
    expect(await vfs.exists('/proj/node_modules/@rollup/wasm-node/package.json')).toBe(true);
    expect(
      await vfs.exists(
        '/proj/node_modules/uses-old-rollup/node_modules/rollup/node_modules/@rollup/wasm-node/package.json',
      ),
    ).toBe(true);
    expect(lines).toContain('npm: rollup@4.63.0 internals patched from shadow registry');
    expect(lines).toContain('npm: rollup@4.62.2 internals patched from shadow registry');
  });

  it('throws NotImplementedError for a rollup version outside the proven shim range', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db([
        'rollup',
        await makeEntry('rollup', '5.0.0', {}, { 'dist/native.js': REAL_ROLLUP_NATIVE }),
      ]),
    );
    await expect(
      install('root', '1.0.0', { rollup: '5.0.0' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      message: expect.stringContaining('shadow-registry.rollup@5.0.0'),
    });
  });

  it('loud EBROKENLOCK when a pre-shim lockfile lacks the companion entry (replay)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await rollupDb());
    await install('root', '1.0.0', { rollup: '4.62.2' }, { vfs, cwd: '/proj', registry });
    // Simulate a lockfile written before install-time shims existed.
    const lockfile = JSON.parse(await readText(vfs, '/proj/package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    lockfile.packages = Object.fromEntries(
      Object.entries(lockfile.packages).filter(([key]) => key !== 'node_modules/@rollup/wasm-node'),
    );
    await vfs.writeFile('/proj/package-lock.json', JSON.stringify(lockfile));

    await expect(
      install('root', '1.0.0', { rollup: '4.62.2' }, { vfs, cwd: '/proj', registry }),
    ).rejects.toMatchObject({ code: 'EBROKENLOCK' });
  });

  it('applyInternalsShims refuses a companion at a drifted version', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules/rollup/dist', { recursive: true });
    await expect(
      applyInternalsShims(
        vfs,
        '/proj',
        [
          { name: 'rollup', version: '4.62.2', installPath: 'node_modules/rollup' },
          {
            name: '@rollup/wasm-node',
            version: '4.62.1',
            installPath: 'node_modules/@rollup/wasm-node',
          },
        ],
        () => {},
      ),
    ).rejects.toThrow(/companion/i);
  });
});

describe('install-time shadow shims — alias packages + substitution lines', () => {
  async function esbuildDb() {
    return db(
      ['@esbuild/wasi-preview1', await makeEntry('@esbuild/wasi-preview1', '0.28.0')],
      ['viteish', await makeEntry('viteish', '1.0.0', { esbuild: '^0.28.0' })],
    );
  }

  const REDIRECT_LINE =
    'npm: esbuild@^0.28.0 → @esbuild/wasi-preview1@0.28.0 (substituted from shadow registry, ADR-0051)';
  const PATCH_LINE = 'npm: esbuild@0.28.0 internals patched from shadow registry';

  it('materializes the esbuild alias package next to the redirect target (fresh + replay, byte-identical)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const fresh: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => fresh.push(line),
      },
    );

    // PR#125 F1: the delegating body lives ONLY in lib/main.cjs now
    // (lib/main.js is a thin re-export — one module instance across
    // import/require, like real esbuild's lone CJS entry).
    const aliasMain = await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs');
    expect(aliasMain).toContain('globalThis.__riftyEsbuild');
    expect(await readText(vfs, '/proj/node_modules/esbuild/package.json')).toContain('"esbuild"');
    expect(fresh).toContain(REDIRECT_LINE);
    expect(fresh).toContain(PATCH_LINE);

    // Replay (lockfile fast path): same lines, byte-identical shim files.
    const replay: string[] = [];
    await install(
      'root',
      '1.0.0',
      { esbuild: '^0.28.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => replay.push(line),
      },
    );
    expect(replay).toContain(REDIRECT_LINE);
    expect(replay).toContain(PATCH_LINE);
    expect(await readText(vfs, '/proj/node_modules/esbuild/lib/main.cjs')).toBe(aliasMain);
  });

  it('prints the redirect + patch lines for a TRANSITIVE baked override on fresh AND replay', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const fresh: string[] = [];
    await install(
      'root',
      '1.0.0',
      { viteish: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => fresh.push(line),
      },
    );
    expect(fresh).toContain(REDIRECT_LINE);
    expect(fresh).toContain(PATCH_LINE);
    expect(await vfs.exists('/proj/node_modules/esbuild/lib/main.js')).toBe(true);

    const replay: string[] = [];
    await install(
      'root',
      '1.0.0',
      { viteish: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => replay.push(line),
      },
    );
    expect(replay).toContain(REDIRECT_LINE);
    expect(replay).toContain(PATCH_LINE);
  });

  it('prints a redirect line for a plain baked redirect without an internals shim (bcrypt)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db(['bcryptjs', await makeEntry('bcryptjs', '2.4.3')]));
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { bcrypt: '*' },
      {
        vfs,
        cwd: '/proj',
        registry,
        onSubstitution: (line) => lines.push(line),
      },
    );
    expect(lines).toContain(
      'npm: bcrypt@* → bcryptjs@2.4.3 (substituted from shadow registry, ADR-0051)',
    );
    expect(lines.filter((l) => l.includes('internals patched'))).toEqual([]);
  });

  it('does NOT attribute a USER override to the shadow registry', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(db(['pure', await makeEntry('pure', '1.0.0')]));
    const lines: string[] = [];
    await install(
      'root',
      '1.0.0',
      { native: '1.0.0' },
      {
        vfs,
        cwd: '/proj',
        registry,
        overrides: { native: 'pure@1.0.0' },
        onSubstitution: (line) => lines.push(line),
      },
    );
    expect(lines).toEqual([]);
  });

  it('defaults the substitution sink to console.warn — substitutions are never silent', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(await esbuildDb());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await install('root', '1.0.0', { esbuild: '^0.28.0' }, { vfs, cwd: '/proj', registry });
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(REDIRECT_LINE);
  });

  it('throws NotImplementedError when the redirect target lands outside the alias shim range', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const registry = new FakeRegistry(
      db(['@esbuild/wasi-preview1', await makeEntry('@esbuild/wasi-preview1', '0.29.0')]),
    );
    await expect(
      install(
        'root',
        '1.0.0',
        { esbuild: '*' },
        {
          vfs,
          cwd: '/proj',
          registry,
          overrides: { esbuild: '@esbuild/wasi-preview1@0.29.0' },
        },
      ),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      message: expect.stringContaining('shadow-registry.esbuild@0.29.0'),
    });
  });
});

describe('shadow-registry data consistency (npm-client is the semver-aware side)', () => {
  it('every baked alias override target version satisfies its internals-shim range', () => {
    for (const [source, shim] of Object.entries(internalsShims)) {
      if (!shim.into) continue;
      const override = resolveOverride(shim.into, undefined, {});
      expect(override?.name).toBe(source);
      // Baked alias overrides pin an exact target version; it must be in range.
      expect(override?.range && matchesRange(override.range, shim.range)).toBe(true);
    }
  });
});
