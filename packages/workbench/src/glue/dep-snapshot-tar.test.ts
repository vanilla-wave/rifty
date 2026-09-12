import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as codec from './dep-snapshot.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const roots: string[] = [];
const packageJsonText = '{"name":"caller","dependencies":{}}';
const lockfile = '{"lockfileVersion":3,"packages":{"":{}}}';
const manifest = {
  version: 4,
  templateId: 'caller',
  packages: 0,
  deps: {},
  installArtifactIdentity,
};

function temp(): string {
  const root = mkdtempSync(join(tmpdir(), 'rifty-snapshot-tar-'));
  roots.push(root);
  return root;
}

function standardTar(extra: Record<string, Uint8Array> = {}): Uint8Array {
  const root = temp();
  const entries: Record<string, Uint8Array> = {
    'rifty/manifest.json': enc.encode(JSON.stringify(manifest)),
    'payload/package.json': enc.encode(packageJsonText),
    'payload/package-lock.json': enc.encode(lockfile),
    'payload/node_modules/rifty/manifest.json': enc.encode('user control name'),
    'payload/node_modules/payload/blob.bin': new Uint8Array([0, 255, 127, 128]),
    ...extra,
  };
  for (const [path, bytes] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  mkdirSync(join(root, 'payload/node_modules/empty'), { recursive: true });
  execFileSync(
    'tar',
    [
      '--format=pax',
      '-cf',
      join(root, 'snapshot.tar'),
      '-C',
      root,
      ...Object.keys(entries),
      'payload/node_modules/empty',
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  return new Uint8Array(readFileSync(join(root, 'snapshot.tar')));
}

function fileOffset(tar: Uint8Array, name: string): number {
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const actual = dec.decode(header.subarray(0, 100)).split('\0')[0];
    if (actual === name && header[156] === 48) return offset;
    const size = Number.parseInt(dec.decode(header.subarray(124, 136)), 8) || 0;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`System tar omitted regular file ${name}`);
}

function tarHeaders(tar: Uint8Array): Array<{ offset: number; header: Uint8Array }> {
  const headers: Array<{ offset: number; header: Uint8Array }> = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    headers.push({ offset, header });
    const size = Number.parseInt(dec.decode(header.subarray(124, 136)), 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return headers;
}

function repairChecksum(header: Uint8Array): void {
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(enc.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
}

function serve(bytes: Uint8Array): void {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(bytes).buffer));
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('producer tar snapshot envelope', () => {
  it.each(['tar', 'gzip'])(
    'reads standard %s, separating user/control names and preserving bytes',
    async (wire) => {
      const longPath = `node_modules/${'long-'.repeat(40)}/日本語.txt`;
      const tar = standardTar({ [`payload/${longPath}`]: enc.encode('long UTF-8 path') });
      serve(wire === 'gzip' ? gzipSync(tar) : tar);
      const snapshot = await codec.fetchDepSnapshot('https://host.test/snapshot.tar.gz');
      expect(snapshot.installArtifactIdentity).toBe(installArtifactIdentity);
      expect(snapshot.packageJsonText).toBe(packageJsonText);
      const fs = new MemoryFsSync();
      fs.mkdirSync('/project', { recursive: true });
      await codec.restoreDepSnapshot(fs, '/project', snapshot);
      expect(dec.decode(fs.readFileBytesSync('/project/node_modules/rifty/manifest.json'))).toBe(
        'user control name',
      );
      expect([...fs.readFileBytesSync('/project/node_modules/payload/blob.bin')]).toEqual([
        0, 255, 127, 128,
      ]);
      expect(dec.decode(fs.readFileBytesSync(`/project/${longPath}`))).toBe('long UTF-8 path');
      expect(fs.existsSync('/project/node_modules/empty')).toBe(true);
      expect(fs.existsSync('/project/rifty')).toBe(false);
      expect(dec.decode(fs.readFileBytesSync('/project/package-lock.json'))).toBe(lockfile);
    },
  );

  it('preserves literal POSIX backslashes already admitted by Memory VFS', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules/pkg', { recursive: true });
    fs.writeFileSync('/project/package.json', enc.encode(packageJsonText));
    fs.writeFileSync('/project/package-lock.json', enc.encode(lockfile));
    const path = '/project/node_modules/pkg/back\\slash.txt';
    fs.writeFileSync(path, enc.encode('literal name'));
    const snapshot = codec.buildDepSnapshot(fs, '/project', {
      templateId: 'caller',
      deps: {},
      packages: 0,
    });
    const tar = codec.serializeDepSnapshotTar(snapshot);
    serve(tar);
    const restored = new MemoryFsSync();
    await codec.restoreDepSnapshot(
      restored,
      '/project',
      await codec.fetchDepSnapshot('https://host.test/snapshot'),
    );
    expect(dec.decode(restored.readFileBytesSync(path))).toBe('literal name');
    const root = temp();
    writeFileSync(join(root, 'snapshot.tar'), tar);
    execFileSync('tar', ['-xf', join(root, 'snapshot.tar'), '-C', root]);
    expect(readFileSync(join(root, 'payload/node_modules/pkg/back\\slash.txt'), 'utf8')).toBe(
      'literal name',
    );
  });

  it('writes deterministic standard tar entries ordinary tools extract', () => {
    const serialize = (
      codec as unknown as {
        serializeDepSnapshotTar?: (snapshot: codec.DepSnapshotV3) => Uint8Array;
      }
    ).serializeDepSnapshotTar;
    expect(serialize, 'tar serializer is available').toBeTypeOf('function');
    if (!serialize) throw new Error('tar serializer missing');
    const snapshot: codec.DepSnapshotV3 = {
      ...manifest,
      version: 3,
      packageJsonText,
      lockfile,
      tarballCache: { version: 1, root: '/.rifty/tarball-cache', files: [] },
      nodeModules: {
        version: 1,
        root: '/workspace/node_modules',
        directories: ['empty', 'empty/deep'],
        files: [
          {
            path: `${'long-'.repeat(40)}/日本語.txt`,
            encoding: 'base64',
            content: btoa('long bytes'),
          },
          { path: 'rifty/manifest.json', encoding: 'base64', content: btoa('user metadata') },
        ],
      },
    };
    const bytes = serialize(snapshot);
    expect(serialize(snapshot)).toEqual(bytes);
    expect(
      serialize({
        ...snapshot,
        nodeModules: {
          ...snapshot.nodeModules,
          files: [...snapshot.nodeModules.files].reverse(),
          directories: [...(snapshot.nodeModules.directories ?? [])].reverse(),
        },
      }),
    ).toEqual(bytes);
    for (const { header } of tarHeaders(bytes)) {
      expect(Number.parseInt(dec.decode(header.subarray(100, 108)), 8)).toBe(
        header[156] === 53 ? 0o755 : 0o644,
      );
      for (const [start, end] of [
        [108, 116],
        [116, 124],
        [136, 148],
      ]) {
        expect(Number.parseInt(dec.decode(header.subarray(start, end)), 8)).toBe(0);
      }
      expect(header.subarray(265, 329).every((byte) => byte === 0)).toBe(true);
    }
    const root = temp();
    writeFileSync(join(root, 'snapshot.tar.gz'), gzipSync(bytes));
    const entries = execFileSync('tar', ['-tzf', join(root, 'snapshot.tar.gz')], {
      encoding: 'utf8',
    });
    expect(entries).toContain('rifty/manifest.json');
    expect(entries).toContain('payload/node_modules/rifty/manifest.json');
    expect(entries).toContain('payload/node_modules/empty/deep/');
    const paths = entries.trim().split('\n');
    expect(paths).toEqual([...paths].sort());
    execFileSync('tar', ['-xzf', join(root, 'snapshot.tar.gz'), '-C', root]);
    expect(readFileSync(join(root, 'payload/node_modules/rifty/manifest.json'), 'utf8')).toBe(
      'user metadata',
    );
    expect(
      readFileSync(join(root, `payload/node_modules/${'long-'.repeat(40)}/日本語.txt`), 'utf8'),
    ).toBe('long bytes');
    expect(JSON.parse(readFileSync(join(root, 'rifty/manifest.json'), 'utf8')).version).toBe(4);
    expect(readFileSync(join(root, 'payload/package.json'), 'utf8')).toBe(packageJsonText);
  });

  it('canonicalizes dependency key order while retaining exact manifest text', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules/empty/deep', { recursive: true });
    fs.writeFileSync('/project/package.json', enc.encode('{"dependencies":{"z":"1","a":"2"}}'));
    const snapshot = codec.buildDepSnapshot(fs, '/project', {
      templateId: 'caller',
      packages: 0,
      deps: { z: '1', a: '2' },
    });
    expect(codec.serializeDepSnapshotTar({ ...snapshot, deps: { a: '2', z: '1' } })).toEqual(
      codec.serializeDepSnapshotTar(snapshot),
    );
    expect(snapshot.nodeModules.directories).toContain('empty/deep');
  });

  it('[fault: poisoned-artifact] reports corrupt gzip at the decompression boundary', async () => {
    const gzip = gzipSync(standardTar());
    const crc = gzip[gzip.length - 8];
    if (crc === undefined) throw new Error('gzip fixture omitted its checksum');
    gzip[gzip.length - 8] = crc ^ 0xff;
    serve(gzip);
    await expect(codec.fetchDepSnapshot('https://host.test/snapshot')).rejects.toMatchObject({
      code: 'DEP_SNAPSHOT_FETCH_FAILED',
      stage: 'decompress',
    });
  });

  it('verifies snapshot identity over decoded tar for raw gzip and HTTP-decoded delivery', async () => {
    const tar = standardTar();
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', tar.slice().buffer)).toString(
      'hex',
    );
    for (const bytes of [tar, gzipSync(tar)]) {
      serve(bytes);
      expect(
        (await codec.fetchVerifiedDepSnapshot('https://host.test/snapshot', `sha256:${hash}`))
          .status,
      ).toBe('matched');
      expect(
        (
          await codec.fetchVerifiedDepSnapshot(
            'https://host.test/snapshot',
            `sha256:${'0'.repeat(64)}`,
          )
        ).status,
      ).toBe('mismatch');
    }
  });

  it.each([
    'checksum',
    'truncated',
    'symlink',
    'hardlink',
    'duplicate',
    'traversal',
    'ancestor',
    'control',
    'extra-payload',
    'header',
    'size',
    'terminator',
    'trailing-data',
  ])('[fault: poisoned-artifact] rejects %s before destination effects', async (fault) => {
    let tar = standardTar(
      fault === 'control'
        ? { 'rifty/unknown': enc.encode('unexpected') }
        : fault === 'extra-payload'
          ? { 'payload/unknown': enc.encode('unexpected') }
          : {},
    );
    const offset = fileOffset(tar, 'payload/node_modules/rifty/manifest.json');
    if (fault === 'checksum') tar[offset] = 88;
    if (fault === 'truncated') tar = tar.slice(0, 700);
    if (fault === 'duplicate')
      tar = new Uint8Array([
        ...tar.slice(0, offset),
        ...tar.slice(offset, offset + 1024),
        ...tar.slice(offset),
      ]);
    if (fault === 'terminator') {
      const last = tarHeaders(tar).at(-1);
      if (!last) throw new Error('system tar omitted entries');
      const size = Number.parseInt(dec.decode(last.header.subarray(124, 136)), 8);
      tar = tar.slice(0, last.offset + 512 + Math.ceil(size / 512) * 512 + 512);
    }
    if (fault === 'trailing-data') tar[tar.length - 1] = 1;
    if (['symlink', 'hardlink', 'traversal', 'ancestor', 'header', 'size'].includes(fault)) {
      const header = tar.subarray(offset, offset + 512);
      if (fault === 'symlink') header[156] = 50;
      else if (fault === 'hardlink') header[156] = 49;
      else if (fault === 'header') header[257] = 88;
      else if (fault === 'size') header[124] = 57;
      else {
        header.fill(0, 0, 100);
        header.set(
          enc.encode(fault === 'traversal' ? 'payload/../escaped' : 'payload/node_modules'),
        );
      }
      repairChecksum(header);
    }
    serve(tar);
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/keep', enc.encode('saved'));
    await expect(
      (async () =>
        codec.restoreDepSnapshot(
          fs,
          '/project',
          await codec.fetchDepSnapshot('https://host.test/snapshot'),
        ))(),
    ).rejects.toThrow();
    expect(dec.decode(fs.readFileBytesSync('/project/keep'))).toBe('saved');
    expect(fs.readdirSync('/project').map((entry) => entry.name)).toEqual(['keep']);
  });

  it.each(['path', 'length'])(
    '[fault: poisoned-artifact] rejects poisoned PAX %s',
    async (fault) => {
      const longPath = `payload/node_modules/${'long-'.repeat(40)}/日本語.txt`;
      const tar = standardTar({ [longPath]: enc.encode('long') });
      const extended = tarHeaders(tar).find(
        ({ offset, header }) =>
          header[156] === 120 &&
          dec.decode(tar.subarray(offset + 512, offset + 1024)).includes(`path=${longPath}`),
      );
      if (!extended) throw new Error('system tar omitted PAX path');
      const body = tar.subarray(extended.offset + 512, extended.offset + 1024);
      if (fault === 'length') body[0] = 57;
      else {
        const nameOffset = Buffer.from(body).indexOf(enc.encode(longPath));
        body.set(enc.encode('../evil/'), nameOffset);
      }
      serve(tar);
      await expect(codec.fetchDepSnapshot('https://host.test/snapshot')).rejects.toMatchObject({
        code: 'DEP_SNAPSHOT_FETCH_FAILED',
        stage: 'parse',
      });
    },
  );
});
