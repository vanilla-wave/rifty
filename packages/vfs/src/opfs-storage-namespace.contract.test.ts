import { afterEach, describe, expect, it } from 'vitest';
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
    } as unknown as FileSystemDirectoryHandle;
  }

  return { handle: dirHandle(root, ''), tree: root };
}

async function seedHost(handle: FileSystemDirectoryHandle): Promise<void> {
  const file = await handle.getFileHandle('host.txt', { create: true });
  const writable = await file.createWritable();
  await writable.write(new TextEncoder().encode('unrelated-host'));
  await writable.close();
}

function stubOrigin(handle: FileSystemDirectoryHandle): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { storage: { getDirectory: async () => handle } },
  });
}

async function namespacedVfs(namespace: string): Promise<OpfsVfs> {
  const vfs = new OpfsVfs();
  await vfs.init({ namespace });
  return vfs;
}

describe('OPFS storage namespace isolation (I4)', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'navigator');
  });

  it('hides the origin host sentinel and keeps namespaced writes off the origin root', async () => {
    const fake = makeFakeOpfsRoot();
    await seedHost(fake.handle);
    stubOrigin(fake.handle);

    const vfs = await namespacedVfs('plugin-sandbox');
    expect((await vfs.readdir('/')).map((e) => e.name)).not.toContain('host.txt');
    expect(await vfs.exists('/host.txt')).toBe(false);
    await vfs.writeFile('/project.txt', 'sandbox-bytes');
    expect(await vfs.readFileText('/project.txt')).toBe('sandbox-bytes');

    expect([...fake.tree.children.keys()].sort()).toEqual(['host.txt', 'plugin-sandbox']);
    const sandbox = fake.tree.children.get('plugin-sandbox');
    expect(sandbox?.kind).toBe('dir');
    if (sandbox?.kind !== 'dir') throw new Error('expected plugin-sandbox directory');
    expect([...sandbox.children.keys()]).toEqual(['project.txt']);
  });

  it('starts a new namespace empty, isolates two sequential namespaces, and preserves reopen', async () => {
    const fake = makeFakeOpfsRoot();
    await seedHost(fake.handle);
    stubOrigin(fake.handle);

    const first = await namespacedVfs('ns-a');
    expect((await first.readdir('/')).map((e) => e.name)).toEqual([]);
    await first.writeFile('/kept.txt', 'from-a');

    const second = await namespacedVfs('ns-b');
    expect(await second.exists('/kept.txt')).toBe(false);
    expect((await second.readdir('/')).map((e) => e.name)).toEqual([]);
    await second.writeFile('/other.txt', 'from-b');

    const reopen = await namespacedVfs('ns-a');
    expect(await reopen.readFileText('/kept.txt')).toBe('from-a');
    expect(await reopen.exists('/other.txt')).toBe(false);
    expect(await (await namespacedVfs('ns-b')).readFileText('/other.txt')).toBe('from-b');
  });
});
