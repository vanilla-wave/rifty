import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    const root = temp();
    writeFileSync(join(root, 'snapshot.tar.gz'), gzipSync(bytes));
    const entries = execFileSync('tar', ['-tzf', join(root, 'snapshot.tar.gz')], {
      encoding: 'utf8',
    });
    expect(entries).toContain('rifty/manifest.json');
    expect(entries).toContain('payload/node_modules/rifty/manifest.json');
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

  it.each(['checksum', 'truncated', 'symlink', 'duplicate', 'traversal', 'ancestor', 'control'])(
    '[fault: poisoned-artifact] rejects %s before destination effects',
    async (fault) => {
      let tar = standardTar(
        fault === 'control' ? { 'rifty/unknown': enc.encode('unexpected') } : {},
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
      if (fault === 'symlink' || fault === 'traversal' || fault === 'ancestor') {
        const header = tar.subarray(offset, offset + 512);
        if (fault === 'symlink') header[156] = 50;
        else {
          header.fill(0, 0, 100);
          header.set(
            enc.encode(fault === 'traversal' ? 'payload/../escaped' : 'payload/node_modules'),
          );
        }
        header.fill(32, 148, 156);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.set(enc.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
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
    },
  );
});
