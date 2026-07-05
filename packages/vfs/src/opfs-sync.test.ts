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
import { NotImplementedError, VfsError } from './errors.ts';
import { OpfsFsSync, type PairedAsyncSurface, walkOpfsTree } from './opfs-sync.ts';

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

async function waitForMicrotaskCondition(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

interface MutableRootOptions {
  dirs?: readonly string[];
  files?: ReadonlyMap<string, { bytes: Uint8Array; mtime?: number }>;
  deferCreates?: boolean;
}

interface MutableFakeRoot {
  root: FileSystemDirectoryHandle;
  dirs: Set<string>;
  files: Map<string, { bytes: Uint8Array; mtime?: number }>;
  pendingCreates: Array<{ path: string; resolve: () => void }>;
  releaseNextCreate(): string;
}

function buildMutableRoot({
  dirs: initialDirs = ['/'],
  files: initialFiles = new Map(),
  deferCreates = false,
}: MutableRootOptions = {}): MutableFakeRoot {
  const dirs = new Set(initialDirs);
  dirs.add('/');
  const files = new Map(initialFiles);
  const pendingCreates: Array<{ path: string; resolve: () => void }> = [];

  function makeDir(prefix: string): FileSystemDirectoryHandle {
    const handle: FileSystemDirectoryHandle = {
      kind: 'directory',
      name: prefix === '/' ? '' : (prefix.split('/').pop() ?? ''),
      isSameEntry: () => Promise.resolve(false),
      getFileHandle(name: string) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        const file = files.get(fullPath);
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
      getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (dirs.has(fullPath)) return Promise.resolve(makeDir(fullPath));
        if (!options?.create) return Promise.reject(new DomError('NotFoundError'));
        if (!deferCreates) {
          dirs.add(fullPath);
          return Promise.resolve(makeDir(fullPath));
        }
        return new Promise<FileSystemDirectoryHandle>((resolve) => {
          pendingCreates.push({
            path: fullPath,
            resolve: () => {
              dirs.add(fullPath);
              resolve(makeDir(fullPath));
            },
          });
        });
      },
      removeEntry(name: string, options?: { recursive?: boolean }) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (files.delete(fullPath)) return Promise.resolve();
        if (!dirs.has(fullPath)) return Promise.reject(new DomError('NotFoundError'));
        const hasChildren =
          [...dirs].some((p) => p !== fullPath && p.startsWith(`${fullPath}/`)) ||
          [...files.keys()].some((p) => p.startsWith(`${fullPath}/`));
        if (hasChildren && !options?.recursive) {
          return Promise.reject(new DomError('InvalidModificationError'));
        }
        for (const dir of [...dirs]) {
          if (dir === fullPath || dir.startsWith(`${fullPath}/`)) dirs.delete(dir);
        }
        for (const file of [...files.keys()]) {
          if (file === fullPath || file.startsWith(`${fullPath}/`)) files.delete(file);
        }
        return Promise.resolve();
      },
      resolve: () => Promise.resolve([] as string[]),
      [Symbol.asyncIterator]: () => {
        const childNames = new Set<string>();
        const childKinds = new Map<string, 'file' | 'directory'>();
        for (const dirPath of dirs) {
          if (dirPath === prefix) continue;
          if (!dirPath.startsWith(prefix === '/' ? '/' : `${prefix}/`)) continue;
          const rest = dirPath.slice(prefix === '/' ? 1 : prefix.length + 1);
          const head = rest.split('/')[0];
          if (head) {
            childNames.add(head);
            childKinds.set(head, 'directory');
          }
        }
        for (const filePath of files.keys()) {
          if (!filePath.startsWith(prefix === '/' ? '/' : `${prefix}/`)) continue;
          const rest = filePath.slice(prefix === '/' ? 1 : prefix.length + 1);
          if (!rest.includes('/')) {
            childNames.add(rest);
            childKinds.set(rest, 'file');
          }
        }
        const names = [...childNames].sort();
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

  return {
    root: makeDir('/'),
    dirs,
    files,
    pendingCreates,
    releaseNextCreate(): string {
      const next = pendingCreates.shift();
      if (!next) throw new Error('No pending directory create');
      next.resolve();
      return next.path;
    },
  };
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

describe('OpfsFsSync.statSyncOrNull (ADR-0083)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('returns a stat for a present file/dir and null for a miss (no throw)', async () => {
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array(5) }]]),
      dirs: new Set(['/', '/d']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();

    const fileStat = fs.statSyncOrNull('/file.txt');
    expect(fileStat?.isFile).toBe(true);
    expect(fileStat?.isDirectory).toBe(false);
    expect(fileStat?.size).toBe(5);

    const dirStat = fs.statSyncOrNull('/d');
    expect(dirStat?.isFile).toBe(false);
    expect(dirStat?.isDirectory).toBe(true);

    expect(fs.statSyncOrNull('/unknown')).toBeNull();
  });

  it('statSync STILL throws ENOENT on a miss (parity invariant — must not regress)', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.statSync('/missing')).toThrow(VfsError);
    expect(fs.statSyncOrNull('/missing')).toBeNull();
  });
});

describe('OpfsFsSync.utimes (ADR-0029)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('utimes(path, atime, mtime) makes statSync(path).mtime === mtime', async () => {
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array([1, 2]) }]]),
      dirs: new Set(['/']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.utimes('/file.txt', 100, 2000);
    expect(fs.statSync('/file.txt').mtime).toBe(2000);
  });

  it('utimes throws VfsError ENOENT for unknown paths', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.utimes('/missing', 1, 2)).toThrow(VfsError);
    try {
      fs.utimes('/missing', 1, 2);
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });

  it('utimes also updates mtime on directories via the side-table', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/d']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.utimes('/d', 10, 42);
    expect(fs.statSync('/d').mtime).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// In-memory dir-tree mirror — readdirSync / mkdirSync / rmSync. Mirrors what
// `MemoryFsSync` does for the same methods. The async OPFS persist is
// fire-and-forget; we assert against the in-memory mirror (the source of
// truth for sync callers) and rely on the fake root's permissive
// `removeEntry` / `getDirectoryHandle` to not throw spuriously.
// ---------------------------------------------------------------------------

describe('OpfsFsSync dir-tree mirror — readdirSync / mkdirSync / rmSync', () => {
  beforeEach(() => {
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('readdirSync(/) lists entries seeded by the warm walk, sorted', async () => {
    const root = buildFakeRoot({
      files: new Map([
        ['/b.txt', { bytes: new Uint8Array([1]) }],
        ['/a.txt', { bytes: new Uint8Array([2]) }],
      ]),
      dirs: new Set(['/', '/sub']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(fs.readdirSync('/').map((d) => d.name)).toEqual(['a.txt', 'b.txt', 'sub']);
  });

  it('readdirSync dirent cache invalidates on create / unlink (perf audit 2026-06-05)', async () => {
    const root = buildFakeRoot({
      files: new Map([['/x.txt', { bytes: new Uint8Array([1]) }]]),
      dirs: new Set(['/', '/d']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    // Fill the cache.
    expect(fs.readdirSync('/').map((e) => e.name)).toEqual(['d', 'x.txt']);
    // CREATE: a new dir via mkdirSync must appear.
    fs.mkdirSync('/new', { recursive: true });
    expect(fs.readdirSync('/').map((e) => e.name)).toEqual(['d', 'new', 'x.txt']);
    // UNLINK: removing a child must drop it.
    fs.rmSync('/new', { recursive: true });
    expect(fs.readdirSync('/').map((e) => e.name)).toEqual(['d', 'x.txt']);
  });

  it('readdirSync on a non-directory throws ENOTDIR', async () => {
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array([1]) }]]),
      dirs: new Set(['/']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.readdirSync('/file.txt')).toThrow(VfsError);
    try {
      fs.readdirSync('/file.txt');
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOTDIR');
    }
  });

  it('readdirSync on an unknown path throws ENOENT', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.readdirSync('/missing')).toThrow(VfsError);
    try {
      fs.readdirSync('/missing');
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });

  it('mkdirSync with recursive creates parents and the leaf', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/a/b/c', { recursive: true });
    expect(fs.existsSync('/a')).toBe(true);
    expect(fs.existsSync('/a/b')).toBe(true);
    expect(fs.existsSync('/a/b/c')).toBe(true);
    expect(fs.readdirSync('/a').map((d) => d.name)).toEqual(['b']);
    expect(fs.readdirSync('/a/b').map((d) => d.name)).toEqual(['c']);
  });

  it('flush waits for mkdirSync to persist recursive directory creation to OPFS', async () => {
    const fake = buildMutableRoot({ deferCreates: true });
    const fs = new OpfsFsSync(fake.root);
    await fs.refreshIndex();

    fs.mkdirSync('/a/b', { recursive: true });
    let flushed = false;
    const flush = fs.flush().then(() => {
      flushed = true;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(flushed).toBe(false);

    expect(fake.releaseNextCreate()).toBe('/a');
    await Promise.resolve();
    expect(flushed).toBe(false);

    expect(fake.releaseNextCreate()).toBe('/a/b');
    await flush;
    expect(flushed).toBe(true);

    const durable = await walkOpfsTree(fake.root);
    expect(durable.has('/a')).toBe(true);
    expect(durable.has('/a/b')).toBe(true);
  });

  it('flush persists dependent mkdirSync calls in call order', async () => {
    const fake = buildMutableRoot({ deferCreates: true });
    const fs = new OpfsFsSync(fake.root);
    await fs.refreshIndex();

    fs.mkdirSync('/a', { recursive: true });
    fs.mkdirSync('/a/b');

    let flushed = false;
    const flush = fs.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(fake.pendingCreates.map((create) => create.path)).toEqual(['/a']);
    expect(fake.releaseNextCreate()).toBe('/a');
    await waitForMicrotaskCondition(
      () => fake.pendingCreates[0]?.path === '/a/b',
      'second mkdir persist',
    );

    expect(flushed).toBe(false);
    expect(fake.releaseNextCreate()).toBe('/a/b');
    await flush;

    expect(flushed).toBe(true);
    const durable = await walkOpfsTree(fake.root);
    expect(durable.has('/a/b')).toBe(true);
  });

  it('mkdirSync without recursive on missing parent throws ENOENT', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.mkdirSync('/missing/leaf', {})).toThrow(VfsError);
    try {
      fs.mkdirSync('/missing/leaf', {});
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOENT');
    }
  });

  it('mkdirSync without recursive on existing dir throws EEXIST', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/d', {});
    expect(() => fs.mkdirSync('/d', {})).toThrow(VfsError);
    try {
      fs.mkdirSync('/d', {});
    } catch (err) {
      expect((err as VfsError).code).toBe('EEXIST');
    }
  });

  it('mkdirSync recursive is idempotent on existing dirs', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/d', { recursive: true });
    expect(() => fs.mkdirSync('/d', { recursive: true })).not.toThrow();
  });

  it('rmSync removes a single empty directory and it disappears from readdirSync', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/a', { recursive: true });
    fs.mkdirSync('/a/b', { recursive: true });
    expect(fs.readdirSync('/a').map((d) => d.name)).toEqual(['b']);
    fs.rmSync('/a/b', {});
    expect(fs.readdirSync('/a')).toEqual([]);
    expect(fs.existsSync('/a/b')).toBe(false);
  });

  it('rmSync recursive removes a populated subtree', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/a/b/c', { recursive: true });
    fs.rmSync('/a', { recursive: true });
    expect(fs.existsSync('/a')).toBe(false);
    expect(fs.existsSync('/a/b')).toBe(false);
    expect(fs.existsSync('/a/b/c')).toBe(false);
  });

  it('rmSync on a non-empty dir without recursive throws ENOTEMPTY (Node parity)', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    fs.mkdirSync('/a/b', { recursive: true });
    expect(() => fs.rmSync('/a', {})).toThrow(VfsError);
    try {
      fs.rmSync('/a', {});
    } catch (err) {
      expect((err as VfsError).code).toBe('ENOTEMPTY');
    }
  });

  it('rmSync on missing path throws ENOENT, force suppresses it', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    expect(() => fs.rmSync('/missing', {})).toThrow(VfsError);
    expect(() => fs.rmSync('/missing', { force: true })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #3 / Q-2026-06-06-319 — input-buffer aliasing (ADR-0072). `writeFileSync`
// collapses its two defensive `data.slice()` (content cache + write-through)
// into ONE shared slice. The single entry-point slice is the SOLE barrier
// keeping cached content from being aliased into a live mutable caller buffer:
// `readFileBytesSync` returns the cache BY REFERENCE and WASI `fd_write`
// mutates its buffer IN PLACE (fd.ts:88), so dropping the copy (not merging the
// two) would be the real regression. These pins lock the invariant the
// single-slice edit must preserve.
// ---------------------------------------------------------------------------

describe('OpfsFsSync content cache — input-buffer aliasing (#3, ADR-0072)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  /** Captures the buffer references the async write-through hands to OPFS. */
  function capturingSurface(): { surface: PairedAsyncSurface; captured: Uint8Array[] } {
    const captured: Uint8Array[] = [];
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (_path: string, data: Uint8Array) => {
        captured.push(data); // store the REFERENCE, do not copy
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    return { surface, captured };
  }

  it('mutating the caller buffer after writeFileSync does not change cached content', () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const { surface } = capturingSurface();
    const fs = new OpfsFsSync(root, surface);
    const src = new Uint8Array([1, 2, 3]);
    fs.writeFileSync('/f', src);
    src[0] = 99; // in-place caller mutation (the fd_write reuse pattern)
    expect(Array.from(fs.readFileBytesSync('/f'))).toEqual([1, 2, 3]);
  });

  it('content cache and write-through observe the SAME post-write bytes', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const { surface, captured } = capturingSurface();
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/f', new Uint8Array([7, 8, 9]));
    await fs.flush();
    expect(captured.length).toBe(1);
    expect(Array.from(captured[0] as Uint8Array)).toEqual([7, 8, 9]);
    expect(Array.from(fs.readFileBytesSync('/f'))).toEqual([7, 8, 9]);
  });

  it('a later in-place mutation of the caller buffer does not corrupt the write-through snapshot', () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const { surface, captured } = capturingSurface();
    const fs = new OpfsFsSync(root, surface);
    const buf = new Uint8Array([10, 20, 30]);
    fs.writeFileSync('/g', buf);
    buf.set([40, 50, 60], 0); // simulate fd_write reusing fdEntry.data in place
    expect(captured.length).toBe(1);
    expect(Array.from(captured[0] as Uint8Array)).toEqual([10, 20, 30]);
    expect(Array.from(fs.readFileBytesSync('/g'))).toEqual([10, 20, 30]);
  });

  // Perf-guard (#3, perf audit 2026-06-05): the two former defensive copies
  // (content cache + write-through) are MERGED into ONE shared `data.slice()`.
  // The aliasing tests above prove the copy is not DROPPED; this proves the two
  // were collapsed to exactly ONE (2N->N copies/write). RED-on-revert: split
  // back into two separate slices => count === 2.
  it('writeFileSync takes EXACTLY ONE defensive slice (the merged cache+write-through copy)', () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const { surface } = capturingSurface();
    const fs = new OpfsFsSync(root, surface);
    const src = new Uint8Array([1, 2, 3, 4]);

    // Scope the spy to the single write — the fake surface stores the reference
    // (no copy), so the only Uint8Array slice in this window is the merged one.
    const sliceSpy = vi.spyOn(Uint8Array.prototype, 'slice');
    fs.writeFileSync('/merged', src);
    const slices = sliceSpy.mock.calls.length;
    sliceSpy.mockRestore();

    expect(slices).toBe(1);
  });
});

// copyFileSync / cpSync / renameSync (ADR-0090). Exercised against the
// in-memory index/content/times mirror (authoritative for sync callers); the
// async OPFS persist is asserted via a fake PairedAsyncSurface that records
// the move ops and is drained by flush() (ADR-0090 §74).
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function recordingSurface(): PairedAsyncSurface & { writes: string[]; rms: string[] } {
  const writes: string[] = [];
  const rms: string[] = [];
  return {
    writes,
    rms,
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile: (path: string) => {
      writes.push(path);
      return Promise.resolve();
    },
    rm: (path: string) => {
      rms.push(path);
      return Promise.resolve();
    },
  };
}

function removeMutableSubtree(
  dirs: Set<string>,
  files: Map<string, { bytes: Uint8Array; mtime?: number }>,
  path: string,
): void {
  for (const dir of [...dirs]) {
    if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
  }
  for (const file of [...files.keys()]) {
    if (file === path || file.startsWith(`${path}/`)) files.delete(file);
  }
}

describe('OpfsFsSync.renameSync / copyFileSync / cpSync (ADR-0090)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  function freshFs(surface?: PairedAsyncSurface) {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    return new OpfsFsSync(root, surface);
  }

  it('renameSync re-keys index/content/times and PRESERVES mtime', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/dir/a.txt', enc.encode('alpha'));
    fs.utimes('/dir/a.txt', 777_000, 777_000);
    fs.renameSync('/dir/a.txt', '/dir/b.txt');
    expect(fs.existsSync('/dir/a.txt')).toBe(false);
    expect(fs.existsSync('/dir/b.txt')).toBe(true);
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha'); // content re-keyed
    expect(fs.statSync('/dir/b.txt').mtime).toBe(777_000); // times re-keyed (mtime preserved)
    expect(fs.readdirSync('/dir').map((d) => d.name)).toEqual(['b.txt']); // parent children updated
  });

  it('renameSync moves a whole subtree cross-dir, re-keying descendants', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir/sub', { recursive: true });
    fs.writeFileSync('/dir/sub/leaf.txt', enc.encode('leaf'));
    fs.mkdirSync('/parent', { recursive: true });
    fs.renameSync('/dir', '/parent/moved');
    expect(fs.existsSync('/dir')).toBe(false);
    expect(dec.decode(fs.readFileBytesSync('/parent/moved/sub/leaf.txt'))).toBe('leaf');
  });

  it('renameSync persists an empty directory move across flush', async () => {
    const fake = buildMutableRoot({ dirs: ['/', '/dir', '/dir/empty'] });
    const fs = new OpfsFsSync(fake.root);
    await fs.refreshIndex();

    fs.renameSync('/dir/empty', '/moved');
    await fs.flush();

    const durable = await walkOpfsTree(fake.root);
    expect(durable.has('/dir/empty')).toBe(false);
    expect(durable.has('/moved')).toBe(true);
  });

  it("rmSync('/') persists root-child removal to OPFS (was: silent on-disk no-op)", async () => {
    const fake = buildMutableRoot({ dirs: ['/', '/a', '/a/sub', '/b'] });
    const fs = new OpfsFsSync(fake.root);
    await fs.refreshIndex();

    fs.rmSync('/', { recursive: true });
    expect(fs.existsSync('/a')).toBe(false);
    expect(fs.existsSync('/b')).toBe(false);
    await fs.flush();

    const durable = await walkOpfsTree(fake.root);
    expect(durable.has('/a')).toBe(false);
    expect(durable.has('/a/sub')).toBe(false);
    expect(durable.has('/b')).toBe(false);
  });

  it('renameSync persists uncached indexed files before removing the old subtree', async () => {
    const files = new Map<string, { bytes: Uint8Array; mtime?: number }>([
      ['/dir/uncached.txt', { bytes: enc.encode('durable') }],
    ]);
    const fake = buildMutableRoot({ dirs: ['/', '/dir'], files });
    const reads: string[] = [];
    const writes: string[] = [];
    const rms: string[] = [];
    const surface: PairedAsyncSurface = {
      readFile: (path: string) => {
        reads.push(path);
        const file = fake.files.get(path);
        if (!file) return Promise.reject(new Error(`missing ${path}`));
        return Promise.resolve(file.bytes.slice());
      },
      writeFile: (path: string, data: Uint8Array) => {
        writes.push(path);
        fake.files.set(path, { bytes: data.slice() });
        return Promise.resolve();
      },
      rm: (path: string) => {
        rms.push(path);
        removeMutableSubtree(fake.dirs, fake.files, path);
        return Promise.resolve();
      },
    };
    const fs = new OpfsFsSync(fake.root, surface);
    await fs.refreshIndex();

    fs.renameSync('/dir', '/moved');
    await fs.flush();

    expect(reads).toEqual(['/dir/uncached.txt']);
    expect(writes).toEqual(['/moved/uncached.txt']);
    expect(rms).toEqual(['/dir']);
    const durable = await walkOpfsTree(fake.root);
    expect(durable.has('/dir/uncached.txt')).toBe(false);
    expect(durable.has('/moved/uncached.txt')).toBe(true);
  });

  it('renameSync waits for older write-through before removing the source path', async () => {
    const fake = buildMutableRoot();
    const writes: Array<{ path: string; resolve: () => void }> = [];
    const surface: PairedAsyncSurface = {
      readFile: (path: string) => {
        const file = fake.files.get(path);
        if (!file) return Promise.reject(new Error(`missing ${path}`));
        return Promise.resolve(file.bytes.slice());
      },
      writeFile: (path: string, data: Uint8Array) =>
        new Promise<void>((resolve) => {
          writes.push({
            path,
            resolve: () => {
              fake.files.set(path, { bytes: data.slice() });
              resolve();
            },
          });
        }),
      rm: (path: string) => {
        removeMutableSubtree(fake.dirs, fake.files, path);
        return Promise.resolve();
      },
    };
    const fs = new OpfsFsSync(fake.root, surface);
    await fs.refreshIndex();

    fs.writeFileSync('/old.txt', enc.encode('x'));
    fs.renameSync('/old.txt', '/new.txt');
    const flush = fs.flush();

    await Promise.resolve();
    expect(writes.map((write) => write.path)).toEqual(['/old.txt']);
    writes[0]?.resolve();
    await waitForMicrotaskCondition(() => writes.length === 2, 'rename write-through');

    expect(writes.map((write) => write.path)).toEqual(['/old.txt', '/new.txt']);
    writes[1]?.resolve();
    await flush;

    expect(fake.files.has('/old.txt')).toBe(false);
    expect(fake.files.has('/new.txt')).toBe(true);
  });

  it('renameSync enqueues the async OPFS move and flush() awaits it (ADR-0090 §74)', async () => {
    const surface = recordingSurface();
    const fs = freshFs(surface);
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/dir/a.txt', enc.encode('x'));
    await fs.flush(); // drain the seeding write-through
    surface.writes.length = 0;
    surface.rms.length = 0;
    fs.renameSync('/dir/a.txt', '/dir/b.txt');
    await fs.flush();
    expect(surface.writes).toContain('/dir/b.txt'); // file recreated at the new path
    expect(surface.rms).toContain('/dir/a.txt'); // old path removed — proves the move was enqueued AND flush awaited it
  });

  it('renameSync error matrix: ENOTEMPTY / ENOENT / EINVAL', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir/sub', { recursive: true });
    fs.mkdirSync('/dst/occupied', { recursive: true });
    expect(() => fs.renameSync('/dir', '/dst')).toThrow(/ENOTEMPTY/);
    expect(() => fs.renameSync('/missing', '/x')).toThrow(/ENOENT/);
    expect(() => fs.renameSync('/dir', '/dir/sub/deeper')).toThrow(/EINVAL/);
  });

  it('copyFileSync copies content (source untouched); EISDIR on dir src/dst', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/dir/a.txt', enc.encode('alpha'));
    fs.copyFileSync('/dir/a.txt', '/dir/b.txt');
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha');
    expect(fs.existsSync('/dir/a.txt')).toBe(true);
    expect(() => fs.copyFileSync('/dir', '/x')).toThrow(/EISDIR/);
  });

  it('cpSync recursive deep-copies; bare dir without recursive throws EISDIR', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir/sub', { recursive: true });
    fs.writeFileSync('/dir/sub/leaf.txt', enc.encode('leaf'));
    expect(() => fs.cpSync('/dir', '/copy')).toThrow(/EISDIR/);
    fs.cpSync('/dir', '/copy', { recursive: true });
    expect(dec.decode(fs.readFileBytesSync('/copy/sub/leaf.txt'))).toBe('leaf');
    expect(fs.existsSync('/dir/sub/leaf.txt')).toBe(true); // source untouched
  });

  it('cpSync recursive into the source (a → a) or its subtree (a → a/b) throws EINVAL, not a stack overflow', () => {
    const fs = freshFs();
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/dir/a.txt', enc.encode('alpha'));
    expect(() => fs.cpSync('/dir', '/dir', { recursive: true })).toThrow(/EINVAL/);
    expect(() => fs.cpSync('/dir', '/dir/sub', { recursive: true })).toThrow(/EINVAL/);
  });
});
