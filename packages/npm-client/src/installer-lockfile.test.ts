import { NotImplementedError } from '@rifty/io';
import { MemoryVfs, joinPath } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
import { readExistingLockfile } from './installer-lockfile-reader.ts';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

const enc = new TextEncoder();

/**
 * Build a minimal POSIX `ustar` tar with one regular file `package/package.json`
 * carrying the given (name, version). Enough for `extractTarGz` to round-trip.
 */
function buildTar(name: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const writeStr = (str: string, off: number, len: number) => {
    const bytes = enc.encode(str);
    header.set(bytes.subarray(0, Math.min(bytes.length, len)), off);
  };
  writeStr(name, 0, 100);
  writeStr('0000644', 100, 7);
  writeStr('0000000', 108, 7);
  writeStr('0000000', 116, 7);
  writeStr(body.length.toString(8).padStart(11, '0'), 124, 11);
  header[135] = 0x20;
  writeStr('00000000000', 136, 11);
  header[147] = 0x20;
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30;
  writeStr('ustar', 257, 6);
  writeStr('00', 263, 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  writeStr(sum.toString(8).padStart(6, '0'), 148, 6);
  header[154] = 0x00;
  header[155] = 0x20;
  const bodyBlocks = Math.ceil(body.length / 512);
  const bodyBuf = new Uint8Array(bodyBlocks * 512);
  bodyBuf.set(body);
  const trailer = new Uint8Array(1024);
  const total = new Uint8Array(header.length + bodyBuf.length + trailer.length);
  total.set(header, 0);
  total.set(bodyBuf, header.length);
  total.set(trailer, header.length + bodyBuf.length);
  return total;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makePackageTarball(pkgName: string, version: string): Promise<Uint8Array> {
  const manifest = enc.encode(JSON.stringify({ name: pkgName, version }));
  const tar = buildTar('package/package.json', manifest);
  return await gzip(tar);
}

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
