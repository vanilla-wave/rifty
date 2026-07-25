import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerVfsAuthority } from '../workers/owner-vfs-authority.ts';
import {
  SNAPSHOT_MAX_CONTENT_BYTES,
  type SnapshotSource,
  type VfsSnapshotFrame,
  collectSnapshot,
  publishVfsSnapshot,
  requestVfsSnapshot,
  serveSnapshotRequests,
  subscribeVfsSnapshot,
} from './vfs-snapshot-port.ts';

const enc = new TextEncoder();

/**
 * Minimal in-memory fake of the sync-mirror slice {@link collectSnapshot} reads.
 * `files` maps absolute path → bytes; directories are inferred from the paths.
 */
function fakeFs(
  files: Record<string, Uint8Array>,
  bigFiles: Record<string, number> = {},
): {
  fs: SnapshotSource;
} {
  const allPaths = [...Object.keys(files), ...Object.keys(bigFiles)];
  const dirs = new Set<string>();
  for (const p of allPaths) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) dirs.add(`/${parts.slice(0, i).join('/')}`);
  }
  const childrenOf = (dir: string): { name: string; isFile: boolean; isDirectory: boolean }[] => {
    const out = new Map<string, boolean>(); // name → isDir
    for (const d of dirs) {
      if (d !== dir && d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes('/')) {
        out.set(d.slice(dir.length + 1), true);
      }
    }
    for (const f of allPaths) {
      if (f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')) {
        out.set(f.slice(dir.length + 1), false);
      }
    }
    return [...out].map(([name, isDir]) => ({ name, isFile: !isDir, isDirectory: isDir }));
  };
  const fs: SnapshotSource = {
    ownerEpoch: 'snapshot-owner',
    treeRevision: 41,
    versionOf: (path) => `version:${path}`,
    readdirSync: (path) => childrenOf(path),
    statSync: (path) => {
      if (dirs.has(path)) return { isFile: false, isDirectory: true, size: 0 };
      if (path in bigFiles) return { isFile: true, isDirectory: false, size: bigFiles[path] };
      const b = files[path];
      if (!b) throw new Error(`ENOENT ${path}`);
      return { isFile: true, isDirectory: false, size: b.byteLength };
    },
    readFileBytesSync: (path) => {
      const b = files[path];
      if (!b) throw new Error(`ENOENT ${path}`);
      return b;
    },
  };
  return { fs };
}

describe('collectSnapshot', () => {
  it('walks the project tree, dirs before files, with inlined small-file content', () => {
    const { fs } = fakeFs({
      '/workspace/index.html': enc.encode('<html></html>'),
      '/workspace/package.json': enc.encode('{}'),
      '/workspace/src/main.js': enc.encode('console.log(1)'),
    });
    const frame = collectSnapshot(fs, '/workspace');

    expect(frame.type).toBe('snapshot');
    expect(frame.root).toBe('/workspace');
    expect(frame.ownerEpoch).toBe('snapshot-owner');
    expect(frame.treeRevision).toBe(41);
    const paths = frame.entries.map((e) => `${e.kind === 'dir' ? 'D' : 'F'} ${e.path}`);
    // `src` (dir) sorts before the root-level files; its child follows immediately.
    expect(paths).toEqual([
      'D /workspace/src',
      'F /workspace/src/main.js',
      'F /workspace/index.html',
      'F /workspace/package.json',
    ]);
    expect(frame.entries.map((entry) => entry.version)).toEqual(
      frame.entries.map((entry) => `version:${entry.path}`),
    );
    const main = frame.entries.find((e) => e.path === '/workspace/src/main.js');
    expect(main?.content && new TextDecoder().decode(main.content)).toBe('console.log(1)');
  });

  it('excludes node_modules (and friends) but flags its presence', () => {
    const { fs } = fakeFs({
      '/workspace/index.html': enc.encode('x'),
      '/workspace/node_modules/vite/index.js': enc.encode('big lib'),
      '/workspace/.git/config': enc.encode('git'),
    });
    const frame = collectSnapshot(fs, '/workspace');

    const paths = frame.entries.map((e) => e.path);
    expect(paths).toContain('/workspace/index.html');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.includes('.git'))).toBe(false);
    expect(frame.nodeModulesPresent).toBe(true);
  });

  it('sends size only (no content) for files over the cap', () => {
    const { fs } = fakeFs(
      { '/workspace/small.txt': enc.encode('hi') },
      { '/workspace/big.bin': 5_000_000 },
    );
    const frame = collectSnapshot(fs, '/workspace', { maxContentBytes: 1024 });

    const big = frame.entries.find((e) => e.path === '/workspace/big.bin');
    expect(big?.kind).toBe('file');
    expect(big?.size).toBe(5_000_000);
    expect(big?.content).toBeUndefined();
    expect(big?.contentOmitted).toBe('size-cap');
    expect(big?.version).toBe('version:/workspace/big.bin');
    const small = frame.entries.find((e) => e.path === '/workspace/small.txt');
    expect(small?.content).toBeDefined();
  });

  it('reflects a same-size large write by owner revision and opaque versions', () => {
    const authority = createOwnerVfsAuthority(new MemoryFsSync(), {
      ownerEpoch: 'real-snapshot-owner',
    });
    authority.mkdirSync('/workspace/src', { recursive: true });
    const firstBytes = new Uint8Array(SNAPSHOT_MAX_CONTENT_BYTES + 1).fill(0x11);
    authority.writeFileSync('/workspace/src/large.bin', firstBytes);

    const first = collectSnapshot(authority, '/workspace');
    const firstLarge = first.entries.find((entry) => entry.path.endsWith('/large.bin'));
    expect(first).toMatchObject({
      ownerEpoch: 'real-snapshot-owner',
      treeRevision: authority.treeRevision,
    });
    expect(first.entries.every((entry) => entry.version === authority.versionOf(entry.path))).toBe(
      true,
    );
    expect(firstLarge).toMatchObject({
      kind: 'file',
      size: firstBytes.byteLength,
      contentOmitted: 'size-cap',
    });
    expect(firstLarge?.content).toBeUndefined();

    authority.writeFileSync(
      '/workspace/src/large.bin',
      new Uint8Array(firstBytes.byteLength).fill(0x22),
    );
    const second = collectSnapshot(authority, '/workspace');
    const secondLarge = second.entries.find((entry) => entry.path.endsWith('/large.bin'));
    expect(second.treeRevision).toBe(first.treeRevision + 1);
    expect(secondLarge?.version).not.toBe(firstLarge?.version);
    expect(secondLarge?.content).toBeUndefined();
    expect(secondLarge?.contentOmitted).toBe('size-cap');
  });

  it.each(['readdirSync', 'statSync', 'readFileBytesSync'] as const)(
    'fails the whole collection when %s fails instead of certifying a partial revision',
    (faultAt) => {
      const { fs } = fakeFs({ '/workspace/state.txt': enc.encode('owner') });
      const fault = new Error(`${faultAt} denied`);
      const faulted: SnapshotSource = {
        ...fs,
        readdirSync(path) {
          if (faultAt === 'readdirSync') throw fault;
          return fs.readdirSync(path);
        },
        statSync(path) {
          if (faultAt === 'statSync') throw fault;
          return fs.statSync(path);
        },
        readFileBytesSync(path) {
          if (faultAt === 'readFileBytesSync') throw fault;
          return fs.readFileBytesSync(path);
        },
      };

      expect(() => collectSnapshot(faulted, '/workspace')).toThrow(fault);
    },
  );

  it.each(['treeRevision', 'ownerEpoch'] as const)(
    'rejects a collection when %s changes during the synchronous walk',
    (changedIdentity) => {
      const { fs } = fakeFs({ '/workspace/state.txt': enc.encode('before') });
      let ownerEpoch = 'snapshot-owner';
      let treeRevision = 41;
      let injected = false;
      const reentrant: SnapshotSource = {
        ...fs,
        get ownerEpoch() {
          return ownerEpoch;
        },
        get treeRevision() {
          return treeRevision;
        },
        readFileBytesSync(path) {
          if (!injected) {
            injected = true;
            if (changedIdentity === 'treeRevision') treeRevision += 1;
            else ownerEpoch = 'replacement-owner';
          }
          return fs.readFileBytesSync(path);
        },
      };

      expect(() => collectSnapshot(reentrant, '/workspace')).toThrow(
        /owner identity changed during snapshot collection/,
      );
    },
  );
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

const sampleFrame = (root: string): VfsSnapshotFrame => ({
  type: 'snapshot',
  root,
  ownerEpoch: 'sample-owner',
  treeRevision: 1,
  entries: [
    {
      path: `${root}/x.txt`,
      kind: 'file',
      size: 1,
      version: 'sample-version',
      content: new Uint8Array([0]),
    },
  ],
  nodeModulesPresent: false,
});

describe('snapshot readiness handshake', () => {
  it('owner publishes on a page snapshot-req (replaces the blind retry-storm)', async () => {
    const port = 59401;
    let published = 0;
    const teardown = serveSnapshotRequests(port, () => {
      published += 1;
    });

    requestVfsSnapshot(port);
    await flush();

    expect(published).toBe(1);
    teardown();
  });

  it('round-trips: page request → owner publishes → page receives the snapshot', async () => {
    const port = 59402;
    const received: VfsSnapshotFrame[] = [];
    const unsubscribe = subscribeVfsSnapshot(port, (frame) => received.push(frame));
    // The owner answers a request by publishing its current tree.
    const serve = serveSnapshotRequests(port, () =>
      publishVfsSnapshot(port, sampleFrame('/workspace')),
    );

    requestVfsSnapshot(port);
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]?.root).toBe('/workspace');
    serve();
    unsubscribe();
  });

  it('subscribeVfsSnapshot ignores the page→owner snapshot-req frame', async () => {
    const port = 59403;
    const received: VfsSnapshotFrame[] = [];
    const unsubscribe = subscribeVfsSnapshot(port, (frame) => received.push(frame));

    requestVfsSnapshot(port);
    await flush();

    expect(received).toHaveLength(0);
    unsubscribe();
  });
});
