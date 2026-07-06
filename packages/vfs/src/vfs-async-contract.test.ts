/**
 * Async `Vfs` backend contract — `describe.each` over BOTH implementations
 * (MemoryVfs and OpfsVfs on a full in-memory fake OPFS tree) so the async
 * surface cannot drift, mirroring what `fs-sync-strict-paths.test.ts` already
 * does for the FsSync backends. Review 2026-07-06 found two silent OpfsVfs
 * divergences the sync suite could never catch: non-recursive `mkdir` on an
 * existing dir succeeded (the final `create: true` masked EEXIST), and `stat`
 * ignored the very side-table `utimes` writes into (silent-success lie —
 * OpfsFsSync pairs the same tables).
 */
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from './memory.ts';
import { OpfsVfs } from './opfs.ts';
import type { Vfs } from './types.ts';

class FakeDomException extends Error {
  constructor(name: string, message = name) {
    super(message);
    this.name = name;
  }
}

interface FakeFile {
  kind: 'file';
  bytes: Uint8Array;
  lastModified: number;
}
interface FakeDir {
  kind: 'dir';
  children: Map<string, FakeFile | FakeDir>;
}

function makeFakeOpfsRoot(): FileSystemDirectoryHandle {
  const root: FakeDir = { kind: 'dir', children: new Map() };

  function fileHandle(f: FakeFile, name: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name,
      isSameEntry: () => Promise.resolve(false),
      getFile: () =>
        Promise.resolve({
          size: f.bytes.byteLength,
          lastModified: f.lastModified,
          arrayBuffer: () =>
            Promise.resolve(
              f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength),
            ),
        } as unknown as File),
      createWritable: () => {
        const chunks: Uint8Array[] = [];
        return Promise.resolve({
          write: (data: Uint8Array) => {
            chunks.push(data instanceof Uint8Array ? data.slice() : new Uint8Array(data));
            return Promise.resolve();
          },
          close: () => {
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) {
              merged.set(c, off);
              off += c.byteLength;
            }
            f.bytes = merged;
            f.lastModified = Date.now();
            return Promise.resolve();
          },
        } as unknown as FileSystemWritableFileStream);
      },
    } as unknown as FileSystemFileHandle;
  }

  function dirHandle(d: FakeDir, name: string): FileSystemDirectoryHandle {
    const handle = {
      kind: 'directory' as const,
      name,
      isSameEntry: () => Promise.resolve(false),
      getDirectoryHandle(child: string, o?: { create?: boolean }) {
        const n = d.children.get(child);
        if (n) {
          if (n.kind !== 'dir') return Promise.reject(new FakeDomException('TypeMismatchError'));
          return Promise.resolve(dirHandle(n, child));
        }
        if (!o?.create) return Promise.reject(new FakeDomException('NotFoundError'));
        const created: FakeDir = { kind: 'dir', children: new Map() };
        d.children.set(child, created);
        return Promise.resolve(dirHandle(created, child));
      },
      getFileHandle(child: string, o?: { create?: boolean }) {
        const n = d.children.get(child);
        if (n) {
          if (n.kind !== 'file') return Promise.reject(new FakeDomException('TypeMismatchError'));
          return Promise.resolve(fileHandle(n, child));
        }
        if (!o?.create) return Promise.reject(new FakeDomException('NotFoundError'));
        const created: FakeFile = { kind: 'file', bytes: new Uint8Array(), lastModified: 0 };
        d.children.set(child, created);
        return Promise.resolve(fileHandle(created, child));
      },
      removeEntry(child: string, o?: { recursive?: boolean }) {
        const n = d.children.get(child);
        if (!n) return Promise.reject(new FakeDomException('NotFoundError'));
        if (n.kind === 'dir' && n.children.size > 0 && !o?.recursive) {
          return Promise.reject(new FakeDomException('InvalidModificationError'));
        }
        d.children.delete(child);
        return Promise.resolve();
      },
      [Symbol.asyncIterator]() {
        const entries = [...d.children.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        let i = 0;
        return {
          next: (): Promise<IteratorResult<[string, FileSystemHandle]>> => {
            if (i >= entries.length) {
              return Promise.resolve({ value: undefined, done: true as const });
            }
            const [childName, n] = entries[i++] as [string, FakeFile | FakeDir];
            const childHandle =
              n.kind === 'dir' ? dirHandle(n, childName) : fileHandle(n, childName);
            return Promise.resolve({
              value: [childName, childHandle] as [string, FileSystemHandle],
              done: false as const,
            });
          },
        };
      },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  }

  return dirHandle(root, '');
}

function makeOpfsVfs(): Vfs {
  const vfs = new OpfsVfs();
  (vfs as unknown as { root: FileSystemDirectoryHandle }).root = makeFakeOpfsRoot();
  return vfs;
}

const backends: ReadonlyArray<[string, () => Vfs]> = [
  ['MemoryVfs', () => new MemoryVfs()],
  ['OpfsVfs', makeOpfsVfs],
];

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
};

describe.each(backends)('%s async contract', (_name, make) => {
  it('non-recursive mkdir on an existing directory is EEXIST, recursive tolerates it', async () => {
    const vfs = make();
    await vfs.mkdir('/existing');
    expect(await codeOf(vfs.mkdir('/existing'))).toBe('EEXIST');
    expect(await codeOf(vfs.mkdir('/existing', { recursive: true }))).toBeUndefined();
  });

  it('mkdir on an existing FILE is EEXIST regardless of recursive', async () => {
    const vfs = make();
    await vfs.writeFile('/plain.txt', 'x');
    expect(await codeOf(vfs.mkdir('/plain.txt'))).toBe('EEXIST');
    expect(await codeOf(vfs.mkdir('/plain.txt', { recursive: true }))).toBe('EEXIST');
  });

  it('non-recursive mkdir("/") reports the existing root as EEXIST', async () => {
    const vfs = make();
    expect(await codeOf(vfs.mkdir('/'))).toBe('EEXIST');
    expect(await codeOf(vfs.mkdir('/', { recursive: true }))).toBeUndefined();
  });

  it('non-recursive mkdir with a missing parent is ENOENT naming the TARGET', async () => {
    const vfs = make();
    const err = await vfs.mkdir('/no-parent/child').then(
      () => null,
      (e: unknown) => e as { code?: string; path?: string },
    );
    expect(err?.code).toBe('ENOENT');
    expect(err?.path).toBe('/no-parent/child');
  });

  it('utimes is OBSERVABLE through stat (mtime), for files and directories', async () => {
    const vfs = make();
    await vfs.writeFile('/stamped.txt', 'x');
    await vfs.mkdir('/stamped-dir');
    await vfs.utimes('/stamped.txt', 5_000, 5_000);
    await vfs.utimes('/stamped-dir', 7_000, 7_000);
    expect((await vfs.stat('/stamped.txt')).mtime).toBe(5_000);
    expect((await vfs.stat('/stamped-dir')).mtime).toBe(7_000);
  });

  it('utimes on a missing path is ENOENT, never a silent success', async () => {
    const vfs = make();
    expect(await codeOf(vfs.utimes('/missing.txt', 1, 1))).toBe('ENOENT');
  });

  it('a later writeFile refreshes mtime past a utimes stamp', async () => {
    const vfs = make();
    await vfs.writeFile('/rewrite.txt', 'a');
    await vfs.utimes('/rewrite.txt', 5, 5);
    await vfs.writeFile('/rewrite.txt', 'b');
    const st = await vfs.stat('/rewrite.txt');
    expect(st.mtime).not.toBe(5);
  });

  it('rm drops any utimes stamp — a recreated path must not resurrect it', async () => {
    const vfs = make();
    await vfs.writeFile('/ghost.txt', 'a');
    await vfs.utimes('/ghost.txt', 5, 5);
    await vfs.rm('/ghost.txt');
    await vfs.writeFile('/ghost.txt', 'b');
    expect((await vfs.stat('/ghost.txt')).mtime).not.toBe(5);
  });

  it('recursive rm of a directory drops stamps of its descendants too', async () => {
    const vfs = make();
    await vfs.mkdir('/tree/deep', { recursive: true });
    await vfs.writeFile('/tree/deep/f.txt', 'a');
    await vfs.utimes('/tree/deep/f.txt', 5, 5);
    await vfs.rm('/tree', { recursive: true });
    await vfs.mkdir('/tree/deep', { recursive: true });
    await vfs.writeFile('/tree/deep/f.txt', 'b');
    expect((await vfs.stat('/tree/deep/f.txt')).mtime).not.toBe(5);
  });
});
