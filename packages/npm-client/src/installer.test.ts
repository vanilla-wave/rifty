import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
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
    const [, encodedName, version] = match;
    const name = decodeURIComponent(encodedName ?? '');
    const entry = this.db.get(name)?.get(version ?? '');
    if (!entry) throw new Error(`fake registry: no tarball for ${tarballUrl}`);
    return entry.tarball;
  }
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

  it('ignores registry package prepare scripts because tarballs are already prepared', async () => {
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

  it('uses the baked esbuild override before the registry lifecycle gate', async () => {
    const db = new Map<string, Map<string, FakeRegistryEntry>>();
    db.set(
      'esbuild',
      new Map([
        [
          '0.21.5',
          await makeEntry('esbuild', '0.21.5', {}, { scripts: { postinstall: 'node install.js' } }),
        ],
      ]),
    );
    db.set(
      '@esbuild/wasi-preview1',
      new Map([
        ['0.28.0', await makeEntry('@esbuild/wasi-preview1', '0.28.0', {}, { cpu: ['wasm'] })],
      ]),
    );

    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { esbuild: '0.21.5' },
      }),
    );

    const result = await install({ vfs, cwd: '/proj', registry: new FakeRegistry(db) });

    expect(result.packages.map((p) => `${p.name}@${p.version}`)).toEqual([
      '@esbuild/wasi-preview1@0.28.0',
    ]);
    expect(await vfs.exists('/proj/node_modules/@esbuild/wasi-preview1/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/esbuild/package.json')).toBe(false);
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
