import { describe, expect, it } from 'vitest';
import { type SnapshotSource, collectSnapshot } from './vfs-snapshot-port.ts';

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
    const paths = frame.entries.map((e) => `${e.kind === 'dir' ? 'D' : 'F'} ${e.path}`);
    // `src` (dir) sorts before the root-level files; its child follows immediately.
    expect(paths).toEqual([
      'D /workspace/src',
      'F /workspace/src/main.js',
      'F /workspace/index.html',
      'F /workspace/package.json',
    ]);
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
    const small = frame.entries.find((e) => e.path === '/workspace/small.txt');
    expect(small?.content).toBeDefined();
  });
});
