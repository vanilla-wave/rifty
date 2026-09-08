import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpfsVfs } from './opfs.ts';

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

function makeFakeOpfsRoot(): {
  readonly handle: FileSystemDirectoryHandle;
  readonly tree: FakeDir;
} {
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
          arrayBuffer: () => Promise.resolve(f.bytes.buffer.slice()),
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
    return {
      kind: 'directory',
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
      removeEntry() {
        return Promise.resolve();
      },
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.resolve({ value: undefined, done: true as const }),
        };
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return { handle: dirHandle(root, ''), tree: root };
}

function stubOrigin(handle: FileSystemDirectoryHandle): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { storage: { getDirectory: async () => handle } },
  });
}

describe('OPFS storage namespace faults (I4)', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'navigator');
  });

  it('corrupt-input × invalid namespace: TypeError before getDirectoryHandle', async () => {
    const fake = makeFakeOpfsRoot();
    const getDirectoryHandle = vi.fn(fake.handle.getDirectoryHandle.bind(fake.handle));
    const origin = {
      ...fake.handle,
      getDirectoryHandle,
    } as FileSystemDirectoryHandle;
    stubOrigin(origin);

    const vfs = new OpfsVfs();
    await expect(vfs.init({ namespace: '..' })).rejects.toThrow(/storage\.namespace/);
    expect(getDirectoryHandle).not.toHaveBeenCalled();
    expect([...fake.tree.children.keys()]).toEqual([]);
  });

  it('torn-state × failed second namespace: first namespace bytes unchanged', async () => {
    const fake = makeFakeOpfsRoot();
    stubOrigin(fake.handle);

    const first = new OpfsVfs();
    await first.init({ namespace: 'ns-a' });
    await first.writeFile('/kept.txt', 'from-a');

    await fake.handle.getFileHandle('blocked', { create: true });
    const blocked = new OpfsVfs();
    await expect(blocked.init({ namespace: 'blocked' })).rejects.toThrow();

    const reopen = new OpfsVfs();
    await reopen.init({ namespace: 'ns-a' });
    expect(await reopen.readFileText('/kept.txt')).toBe('from-a');
    const nsA = fake.tree.children.get('ns-a');
    expect(nsA?.kind).toBe('dir');
    if (nsA?.kind !== 'dir') throw new Error('expected ns-a');
    expect([...nsA.children.keys()]).toEqual(['kept.txt']);
  });

  it('quota-perm-fail × namespaced open: loud throw and the other namespace unchanged', async () => {
    const fake = makeFakeOpfsRoot();
    const inner = fake.handle.getDirectoryHandle.bind(fake.handle);
    const origin = {
      ...fake.handle,
      getDirectoryHandle: (name: string, o?: { create?: boolean }) => {
        if (name === 'ns-b') return Promise.reject(new FakeDomException('QuotaExceededError'));
        return inner(name, o);
      },
    } as FileSystemDirectoryHandle;
    stubOrigin(origin);

    const first = new OpfsVfs();
    await first.init({ namespace: 'ns-a' });
    await first.writeFile('/kept.txt', 'from-a');

    const second = new OpfsVfs();
    await expect(second.init({ namespace: 'ns-b' })).rejects.toMatchObject({ code: 'EDQUOT' });

    const reopen = new OpfsVfs();
    await reopen.init({ namespace: 'ns-a' });
    expect(await reopen.readFileText('/kept.txt')).toBe('from-a');
  });
});
