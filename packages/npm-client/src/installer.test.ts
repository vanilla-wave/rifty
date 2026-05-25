import { MemoryVfs } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

/**
 * Build a minimal POSIX `ustar`-style tar containing a single regular file
 * `package/<name>`. Just enough that `extractTarGz` produces an entry.
 */
function buildTar(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  const writeStr = (str: string, off: number, len: number) => {
    const bytes = enc.encode(str);
    header.set(bytes.subarray(0, Math.min(bytes.length, len)), off);
  };
  writeStr(name, 0, 100);
  writeStr('0000644', 100, 7); // mode
  writeStr('0000000', 108, 7); // uid
  writeStr('0000000', 116, 7); // gid
  // size as 11-octal-digits + space
  const sizeOctal = content.length.toString(8).padStart(11, '0');
  writeStr(sizeOctal, 124, 11);
  header[135] = 0x20;
  writeStr('00000000000', 136, 11); // mtime
  header[147] = 0x20;
  // checksum placeholder = 8 spaces
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30; // typeflag '0' = regular file
  writeStr('ustar', 257, 6);
  writeStr('00', 263, 2);
  // checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  const cksum = sum.toString(8).padStart(6, '0');
  writeStr(cksum, 148, 6);
  header[154] = 0x00;
  header[155] = 0x20;

  // body padded to next 512-byte block + two trailing zero blocks per tar spec
  const bodyBlocks = Math.ceil(content.length / 512);
  const body = new Uint8Array(bodyBlocks * 512);
  body.set(content);
  const trailer = new Uint8Array(1024);
  const total = new Uint8Array(header.length + body.length + trailer.length);
  total.set(header, 0);
  total.set(body, header.length);
  total.set(trailer, header.length + body.length);
  return total;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function makePackageTarball(pkgName: string, version: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const manifest = enc.encode(JSON.stringify({ name: pkgName, version }));
  const tar = buildTar('package/package.json', manifest);
  return await gzip(tar);
}

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

describe('install — version conflict', () => {
  it('throws EVERSIONCONFLICT when two deps require incompatible versions of the same transitive package', async () => {
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

    let caught: unknown;
    try {
      await install(
        'root',
        '1.0.0',
        { a: '1.0.0', b: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry,
        },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & {
      code?: string;
      packageName?: string;
      firstVersion?: string;
      secondVersion?: string;
    };
    expect(err.code).toBe('EVERSIONCONFLICT');
    expect(err.packageName).toBe('c');
    expect(err.firstVersion).toBe('1.0.0');
    expect(err.secondVersion).toBe('2.0.0');
    expect(err.message).toContain('Conflicting versions of c');
    expect(err.message).toContain('1.0.0');
    expect(err.message).toContain('2.0.0');
  });
});
