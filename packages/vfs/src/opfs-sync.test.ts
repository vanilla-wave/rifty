import { NotImplementedError } from '@rifty/io';
/**
 * Unit tests for `OpfsFsSync` (ADR-0013, ADR-0014).
 *
 * The Node test env has no `FileSystemSyncAccessHandle` and no Worker
 * scope, so we can't exercise the actual sync access handle path. What we
 * *can* test:
 *
 *   1. The realm gate (`isSupported`, constructor, `init`) — covered below.
 *   2. The pure-async warm-index walker via {@link walkOpfsTree} — covered
 *      against a fake `FileSystemDirectoryHandle` tree.
 *   3. The `existsSync` / `statSync` answers driven by the warm index —
 *      tested via a manually-constructed `OpfsFsSync` with `isSupported`
 *      stubbed.
 *
 * The full round-trip behaviour (read your writes through a real sync
 * access handle, persistence across page reload) is checked in browser
 * e2e (Playwright + Worker) — marked `.skip` below with the explicit
 * reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsError } from './errors.ts';
import { OpfsFsSync, walkOpfsTree } from './opfs-sync.ts';

describe('OpfsFsSync (Node test env)', () => {
  it('isSupported() is false outside a Worker realm with createSyncAccessHandle', () => {
    expect(OpfsFsSync.isSupported()).toBe(false);
  });

  it('constructor throws NotImplementedError outside a Worker realm', () => {
    const fakeRoot = {} as unknown as FileSystemDirectoryHandle;
    expect(() => new OpfsFsSync(fakeRoot)).toThrow(NotImplementedError);
    expect(() => new OpfsFsSync(fakeRoot)).toThrow(
      /sync OPFS only available inside a Web Worker realm/,
    );
  });

  it('init() rejects with NotImplementedError outside a Worker realm', async () => {
    await expect(OpfsFsSync.init()).rejects.toThrow(NotImplementedError);
  });

  // Round-trip OPFS behaviour requires a browser Worker context with
  // `FileSystemSyncAccessHandle`. Covered by Playwright e2e in M11
  // follow-up; impossible to fake in Node without writing a stub that
  // would mask real bugs.
  it.skip('reads its own writes through a sync access handle (browser Worker only)', () => {});

  it.skip('directory ops throw NotImplementedError with the documented hint', () => {
    // In a real Worker we still expect:
    //   readdirSync / mkdirSync / rmSync → NotImplementedError
    //     ('OpfsFsSync.<method>',
    //      'directory ops require an async bootstrap; use OpfsVfs for those')
    // Covered indirectly by code review until the e2e harness exists.
  });
});

// ---------------------------------------------------------------------------
// Warm index — walker, existsSync, statSync (items #2 and #3 in the review).
// ---------------------------------------------------------------------------

interface FakeFs {
  files: ReadonlyMap<string, { bytes: Uint8Array; mtime?: number }>;
  dirs: ReadonlySet<string>;
}

/**
 * Builds a fake `FileSystemDirectoryHandle` tree from a flat path map. Only
 * the methods used by `walkOpfsTree` and `OpfsFsSync` are populated.
 */
function buildFakeRoot(fs: FakeFs): FileSystemDirectoryHandle {
  function makeDir(prefix: string): FileSystemDirectoryHandle {
    const childNames = new Set<string>();
    const childKinds = new Map<string, 'file' | 'directory'>();
    for (const dirPath of fs.dirs) {
      if (dirPath === prefix) continue;
      if (dirPath.startsWith(prefix === '/' ? '/' : `${prefix}/`)) {
        const rest = dirPath.slice(prefix === '/' ? 1 : prefix.length + 1);
        const head = rest.split('/')[0];
        if (head) {
          childNames.add(head);
          childKinds.set(head, 'directory');
        }
      }
    }
    for (const filePath of fs.files.keys()) {
      if (filePath.startsWith(prefix === '/' ? '/' : `${prefix}/`)) {
        const rest = filePath.slice(prefix === '/' ? 1 : prefix.length + 1);
        if (!rest.includes('/')) {
          childNames.add(rest);
          childKinds.set(rest, 'file');
        }
      }
    }

    const handle: FileSystemDirectoryHandle = {
      kind: 'directory',
      name: prefix === '/' ? '' : (prefix.split('/').pop() ?? ''),
      isSameEntry: () => Promise.resolve(false),
      getFileHandle(name: string) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        const file = fs.files.get(fullPath);
        if (!file) return Promise.reject(new DomError('NotFoundError'));
        return Promise.resolve({
          kind: 'file',
          name,
          isSameEntry: () => Promise.resolve(false),
          getFile: () =>
            Promise.resolve({
              size: file.bytes.byteLength,
              lastModified: file.mtime ?? 0,
              arrayBuffer: () =>
                Promise.resolve(
                  file.bytes.buffer.slice(
                    file.bytes.byteOffset,
                    file.bytes.byteOffset + file.bytes.byteLength,
                  ),
                ),
            } as unknown as File),
        } as unknown as FileSystemFileHandle);
      },
      getDirectoryHandle(name: string) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (fs.dirs.has(fullPath)) {
          return Promise.resolve(makeDir(fullPath));
        }
        return Promise.reject(new DomError('NotFoundError'));
      },
      removeEntry: () => Promise.resolve(),
      resolve: () => Promise.resolve([] as string[]),
      [Symbol.asyncIterator]: () => {
        const names = [...childNames];
        let i = 0;
        return {
          async next(): Promise<IteratorResult<[string, FileSystemHandle]>> {
            if (i >= names.length) return { value: undefined, done: true };
            const name = names[i++] as string;
            const kind = childKinds.get(name);
            if (kind === 'file') {
              return { value: [name, await handle.getFileHandle(name)], done: false };
            }
            return { value: [name, await handle.getDirectoryHandle(name)], done: false };
          },
        };
      },
    } as unknown as FileSystemDirectoryHandle;
    return handle;
  }

  return makeDir('/');
}

class DomError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

describe('walkOpfsTree', () => {
  it('indexes the empty root as a directory', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const idx = await walkOpfsTree(root);
    expect(idx.size).toBe(1);
    expect(idx.get('/')?.kind).toBe('dir');
  });

  it('captures files at the root with their size', async () => {
    const root = buildFakeRoot({
      files: new Map([['/foo.txt', { bytes: new Uint8Array([1, 2, 3]) }]]),
      dirs: new Set(['/']),
    });
    const idx = await walkOpfsTree(root);
    expect(idx.get('/foo.txt')).toEqual({ kind: 'file', size: 3 });
  });

  it('recurses into nested directories', async () => {
    const root = buildFakeRoot({
      files: new Map([
        ['/a/b/leaf.txt', { bytes: new Uint8Array([0xff]) }],
        ['/a/sibling.txt', { bytes: new Uint8Array(10) }],
      ]),
      dirs: new Set(['/', '/a', '/a/b']),
    });
    const idx = await walkOpfsTree(root);
    expect(idx.get('/a')?.kind).toBe('dir');
    expect(idx.get('/a/b')?.kind).toBe('dir');
    expect(idx.get('/a/b/leaf.txt')).toEqual({ kind: 'file', size: 1 });
    expect(idx.get('/a/sibling.txt')).toEqual({ kind: 'file', size: 10 });
  });
});

describe('OpfsFsSync warm index — existsSync / statSync', () => {
  beforeEach(() => {
    // Make `OpfsFsSync` constructible in Node by faking the Worker realm.
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('existsSync returns true for files written via OpfsVfs once the index is built (item #2)', async () => {
    // The test models the "OpfsVfs.writeFile then construct OpfsFsSync"
    // sequence: the warm-index walk picks up entries that the sync surface
    // never wrote itself.
    const root = buildFakeRoot({
      files: new Map([['/written-async.txt', { bytes: new Uint8Array([42]) }]]),
      dirs: new Set(['/']),
    });
    const fs = new OpfsFsSync(root);
    expect(fs.existsSync('/written-async.txt')).toBe(false); // pre-walk
    await fs.refreshIndex();
    expect(fs.existsSync('/written-async.txt')).toBe(true); // post-walk
  });

  it('existsSync returns false for unknown paths', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(fs.existsSync('/ghost')).toBe(false);
  });

  it('statSync differentiates files vs directories from the warm index (item #3)', async () => {
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array(7) }]]),
      dirs: new Set(['/', '/some-dir']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();

    const fileStat = fs.statSync('/file.txt');
    expect(fileStat.isFile).toBe(true);
    expect(fileStat.isDirectory).toBe(false);
    expect(fileStat.size).toBe(7);

    const dirStat = fs.statSync('/some-dir');
    expect(dirStat.isFile).toBe(false);
    expect(dirStat.isDirectory).toBe(true);
    expect(dirStat.mtime).toBe(0); // OPFS does not track dir mtime
  });

  it('statSync returns mtime=0 for directories (documented behaviour)', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/d']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(fs.statSync('/d').mtime).toBe(0);
  });

  it('statSync throws ENOENT only for genuinely unknown entries', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.statSync('/missing')).toThrow(VfsError);
    try {
      fs.statSync('/missing');
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });
});
