import { type Fetcher, type Packument, RegistryClient, install } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
/**
 * End-to-end install against a mock registry. Builds a packument + tarball
 * in-memory, runs the installer, verifies node_modules layout + lockfile.
 */
import { describe, expect, it } from 'vitest';

function makeTarGz(files: Record<string, string>): Uint8Array {
  // Build a minimal POSIX tar archive in memory, then gzip it.
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const data = enc.encode(content);
    const header = new Uint8Array(512);
    const fullName = `package/${path}`;
    header.set(enc.encode(fullName), 0);
    header.set(enc.encode('0000644 '), 100);
    header.set(enc.encode('0000000 '), 108);
    header.set(enc.encode('0000000 '), 116);
    header.set(enc.encode(`${data.length.toString(8).padStart(11, '0')} `), 124);
    header.set(enc.encode('00000000000 '), 136);
    header.set(enc.encode('        '), 148); // checksum placeholder
    header[156] = 0x30; // '0' = regular file
    // ustar magic
    header.set(enc.encode('ustar  '), 257);
    // compute checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
    const checksumStr = sum.toString(8).padStart(6, '0');
    header.set(enc.encode(checksumStr), 148);
    header[154] = 0;
    header[155] = 0x20;

    blocks.push(header);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  const tar = concat(blocks);
  return gzip(tar);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function gzip(bytes: Uint8Array): Uint8Array {
  // CompressionStream is available in Node 18+ and modern browsers.
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  // We can't await here synchronously; the helper returns a Promise.
  // Hide the async behind a thenable so the test code stays terse.
  throw new Error('gzip is async; use gzipAsync');
}

async function gzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeTarGzAsync(files: Record<string, string>): Promise<Uint8Array> {
  // Inline the body of makeTarGz but use gzipAsync.
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const data = enc.encode(content);
    const header = new Uint8Array(512);
    const fullName = `package/${path}`;
    header.set(enc.encode(fullName), 0);
    header.set(enc.encode('0000644 '), 100);
    header.set(enc.encode('0000000 '), 108);
    header.set(enc.encode('0000000 '), 116);
    header.set(enc.encode(`${data.length.toString(8).padStart(11, '0')} `), 124);
    header.set(enc.encode('00000000000 '), 136);
    header.set(enc.encode('        '), 148);
    header[156] = 0x30;
    header.set(enc.encode('ustar  '), 257);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
    const checksumStr = sum.toString(8).padStart(6, '0');
    header.set(enc.encode(checksumStr), 148);
    header[154] = 0;
    header[155] = 0x20;

    blocks.push(header);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  const tar = concat(blocks);
  return await gzipAsync(tar);
}

async function makeFetcher(
  packuments: Record<string, Packument>,
  tarballs: Record<string, Uint8Array>,
): Promise<Fetcher> {
  return async (url: string): Promise<Response> => {
    if (url.startsWith('tarball:')) {
      const data = tarballs[url];
      if (!data) return new Response('', { status: 404 });
      return new Response(data as unknown as BodyInit, { status: 200 });
    }
    if (url.startsWith('packument:')) {
      const name = url.slice('packument:'.length).replace(/^\/+/, '');
      const p = packuments[name];
      if (!p) return new Response('', { status: 404 });
      return new Response(JSON.stringify(p), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };
}

describe('install — end to end with mock registry', () => {
  it('installs a single package with no deps', async () => {
    const tarball = await makeTarGzAsync({
      'package.json': JSON.stringify({ name: 'tiny', version: '1.0.0', main: './index.js' }),
      'index.js': 'module.exports = "tiny v1";',
    });
    const packuments: Record<string, Packument> = {
      tiny: {
        name: 'tiny',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'tiny',
            version: '1.0.0',
            dist: { tarball: 'tarball:tiny-1.0.0.tgz' },
          },
        },
      },
    };
    const tarballs: Record<string, Uint8Array> = { 'tarball:tiny-1.0.0.tgz': tarball };
    const fetcher = await makeFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch: fetcher });

    const vfs = new MemoryVfs();
    const result = await install(
      'root',
      '0.0.0',
      { tiny: '^1.0.0' },
      {
        vfs,
        cwd: '/app',
        registry,
      },
    );
    expect(result.packages.length).toBe(1);
    expect(result.packages[0]?.version).toBe('1.0.0');
    expect(await vfs.readFileText('/app/node_modules/tiny/index.js')).toBe(
      'module.exports = "tiny v1";',
    );
    expect(await vfs.exists('/app/package-lock.json')).toBe(true);
  });

  it('resolves transitive deps', async () => {
    const tinyTarball = await makeTarGzAsync({
      'package.json': JSON.stringify({ name: 'tiny', version: '1.0.0', main: './index.js' }),
      'index.js': 'module.exports = 1;',
    });
    const wrapperTarball = await makeTarGzAsync({
      'package.json': JSON.stringify({
        name: 'wrapper',
        version: '2.0.0',
        main: './index.js',
        dependencies: { tiny: '^1.0.0' },
      }),
      'index.js': "module.exports = require('tiny') + 1;",
    });
    const packuments: Record<string, Packument> = {
      tiny: {
        name: 'tiny',
        versions: {
          '1.0.0': { name: 'tiny', version: '1.0.0', dist: { tarball: 'tarball:tiny.tgz' } },
        },
      },
      wrapper: {
        name: 'wrapper',
        versions: {
          '2.0.0': {
            name: 'wrapper',
            version: '2.0.0',
            dependencies: { tiny: '^1.0.0' },
            dist: { tarball: 'tarball:wrapper.tgz' },
          },
        },
      },
    };
    const tarballs = { 'tarball:tiny.tgz': tinyTarball, 'tarball:wrapper.tgz': wrapperTarball };
    const fetcher = await makeFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch: fetcher });
    const vfs = new MemoryVfs();
    const result = await install(
      'root',
      '0.0.0',
      { wrapper: '^2.0.0' },
      {
        vfs,
        cwd: '/app',
        registry,
      },
    );
    const names = result.packages.map((p) => p.name).sort();
    expect(names).toEqual(['tiny', 'wrapper']);
    expect(await vfs.exists('/app/node_modules/wrapper/index.js')).toBe(true);
    expect(await vfs.exists('/app/node_modules/tiny/index.js')).toBe(true);
  });

  it('writes a v3 lockfile', async () => {
    const tarball = await makeTarGzAsync({
      'package.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
      'index.js': 'module.exports = 1;',
    });
    const packuments: Record<string, Packument> = {
      p: {
        name: 'p',
        versions: { '1.0.0': { name: 'p', version: '1.0.0', dist: { tarball: 'tarball:p.tgz' } } },
      },
    };
    const tarballs = { 'tarball:p.tgz': tarball };
    const fetcher = await makeFetcher(packuments, tarballs);
    const registry = new RegistryClient({ baseUrl: 'packument:', fetch: fetcher });
    const vfs = new MemoryVfs();
    await install('root', '0.0.0', { p: '^1.0.0' }, { vfs, cwd: '/app', registry });
    const lockText = await vfs.readFileText('/app/package-lock.json');
    const lock = JSON.parse(lockText);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/p'].version).toBe('1.0.0');
  });
});
