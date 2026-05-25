import { MemoryVfs } from '@rifty/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install } from './installer.ts';
import type { Packument, VersionManifest } from './registry.ts';
import { RegistryClient } from './registry.ts';

const enc = new TextEncoder();

function writeStr(buf: Uint8Array, str: string, off: number, len: number): void {
  const b = enc.encode(str);
  buf.set(b.subarray(0, Math.min(b.length, len)), off);
}

function buildHeader(name: string, size: number, typeFlag: string): Uint8Array {
  const h = new Uint8Array(512);
  writeStr(h, name, 0, 100);
  writeStr(h, '0000644', 100, 7);
  writeStr(h, '0000000', 108, 7);
  writeStr(h, '0000000', 116, 7);
  writeStr(h, size.toString(8).padStart(11, '0'), 124, 11);
  h[135] = 0x20;
  writeStr(h, '00000000000', 136, 11);
  h[147] = 0x20;
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  h[156] = typeFlag.charCodeAt(0);
  writeStr(h, 'ustar', 257, 6);
  writeStr(h, '00', 263, 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i] ?? 0;
  writeStr(h, sum.toString(8).padStart(6, '0'), 148, 6);
  h[154] = 0x00;
  h[155] = 0x20;
  return h;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function makePackageTarball(pkgName: string, version: string): Promise<Uint8Array> {
  const manifestBytes = enc.encode(JSON.stringify({ name: pkgName, version }));
  const header = buildHeader('package/package.json', manifestBytes.length, '0');
  const bodyBlocks = Math.ceil(manifestBytes.length / 512);
  const body = new Uint8Array(bodyBlocks * 512);
  body.set(manifestBytes);
  const trailer = new Uint8Array(1024);
  const total = new Uint8Array(header.length + body.length + trailer.length);
  total.set(header, 0);
  total.set(body, header.length);
  total.set(trailer, header.length + body.length);
  return await gzip(total);
}

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
});
