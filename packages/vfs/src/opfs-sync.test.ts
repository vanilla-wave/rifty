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

describe('OpfsFsSync writeFileSync metadata', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('writeFileSync bumps mtime monotonically even when the wall clock does not advance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array([1, 2]) }]]),
      dirs: new Set(['/']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();

    fs.writeFileSync('/file.txt', new Uint8Array([3, 4]));
    const first = fs.statSync('/file.txt').mtime;
    fs.writeFileSync('/file.txt', new Uint8Array([5, 6]));

    expect(fs.statSync('/file.txt').mtime).toBeGreaterThan(first ?? -1);
  });

  it('statSync reports the in-cache size after writeFileSync even when a stale handle is open', async () => {
    const root = buildFakeRoot({
      files: new Map([['/file.txt', { bytes: new Uint8Array([1, 2]) }]]),
      dirs: new Set(['/']),
    });
    const fs = new OpfsFsSync(root);
    await fs.refreshIndex();
    (fs as unknown as { readonly handles: Map<string, FileSystemSyncAccessHandle> }).handles.set(
      '/file.txt',
      {
        getSize: () => 2,
      } as unknown as FileSystemSyncAccessHandle,
    );

    fs.writeFileSync('/file.txt', new Uint8Array([1, 2, 3, 4]));

    expect(fs.statSync('/file.txt').size).toBe(4);
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

// ---------------------------------------------------------------------------
// Persist-failure ledger (ADR-0187 Corrected): FIFO order alone can't deliver
// "durable stamp implies durable tree" when a per-op quota/perm failure is
// swallowed — flush() must REPORT the divergence so a durability-gated caller
// (the npm install stamp) can refuse to trust it. flush() still never rejects.
// ---------------------------------------------------------------------------

describe('OpfsFsSync persist-failure ledger (ADR-0187 Corrected durability gate)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function deferredPersist(): {
    readonly promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
  } {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function advanceToWatchdog(
    flush: Promise<Awaited<ReturnType<OpfsFsSync['flush']>>>,
  ): Promise<Awaited<ReturnType<OpfsFsSync['flush']>> | null> {
    await vi.runAllTimersAsync();
    return Promise.race([flush, Promise.resolve(null)]);
  }

  it('does not charge healthy FIFO queue wait against the active persist watchdog', async () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async (path) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
        completed.push(path);
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/a.txt', new Uint8Array([1]));
    fs.writeFileSync('/b.txt', new Uint8Array([2]));
    fs.writeFileSync('/c.txt', new Uint8Array([3]));

    const flush = fs.flush();
    await vi.runAllTimersAsync();

    await expect(flush).resolves.toMatchObject({ total: 0, failures: [] });
    expect(completed).toEqual(['/a.txt', '/b.txt', '/c.txt']);
  });

  it('flush captures a FIFO sequence watermark and does not wait for later writes', async () => {
    const first = deferredPersist();
    const later = deferredPersist();
    const started: string[] = [];
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path) => {
        started.push(path);
        return path === '/first.txt' ? first.promise : later.promise;
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/first.txt', new Uint8Array([1]));
    const firstFlush = fs.flush();
    fs.writeFileSync('/later.txt', new Uint8Array([2]));

    first.resolve();
    await waitForMicrotaskCondition(() => started.includes('/later.txt'), 'later write-through');
    await expect(firstFlush).resolves.toMatchObject({ total: 0 });

    later.resolve();
    await expect(fs.flush()).resolves.toMatchObject({ total: 0 });
  });

  it('bounds a hung persist, keeps the mirror live, and heals when the operation finishes late', async () => {
    vi.useFakeTimers();
    const persist = deferredPersist();
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => persist.promise,
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/hung.txt', new Uint8Array([1]));

    const firstFlush = fs.flush();
    try {
      const report = await advanceToWatchdog(firstFlush);

      expect(report).not.toBeNull();
      expect(report).toMatchObject({
        total: 1,
        failures: [expect.objectContaining({ path: '/hung.txt', op: 'write' })],
      });
      expect([...fs.readFileBytesSync('/hung.txt')]).toEqual([1]);

      // Reporting is bounded independently of the FIFO operation itself:
      // later flush callers answer dirty instead of parking behind it.
      await expect(fs.flush()).resolves.toMatchObject({ total: 1 });

      // The underlying browser operation cannot be cancelled. If it succeeds
      // after the watchdog fired, its ordinary success path heals the ledger.
      persist.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await expect(fs.flush()).resolves.toMatchObject({ total: 0 });
    } finally {
      persist.resolve();
      await firstFlush;
    }
  });

  it('bounds hung mkdir/rm/rename siblings through the same reporting seam', async () => {
    vi.useFakeTimers();

    const mkdirPersist = deferredPersist();
    const mkdirRoot = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    (mkdirRoot as { getDirectoryHandle: unknown }).getDirectoryHandle = () =>
      mkdirPersist.promise.then(() => mkdirRoot);
    const mkdirFs = new OpfsFsSync(mkdirRoot);
    mkdirFs.mkdirSync('/hung-dir', { recursive: true });
    const mkdirFlush = mkdirFs.flush();
    const mkdirReport = await advanceToWatchdog(mkdirFlush);
    expect(mkdirReport).toMatchObject({
      total: 1,
      failures: [expect.objectContaining({ path: '/hung-dir', op: 'mkdir' })],
    });
    expect(mkdirFs.existsSync('/hung-dir')).toBe(true);
    mkdirPersist.resolve();
    await mkdirFlush;
    await Promise.resolve();
    await expect(mkdirFs.flush()).resolves.toMatchObject({ total: 0 });

    const rmPersist = deferredPersist();
    const rmRoot = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const resolvedSurface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const rmFs = new OpfsFsSync(rmRoot, resolvedSurface);
    rmFs.writeFileSync('/gone.txt', new Uint8Array([1]));
    await rmFs.flush();
    (rmRoot as { removeEntry: unknown }).removeEntry = () => rmPersist.promise;
    rmFs.rmSync('/gone.txt');
    const rmFlush = rmFs.flush();
    const rmReport = await advanceToWatchdog(rmFlush);
    expect(rmReport).toMatchObject({
      total: 1,
      failures: [expect.objectContaining({ path: '/gone.txt', op: 'rm' })],
    });
    expect(rmFs.existsSync('/gone.txt')).toBe(false);
    rmPersist.resolve();
    await rmFlush;
    await Promise.resolve();
    await expect(rmFs.flush()).resolves.toMatchObject({ total: 0 });

    const renamePersist = deferredPersist();
    let hangRename = false;
    const renameSurface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array([1])),
      writeFile: (path) =>
        hangRename && path === '/after.txt' ? renamePersist.promise : Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const renameRoot = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const renameFs = new OpfsFsSync(renameRoot, renameSurface);
    renameFs.writeFileSync('/before.txt', new Uint8Array([1]));
    await renameFs.flush();
    hangRename = true;
    renameFs.renameSync('/before.txt', '/after.txt');
    const renameFlush = renameFs.flush();
    const renameReport = await advanceToWatchdog(renameFlush);
    expect(renameReport).toMatchObject({
      total: 2,
    });
    expect(renameReport?.anyFailure?.((path) => path === '/before.txt')).toBe(true);
    expect(renameReport?.anyFailure?.((path) => path === '/after.txt')).toBe(true);
    expect(renameFs.existsSync('/before.txt')).toBe(false);
    expect([...renameFs.readFileBytesSync('/after.txt')]).toEqual([1]);
    renamePersist.resolve();
    await renameFlush;
    await Promise.resolve();
    await expect(renameFs.flush()).resolves.toMatchObject({ total: 0 });
  });

  it('heals the full empty-directory rename footprint after late success', async () => {
    vi.useFakeTimers();
    const removePersist = deferredPersist();
    const fake = buildMutableRoot({ dirs: ['/', '/before', '/before/empty'] });
    const removeEntry = fake.root.removeEntry.bind(fake.root);
    (fake.root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = async (
      name,
      options,
    ) => {
      if (name === 'before') await removePersist.promise;
      await removeEntry(name, options);
    };
    const fs = new OpfsFsSync(fake.root);
    await fs.refreshIndex();

    fs.renameSync('/before', '/after');
    const timedOutFlush = fs.flush();
    const timedOut = await advanceToWatchdog(timedOutFlush);
    expect(timedOut).toMatchObject({ total: 3 });
    expect(timedOut?.anyFailure?.((path) => path === '/after')).toBe(true);
    expect(timedOut?.anyFailure?.((path) => path === '/after/empty')).toBe(true);

    removePersist.resolve();
    await timedOutFlush;
    await Promise.resolve();
    await expect(fs.flush()).resolves.toMatchObject({ total: 0, failures: [] });
  });

  it('replaces a hung ledger record with the eventual persist rejection', async () => {
    vi.useFakeTimers();
    const persist = deferredPersist();
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => persist.promise,
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/late-reject.txt', new Uint8Array([1]));
    const firstFlush = fs.flush();
    const hung = await advanceToWatchdog(firstFlush);
    expect(hung?.failures[0]?.message).toMatch(/did not settle/);

    persist.reject(new Error('late quota rejection'));
    await firstFlush;
    await Promise.resolve();
    await expect(fs.flush()).resolves.toMatchObject({
      total: 1,
      failures: [expect.objectContaining({ message: 'late quota rejection' })],
    });
  });

  it('does not let an older late success erase a newer same-path watchdog failure', async () => {
    vi.useFakeTimers();
    const first = deferredPersist();
    const second = deferredPersist();
    let writes = 0;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => (++writes === 1 ? first.promise : second.promise),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/same-path.txt', new Uint8Array([1]));
    fs.writeFileSync('/same-path.txt', new Uint8Array([2]));

    const timedOut = fs.flush();
    await vi.runAllTimersAsync();
    await expect(timedOut).resolves.toMatchObject({ total: 1 });
    expect(writes).toBe(1);

    first.resolve();
    await waitForMicrotaskCondition(() => writes === 2, 'second same-path write-through');

    // The second write is now ACTIVE. A new flush gets its fresh active-I/O
    // barrier instead of reusing the predecessor's already-released report.
    // Its own watchdog must preserve the newer same-path failure.
    const secondFlush = fs.flush();
    await vi.runAllTimersAsync();
    await expect(secondFlush).resolves.toMatchObject({
      total: 1,
      failures: [
        expect.objectContaining({
          path: '/same-path.txt',
          op: 'write',
          message: expect.stringContaining('did not settle'),
        }),
      ],
    });

    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await expect(fs.flush()).resolves.toMatchObject({ total: 0 });
  });

  it('flush() resolves (never rejects) and REPORTS a swallowed write-through failure; a later success HEALS it', async () => {
    let fail = true;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () =>
        fail ? Promise.reject(new DomError('QuotaExceededError')) : Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/f.txt', new Uint8Array([1]));
    const report = await fs.flush();
    expect(report.total).toBe(1);
    expect(report.failures).toEqual([
      { path: '/f.txt', op: 'write', message: 'QuotaExceededError' },
    ]);
    // The sync view is untouched — the cache still serves this realm.
    expect([...fs.readFileBytesSync('/f.txt')]).toEqual([1]);

    // Heal-on-success: a re-write of the SAME path that persists (freed
    // quota, re-install) clears the entry — the divergence is gone.
    fail = false;
    fs.writeFileSync('/f.txt', new Uint8Array([2]));
    expect((await fs.flush()).total).toBe(0);
  });

  it('records a failed DIRECTORY persist — a missing tree dir is a durability gap too', async () => {
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    // The fake root rejects unknown dirs (its getDirectoryHandle ignores
    // `create`) — the mkdir persist fails while the mirror mkdir succeeded.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/node_modules', { recursive: true });
    expect(fs.existsSync('/node_modules')).toBe(true); // mirror has it
    const report = await fs.flush();
    expect(report.total).toBe(1);
    expect(report.failures[0]).toMatchObject({ path: '/node_modules', op: 'mkdir' });
  });

  it('MORE failures than the report sample stay individually healable — total returns to 0 after a big quota event', async () => {
    // Regression (round 11): a capped ledger counted over-cap failures in an
    // opaque overflow with no path identity — they could never heal, so after
    // a large quota event `total` stayed > 0 forever and the visible
    // `npm install` permanently skipped install stamps. The ledger is now
    // uncapped (bounded by distinct paths); only the REPORT is sampled.
    let fail = true;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () =>
        fail ? Promise.reject(new DomError('QuotaExceededError')) : Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    // 120 > the old 100-entry ledger cap — the paths that used to land in the
    // opaque overflow are exactly the ones that could never heal.
    const paths = Array.from({ length: 120 }, (_, i) => `/f${i}.txt`);
    for (const path of paths) fs.writeFileSync(path, new Uint8Array([1]));
    const dirty = await fs.flush();
    expect(dirty.total).toBe(120); // full count…
    expect(dirty.failures.length).toBe(20); // …sampled report

    // Quota freed: re-persist EVERY path — including the ones beyond the
    // sample — and the report must come back fully clean.
    fail = false;
    for (const path of paths) fs.writeFileSync(path, new Uint8Array([2]));
    const healed = await fs.flush();
    expect(healed.total).toBe(0);
    expect(healed.failures).toEqual([]);
  });

  it('anyFailure scans the FULL ledger — a path BEYOND the report sample is still found (round 18)', async () => {
    // A durability gate that scanned only `failures` (the sample) would MISS
    // tree damage when foreign failures fill the first PERSIST_REPORT_SAMPLE;
    // `anyFailure` asks the whole ledger. All paths sit under `/` so only writes
    // fail (no mkdir noise); insertion order puts the tree file 21st.
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.reject(new DomError('QuotaExceededError')),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    for (let i = 0; i < 20; i++) fs.writeFileSync(`/foreign-${i}.json`, new Uint8Array([1]));
    fs.writeFileSync('/the-tree-file.js', new Uint8Array([1])); // 21st → beyond the sample
    const report = await fs.flush();
    expect(report.total).toBe(21);
    expect(report.failures.length).toBe(20); // sampled
    expect(report.failures.some((f) => f.path === '/the-tree-file.js')).toBe(false); // not sampled
    expect(report.anyFailure?.((p) => p === '/the-tree-file.js')).toBe(true); // FULL ledger
  });

  it('a recursive rm HEALS ledger entries under the removed subtree — a gone tree is not a torn tree (round 15)', async () => {
    // A failed write under /dir left a ledger entry; removing /dir durably
    // means disk and mirror AGREE the path is gone — the stale entry must not
    // keep making flush() report a divergence (it wrongly skipped/revoked
    // install stamps).
    let fail = true;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () =>
        fail ? Promise.reject(new DomError('QuotaExceededError')) : Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/dir']) });
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/dir', { recursive: true }); // persist succeeds — the fake root has /dir
    fs.writeFileSync('/dir/a.txt', new Uint8Array([1]));
    expect((await fs.flush()).total).toBe(1); // the write never persisted
    fail = false;
    fs.rmSync('/dir', { recursive: true }); // removeEntry succeeds in the fake
    expect((await fs.flush()).total).toBe(0); // subtree gone → entries healed
  });

  it('a fully-persisted RENAME heals the moved paths — the destination write is the heal (round 15)', async () => {
    // '/a.txt' failed to persist, then was renamed to '/b.txt': the rename's
    // persist writes the CURRENT bytes at the destination and removes the
    // source — no divergence remains on either path.
    let failWrites = true;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.reject(new DomError('NotFoundError')),
      writeFile: (path: string) =>
        failWrites && path === '/a.txt'
          ? Promise.reject(new DomError('QuotaExceededError'))
          : Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/a.txt', new Uint8Array([1]));
    expect((await fs.flush()).total).toBe(1); // '/a.txt' never persisted
    failWrites = false;
    fs.renameSync('/a.txt', '/b.txt'); // rename persist writes '/b.txt' + rms '/a.txt'
    const healed = await fs.flush();
    expect(healed.total).toBe(0);
    expect([...fs.readFileBytesSync('/b.txt')]).toEqual([1]); // mirror moved the bytes
  });

  it('an rm whose OPFS entry is ALREADY GONE reads as success (disk agrees), not a failure', async () => {
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    (root as { removeEntry: unknown }).removeEntry = () =>
      Promise.reject(new DomError('NotFoundError'));
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/f.txt', new Uint8Array([1]));
    fs.rmSync('/f.txt');
    expect((await fs.flush()).total).toBe(0); // never-persisted entry: rm target absent = durable
  });

  it('a persisted DESCENDANT write heals a stale ANCESTOR mkdir failure — a proven-present dir is not a torn dir', async () => {
    // /dir's mkdir persist FAILS (the fake root ignores `create`), leaving a
    // mkdir ledger entry. A later write to /dir/a.txt that PERSISTS proves /dir
    // exists on disk: OpfsVfs.writeFile does NOT create parents, so success is
    // proof that the parent chain is already durable. The old code cleared only
    // the exact file path, so the stale ancestor entry lingered and a durable
    // node_modules tree wrongly revoked its install stamp.
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(), // the descendant write PERSISTS
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/dir', { recursive: true }); // persist FAILS — fake root has no /dir
    expect(fs.existsSync('/dir')).toBe(true); // mirror has it
    expect((await fs.flush()).total).toBe(1); // stale /dir mkdir entry
    fs.writeFileSync('/dir/a.txt', new Uint8Array([1])); // write-through persists
    expect((await fs.flush()).total).toBe(0); // ancestor /dir healed by the descendant write
  });

  it('a FAILED descendant write does not heal a stale ancestor mkdir failure', async () => {
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.reject(new DomError('NotFoundError')),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/dir', { recursive: true }); // persist FAILS — fake root has no /dir
    expect((await fs.flush()).total).toBe(1);

    fs.writeFileSync('/dir/a.txt', new Uint8Array([1]));
    const report = await fs.flush();

    expect(report.total).toBe(2);
    expect(report.anyFailure?.((path) => path === '/dir')).toBe(true);
    expect(report.anyFailure?.((path) => path === '/dir/a.txt')).toBe(true);
  });

  it('a rename whose SOURCE is already gone (NotFoundError) still heals — a durably-written destination is not torn', async () => {
    // The destination write PERSISTS; only the source removal hits NotFoundError
    // (source never reached disk / already gone = removal success, same rule as
    // persistRmAsync). The old catch recorded EVERY destination as a 'rename'
    // failure, so a durable move read as torn forever and revoked the stamp.
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array([1])),
      writeFile: () => Promise.resolve(), // destination persists
      rm: () => Promise.reject(new DomError('NotFoundError')), // source already gone
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/a.txt', new Uint8Array([1]));
    await fs.flush(); // seed the source (persists)
    fs.renameSync('/a.txt', '/b.txt'); // dest persists; source rm → NotFoundError
    const healed = await fs.flush();
    expect(healed.total).toBe(0); // dest durable + source already-gone = clean
    expect([...fs.readFileBytesSync('/b.txt')]).toEqual([1]);
  });

  it('a successful rename into a previously-dirty destination dir heals that stale dir failure', async () => {
    // /dst's mkdir persist FAILS, so the ledger says the directory is dirty.
    // The later rename writes /dst/a.txt durably; that write proves /dst now
    // exists on disk, so the stale dir entry must be cleared.
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array([1])),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/dst', { recursive: true }); // fake root cannot persist it
    fs.mkdirSync('/src', { recursive: true }); // healed by the descendant write
    fs.writeFileSync('/src/a.txt', new Uint8Array([1]));
    const dirty = await fs.flush();
    expect(dirty.total).toBe(1);
    expect(dirty.failures).toEqual([{ path: '/dst', op: 'mkdir', message: 'NotFoundError' }]);

    fs.renameSync('/src/a.txt', '/dst/a.txt');

    const healed = await fs.flush();
    expect(healed.total).toBe(0);
    expect([...fs.readFileBytesSync('/dst/a.txt')]).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// ADR-0358 replacement pins — the global-FIFO write-through drain is
// superseded by bounded per-path parallel lanes with ancestor-chain gating and
// rm/rename subtree fences. Committed at Contract+RED BEFORE implementation:
// the cross-path pin is RED on main BY DESIGN (main still drains one global
// FIFO); the rest are GREEN preservation pins that must pass on main AND
// survive parallelization.
// ---------------------------------------------------------------------------

describe('OpfsFsSync write-through — per-path parallel drain (ADR-0358 replacement pins)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  // RED on main BY DESIGN: main's global FIFO completes in call order
  // (['/slow', '/fast']). This pin is ADR-0358's REPLACEMENT for the FIFO pin
  // above (which the implementation commit deletes) — RED here documents the
  // superseded contract. Turns green when the drain runs bounded per-path
  // parallel lanes: unrelated paths drain independently, so the fast write
  // completes first.
  it('ops on DIFFERENT paths complete out of call order under inverted latencies (parallel lanes)', async () => {
    const completed: string[] = [];
    const delays: Record<string, number> = { '/slow': 30, '/fast': 0 };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async (path: string) => {
        await new Promise((r) => setTimeout(r, delays[path] ?? 0));
        completed.push(path);
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/slow', new Uint8Array([1])); // slow first…
    fs.writeFileSync('/fast', new Uint8Array([2])); // …fast second
    await fs.flush();
    expect(completed).toEqual(['/fast', '/slow']);
  });

  // GREEN preservation pin: a lane is per-PATH — two writes to the same path
  // keep enqueue order even when the later one could finish faster. Must pass
  // on main (global FIFO implies it) and post-parallel (same-path lane order).
  it('same-path ops complete in call order even when the later write could finish faster', async () => {
    const completed: string[] = [];
    let calls = 0;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async () => {
        const call = ++calls;
        await new Promise((r) => setTimeout(r, call === 1 ? 30 : 0)); // 1st slow, 2nd fast
        completed.push(`call-${call}`);
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/same', new Uint8Array([1]));
    fs.writeFileSync('/same', new Uint8Array([2]));
    await fs.flush();
    expect(completed).toEqual(['call-1', 'call-2']);
  });

  // GREEN preservation pin: ancestor-chain gating — OpfsVfs.writeFile creates
  // no parents, so a child write persist must wait for its ancestor mkdir
  // persist even though the two live on DIFFERENT paths (per-path lanes alone
  // would race them).
  it('ancestor mkdir persist completes before its child write persist', async () => {
    const events: string[] = [];
    // '/a' pre-exists in the FAKE (not the mirror — no refreshIndex) so the
    // inner getDirectoryHandle resolves; the local delegating wrapper adds the
    // ~20ms latency + completion log without editing buildFakeRoot.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/a']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      await new Promise<void>((r) => setTimeout(r, 20));
      events.push('mkdir-resolved');
      return handle;
    };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => {
        events.push('write-resolved');
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/a', { recursive: true }); // slow persist (root handle, ~20ms)
    fs.writeFileSync('/a/f', new Uint8Array([1])); // instant persist (surface)
    await fs.flush();
    expect(events).toEqual(['mkdir-resolved', 'write-resolved']);
  });

  // GREEN preservation pin: subtree fence — a structural rm on '/a' neither
  // overtakes the slow write under it nor lets the post-rm recreate/write
  // straddle it (same-path /a order + ancestor gating for /a/f2).
  it('rm of a subtree neither overtakes nor straddles ops under it', async () => {
    const events: string[] = [];
    const delays: Record<string, number> = { '/a/f': 30, '/a/f2': 0 };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async (path: string) => {
        await new Promise((r) => setTimeout(r, delays[path] ?? 0));
        events.push(`write ${path}`);
      },
      rm: () => Promise.resolve(),
    };
    // '/a' pre-exists in the FAKE so both mkdir persists resolve; the base
    // root's permissive removeEntry resolves fast. Local delegating wrappers
    // only add completion logging (buildFakeRoot untouched).
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/a']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`mkdir /${name}`);
      return handle;
    };
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = async (
      name,
      options,
    ) => {
      await innerRemove(name, options);
      events.push(`rm /${name}`);
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/a', { recursive: true });
    fs.writeFileSync('/a/f', new Uint8Array([1])); // slow write under /a
    fs.rmSync('/a', { recursive: true }); // fast rm of the whole subtree
    fs.mkdirSync('/a', { recursive: true }); // recreate…
    fs.writeFileSync('/a/f2', new Uint8Array([2])); // …and a fast write under it
    await fs.flush();
    expect(events).toEqual(['mkdir /a', 'write /a/f', 'rm /a', 'mkdir /a', 'write /a/f2']);
  });

  // GREEN preservation pin: rename fence — persistRenameAsync's observable
  // legs (destination dir create via root getDirectoryHandle, file move via
  // surface.writeFile, source removal via surface.rm) all complete AFTER an
  // earlier write persist inside the moved subtree AND all complete BEFORE a
  // later write into the destination: no straddle on either side, and the
  // successor never interleaves between the rename's own legs.
  it('rename persist is fenced on both sides — after the source-subtree write, before the destination successor', async () => {
    const events: string[] = [];
    const delays: Record<string, number> = { '/a/f': 30 };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async (path: string) => {
        await new Promise((r) => setTimeout(r, delays[path] ?? 0));
        events.push(`write ${path}`);
      },
      rm: (path: string) => {
        events.push(`rm ${path}`);
        return Promise.resolve();
      },
    };
    // '/a' and '/b' pre-exist in the FAKE so the mkdir persist and the
    // rename's destination dir create both resolve; wrapper logs dir creates.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/a', '/b']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`dir /${name}`);
      return handle;
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/a', { recursive: true });
    fs.writeFileSync('/a/f', new Uint8Array([1])); // slow write INSIDE the soon-moved subtree
    fs.renameSync('/a', '/b');
    fs.writeFileSync('/b/g', new Uint8Array([3])); // fast successor INTO the destination
    await fs.flush();
    const writeIdx = events.indexOf('write /a/f');
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    // Every rename persist leg completes strictly after the fenced write.
    for (const renameEvent of ['dir /b', 'write /b/f', 'rm /a'] as const) {
      expect(events.indexOf(renameEvent)).toBeGreaterThan(writeIdx);
    }
    // After-fence: the successor write into the destination completes only
    // after EVERY rename leg — no overtake into '/b', and no interleaving of
    // the '/b/g' write between the rename's dir-create/file-move/rm-source
    // steps.
    const afterIdx = events.indexOf('write /b/g');
    expect(afterIdx).toBeGreaterThanOrEqual(0);
    for (const renameEvent of ['dir /b', 'write /b/f', 'rm /a'] as const) {
      expect(events.indexOf(renameEvent)).toBeLessThan(afterIdx);
    }
  });

  // RED on main BY DESIGN (frozen-assumption kill): main's serial FIFO admits
  // ONE persist at a time, so with every boundary held open the in-flight
  // peak is exactly 1 and the `> 1` half fails. Turns green when bounded
  // parallel lanes admit unrelated ops concurrently. The `<= 16` half pins
  // ADR-0358's ~16-lane admission ceiling FOREVER: an unbounded fan-out (one
  // in-flight boundary per path — 25 ops here) can never pass this pin. The
  // mix includes a disjoint HELD dir+file RENAME so persistRenameAsync's
  // multi-path admission obeys the same cap. Accounting: a rename persist is
  // ONE queued op crossing THREE sequential physical boundaries — destination
  // dir create (root getDirectoryHandle), file move (surface.writeFile),
  // source removal (surface.rm) — and the instrumentation counts each
  // boundary ENTRY into inFlight, exactly as it already counts mkdir-chain
  // getDirectoryHandle entries; the rename's snapshot surface.readFile hop
  // stays instant and uncounted like every pin's readFile. Releases are
  // schedule-agnostic: every held boundary settles only after ALL 25 ops are
  // enqueued (macrotask, then release in entry order), so serial and
  // parallel drains both observe fully-held boundaries deterministically.
  it('>16 held persists on unrelated paths fan out beyond one lane but never beyond the ~16-lane ceiling', async () => {
    const TOTAL = 27; // 24 single-boundary ops + the rename's 3 sequential boundaries
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    // Boundary instrumentation: inc when a persist task ENTERS its
    // surface/root call, dec when that call settles; the call itself stays
    // HELD by a deferred until this test releases it.
    const heldBoundary = (): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<void>((release) => {
        releases.push(release);
      }).finally(() => {
        inFlight -= 1;
      });
    };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => heldBoundary(),
      // Only the rename's source-removal leg reaches surface.rm (rmSync
      // persists via root removeEntry) — held like every other boundary.
      rm: () => heldBoundary(),
    };
    // mkdir targets + the rm target + the rename source tree ('/mv-src' with
    // one file) pre-exist in the FAKE so every inner call resolves once
    // released; refreshIndex runs BEFORE the held wrappers go in and puts
    // '/rm-target' and '/mv-src'(+file) in the mirror so rmSync/renameSync
    // accept them.
    const fakeDirs = new Set([
      '/',
      '/d0',
      '/d1',
      '/d2',
      '/d3',
      '/d4',
      '/d5',
      '/d6',
      '/d7',
      '/mv-src',
    ]);
    const root = buildFakeRoot({
      files: new Map([
        ['/rm-target', { bytes: new Uint8Array([1]) }],
        ['/mv-src/f', { bytes: new Uint8Array([7]) }],
      ]),
      dirs: fakeDirs,
    });
    const fs = new OpfsFsSync(root, surface);
    await fs.refreshIndex();
    // '/mv-dst' becomes resolvable in the FAKE only after refreshIndex, so the
    // mirror never sees it pre-rename (buildFakeRoot reads the live set).
    fakeDirs.add('/mv-dst');
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = (name, options) => heldBoundary().then(() => innerGetDir(name, options));
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = (
      name,
      options,
    ) => heldBoundary().then(() => innerRemove(name, options));

    // 25 ops on UNRELATED paths, MIXED kinds: 15 surface writes + 8 mkdirs
    // (root getDirectoryHandle) + 1 rm (root removeEntry) + 1 dir+file rename
    // (three held boundaries — accounting note above).
    for (let i = 0; i < 8; i++) fs.writeFileSync(`/w${i}`, new Uint8Array([i]));
    for (let i = 0; i < 8; i++) fs.mkdirSync(`/d${i}`, { recursive: true });
    fs.rmSync('/rm-target');
    fs.renameSync('/mv-src', '/mv-dst');
    for (let i = 8; i < 15; i++) fs.writeFileSync(`/w${i}`, new Uint8Array([i]));

    // All 25 enqueued; admitted lanes now hold their boundaries open.
    await new Promise<void>((r) => setTimeout(r, 0));
    // Macrotask-based wait: one tick drains the full microtask chain between
    // a release and the next boundary entry — schedule-agnostic under both a
    // serial drain (boundaries appear one by one) and parallel lanes (up to
    // 16 appear at once, the rest after earlier releases).
    const waitForBoundary = async (count: number): Promise<void> => {
      for (let tick = 0; tick < 50; tick++) {
        if (releases.length >= count) return;
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      throw new Error(`Timed out waiting for persist boundary ${count}`);
    };
    for (let i = 0; i < TOTAL; i++) {
      await waitForBoundary(i + 1);
      releases[i]?.();
    }
    const report = await fs.flush();

    expect(peak).toBeGreaterThan(1); // RED on main: serial FIFO peak === 1
    expect(peak).toBeLessThanOrEqual(16); // ADR-0358 ceiling — unbounded fan-out can never pass
    expect(releases.length).toBe(TOTAL);
    expect(report.total).toBe(0);
  });

  // GREEN preservation pin (fault row a, quota-perm-fail): a quota-style
  // per-op REJECTION stays confined to its own op — concurrent sibling
  // persists complete at the surface, the ledger records exactly the failed
  // path, and a later successful re-write heals it. End-state asserts only:
  // schedule-agnostic (serial FIFO today, overlapping lanes later).
  it("a quota-rejected write leaves both concurrent siblings to complete and heals on a later '/fail' success", async () => {
    const completedAtSurface: string[] = [];
    let quotaFails = true;
    const delays: Record<string, number> = { '/fail': 10, '/sib-fast': 0, '/sib-slow': 20 };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async (path: string) => {
        await new Promise((r) => setTimeout(r, delays[path] ?? 0));
        if (quotaFails && path === '/fail') throw new DomError('QuotaExceededError');
        completedAtSurface.push(path);
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/fail', new Uint8Array([1])); // rejects at ~10ms
    fs.writeFileSync('/sib-fast', new Uint8Array([2])); // resolves ~0ms
    fs.writeFileSync('/sib-slow', new Uint8Array([3])); // resolves ~20ms
    const report = await fs.flush();
    expect(completedAtSurface).toContain('/sib-fast');
    expect(completedAtSurface).toContain('/sib-slow');
    expect(report.total).toBe(1);
    expect(report.failures).toEqual([
      { path: '/fail', op: 'write', message: 'QuotaExceededError' },
    ]);
    expect(report.anyFailure?.((path) => path === '/fail')).toBe(true);

    // Freed quota: a later successful '/fail' write heals the entry.
    quotaFails = false;
    fs.writeFileSync('/fail', new Uint8Array([4]));
    expect((await fs.flush()).total).toBe(0);
  });

  // GREEN preservation pin (fault row b, quota-perm-fail heal leg) — the
  // sequence-aware-ledger pin (opfs-sync.ts healAncestorPersistFailures /
  // operationSequence): the '/a/f' write persist SUCCEEDS fast while the
  // earlier '/a' mkdir persist REJECTS slowly. The child write's success
  // proves '/a' exists on disk, so the stale ancestor mkdir failure must not
  // survive REGARDLESS of which persist settles first. On main's FIFO
  // (record-then-heal) this passes; a naive parallel drain that inverts to
  // heal-then-record would leave '/a' ledgered forever.
  it('ledger heal is sequence-ordered, not completion-ordered — a fast child write success clears a slow ancestor mkdir rejection', async () => {
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      if (name === 'a') {
        await new Promise<void>((r) => setTimeout(r, 20));
        throw new DomError('QuotaExceededError'); // '/a' mkdir persist: slow REJECT
      }
      return innerGetDir(name, options);
    };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(), // '/a/f' write persist: resolves ~0ms
      rm: () => Promise.resolve(),
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/a', { recursive: true });
    fs.writeFileSync('/a/f', new Uint8Array([1]));
    expect((await fs.flush()).total).toBe(0);
  });

  // GREEN preservation pin (fault row b, same-path leg): the LATER same-path
  // op owns the ledger entry — write1 slow-REJECTS, write2 fast-resolves;
  // the operationSequence guard keeps write2's success authoritative over
  // write1's stale failure whichever settles first.
  it('a later same-path write success owns the ledger entry over an earlier slow rejection', async () => {
    let calls = 0;
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: async () => {
        if (++calls === 1) {
          await new Promise<void>((r) => setTimeout(r, 20));
          throw new DomError('QuotaExceededError'); // write1: slow REJECT
        }
        // write2: resolves ~0ms
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/x', new Uint8Array([1]));
    fs.writeFileSync('/x', new Uint8Array([2]));
    expect((await fs.flush()).total).toBe(0);
  });

  // GREEN preservation pin (fault row e, poisoned-cache): a structural rm
  // INVALIDATES any drain-scoped parent-dir-handle cache — the post-rm
  // recreate must resolve '/a' FRESH from the root (a cached pre-rm handle
  // would resurrect the deleted incarnation) and the final '/a/f' persist
  // must carry the v2 bytes. Guards ADR-0358's structurally-invalidated
  // cache.
  it('a structural rm forces fresh parent resolution — recreate resolves after removeEntry and the last write carries v2', async () => {
    const events: string[] = [];
    const afWrites: number[][] = [];
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string, data: Uint8Array) => {
        if (path === '/a/f') afWrites.push([...data]);
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    // '/a' pre-exists in the FAKE so both mkdir persists resolve; the base
    // root's permissive removeEntry resolves fast (buildFakeRoot untouched —
    // local delegating wrappers only log).
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/a']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`dir-resolved /${name}`);
      return handle;
    };
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = async (
      name,
      options,
    ) => {
      await innerRemove(name, options);
      events.push(`removeEntry /${name}`);
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/a', { recursive: true });
    fs.writeFileSync('/a/f', new Uint8Array([1])); // v1
    fs.rmSync('/a', { recursive: true });
    fs.mkdirSync('/a', { recursive: true }); // recreate…
    fs.writeFileSync('/a/f', new Uint8Array([2])); // …v2
    await fs.flush();

    const rmIdx = events.indexOf('removeEntry /a');
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    // At least one '/a' dir resolution happens AFTER the removeEntry — the
    // recreate resolved FRESH, never a served pre-rm handle.
    expect(events.some((event, i) => event === 'dir-resolved /a' && i > rmIdx)).toBe(true);
    expect(afWrites[afWrites.length - 1]).toEqual([2]);
  });

  // GREEN preservation pin (fault row e, poisoned-cache — RENAME sibling of
  // the rm pin above): ADR-0358's drain-scoped dir-handle cache is
  // structurally invalidated on rm AND rename, sweeping cached SOURCE and
  // DESTINATION ancestors/descendants. ONE drain end-to-end: warm-up, the
  // rename, and the post-rename ops enqueue with NO intervening flush, so a
  // drain-scoped cache built during warm-up is still LIVE when the rename
  // persists — BOTH sides poisoned in the same drain (a flush between
  // warm-up and rename would end the cache's lifetime and let a missing
  // rename invalidation pass unnoticed). Shape: renameSync rejects a
  // non-empty existing target (ENOTEMPTY — opfs-sync.ts renameSync), so
  // '/b' cannot be both warmed non-empty and the target; instead '/b'
  // itself is warmed (mkdir + child write) and '/a/sub' moves to the fresh
  // '/b/moved' — source parent '/a' AND destination parent '/b' are both
  // resolved/cached in-drain before the structural op. A cached pre-rename
  // source or destination handle serving any post-rename persist fails
  // below: serving the warm '/b' for the rename's destination chain drops
  // the second root '/b' resolution; serving the warm '/a'/'/a/sub' for the
  // recreate never returns to the root after the rename's source-rm. GREEN
  // on main (FIFO + no cache); must survive parallelization.
  it('a structural rename poisons BOTH warmed sides in ONE drain — the destination chain re-resolves fresh at the root, the recreated source resolves after the source-rm, and moved bytes land byte-exact at the new paths', async () => {
    const events: string[] = [];
    const lastWriteBytes = new Map<string, number[]>();
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string, data: Uint8Array) => {
        lastWriteBytes.set(path, [...data]);
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: (path: string) => {
        events.push(`rm ${path}`);
        return Promise.resolve();
      },
    };
    // Every dir chain pre-exists in the FAKE so persistDirectoryPath resolves
    // (the fake creates nothing); the local delegating wrapper logs
    // ROOT-level resolutions only (buildFakeRoot untouched).
    const root = buildFakeRoot({
      files: new Map(),
      dirs: new Set(['/', '/a', '/a/sub', '/b', '/b/moved']),
    });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`dir /${name}`);
      return handle;
    };
    const fs = new OpfsFsSync(root, surface);
    // ONE uninterrupted enqueue sequence — no flush until the single final one.
    fs.mkdirSync('/a/sub', { recursive: true }); // warm SOURCE chain '/a','/a/sub'
    fs.writeFileSync('/a/sub/f', new Uint8Array([1])); // v1 — moves with the subtree
    fs.mkdirSync('/b', { recursive: true }); // warm DESTINATION parent '/b'…
    fs.writeFileSync('/b/w', new Uint8Array([9])); // …v9 child: '/b' resolved in-drain
    fs.renameSync('/a/sub', '/b/moved'); // structural op against WARM handles
    fs.writeFileSync('/b/moved/g', new Uint8Array([3])); // v3 into the moved destination
    fs.mkdirSync('/a/sub', { recursive: true }); // recreate the vacated source…
    fs.writeFileSync('/a/sub/h', new Uint8Array([4])); // …v4 under it
    const report = await fs.flush(); // ONE final flush

    // Rename leg order (persistRenameAsync): the moved file writes durably
    // BEFORE the source subtree is removed.
    const rmIdx = events.indexOf('rm /a/sub');
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    const moveIdx = events.indexOf('write /b/moved/f');
    expect(moveIdx).toBeGreaterThanOrEqual(0);
    expect(moveIdx).toBeLessThan(rmIdx);

    // (1) Destination side resolves FRESH where observable at the root
    // wrapper: warm-up resolves root '/b' exactly once (its mkdir persist);
    // the rename's destination chain must hit the ROOT for '/b' AGAIN
    // instead of serving the drain-cached warm handle — two root '/b'
    // resolutions in total. A cache without rename invalidation yields one.
    expect(events.filter((event) => event === 'dir /b').length).toBeGreaterThanOrEqual(2);

    // (2) Moved bytes land byte-exact at the NEW paths; the destination
    // successor completes after the rename's last leg (both-side fence pin
    // above pins the full no-straddle ordering).
    expect(lastWriteBytes.get('/b/moved/f')).toEqual([1]);
    expect(lastWriteBytes.get('/b/moved/g')).toEqual([3]);
    expect(lastWriteBytes.get('/b/w')).toEqual([9]);
    expect(events.indexOf('write /b/moved/g')).toBeGreaterThan(rmIdx);

    // (3) NO surface write ever targets the dead source subtree after the
    // rename's source-rm: the ONLY post-rm '/a/sub/...' write is the
    // recreate's '/a/sub/h' — a cached pre-rename source handle would land
    // warm-up bytes at the dead path instead.
    expect(events.slice(rmIdx + 1).filter((event) => event.startsWith('write /a/sub/'))).toEqual([
      'write /a/sub/h',
    ]);
    expect(events.lastIndexOf('write /a/sub/f')).toBeLessThan(rmIdx);

    // (4) Recreated source resolves after the rename's source-rm: the
    // recreate's mkdir chain hits the ROOT for '/a' strictly AFTER
    // 'rm /a/sub' — a cache serving the warm '/a'/'/a/sub' handles would
    // never return to the root, resurrecting the vacated incarnation.
    expect(events.some((event, i) => event === 'dir /a' && i > rmIdx)).toBe(true);
    expect(lastWriteBytes.get('/a/sub/h')).toEqual([4]);

    // (5) Final ledger clean — every persist in the single drain succeeded.
    expect(report.total).toBe(0);
  });

  // GREEN preservation pin (fault row e, poisoned-cache — TWO-DRAIN lifetime
  // sibling of the rm/rename pins above): every cache pin above lives inside
  // ONE drain, so a dir-handle cache that OUTLIVES its drain (survives
  // flush()) passes them all. ADR-0358: the cache is "drain-scoped,
  // structurally invalidated" — BOTH halves are load-bearing; this pins the
  // drain-scoped half. Kill target: a cache-outlives-its-drain
  // incarnation-replacement mutant that carries drain 1's warm '/a' handle
  // into drain 2 — the recreate then serves the DEAD pre-rm incarnation:
  // no fresh root '/a' resolution after the rm's removeEntry, and the
  // recreated '/a/f' persists against the removed directory object. GREEN on
  // main (no cache — every persist resolves fresh); must survive
  // parallelization.
  it("a drain-scoped dir-handle cache dies at flush() — drain 2's recreate resolves '/a' fresh after the rm and the last '/a/f' write carries v2", async () => {
    const events: string[] = [];
    const afWrites: number[][] = [];
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string, data: Uint8Array) => {
        if (path === '/a/f') afWrites.push([...data]);
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    // '/a' pre-exists in the FAKE so both drains' mkdir persists resolve; the
    // base root's permissive removeEntry resolves fast and never mutates dirs
    // (buildFakeRoot untouched — local delegating wrappers only log).
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/a']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`dir-resolved /${name}`);
      return handle;
    };
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = async (
      name,
      options,
    ) => {
      await innerRemove(name, options);
      events.push(`removeEntry /${name}`);
    };
    const fs = new OpfsFsSync(root, surface);

    // Drain 1 — warm '/a' into any drain-scoped dir-handle cache.
    fs.mkdirSync('/a', { recursive: true });
    fs.writeFileSync('/a/f', new Uint8Array([1])); // v1
    expect((await fs.flush()).total).toBe(0); // drain ENDS — the cache must die here

    // Drain 2 — remove the incarnation drain 1 warmed, then recreate it.
    const drainTwoStart = events.length;
    fs.rmSync('/a', { recursive: true });
    fs.mkdirSync('/a', { recursive: true }); // recreate…
    fs.writeFileSync('/a/f', new Uint8Array([2])); // …v2
    const report = await fs.flush();

    const drainTwo = events.slice(drainTwoStart);
    const rmIdx = drainTwo.indexOf('removeEntry /a');
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    // At least one FRESH root '/a' resolution in drain 2, strictly after the
    // rm's removeEntry — a surviving drain-1 handle never returns to the root.
    expect(drainTwo.some((event, i) => event === 'dir-resolved /a' && i > rmIdx)).toBe(true);
    expect(afWrites[afWrites.length - 1]).toEqual([2]); // last '/a/f' surface write carries v2
    expect(report.total).toBe(0);
  });
});

describe('OpfsFsSync per-lane watchdog (ADR-0358)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // RED on main BY DESIGN: FIFO admission parks '/other' behind the wedged
  // head until the head's REAL promise settles (never) — the PRE-timeout
  // assert below is the designed RED diff (completed [] where ['/other'] is
  // required). Liberation must be UNCONDITIONAL, not timeout-triggered:
  // '/other' completes at the surface while the wedge is still WITHIN its 30s
  // budget, so a release-on-timeout scheduler (frees successors only when the
  // head's watchdog fires) fails the early assert exactly like main's FIFO.
  // Turns green when per-path lanes admit '/other' immediately; after the 30s
  // transition the ledger still holds ONLY '/wedged' (the head's watchdog
  // ledgers no successor as blocked-behind-timed-out-head).
  it('an op on an unrelated path is neither blocked nor ledgered behind a timed-out head', async () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const wedged = new Promise<void>(() => {}); // never settles
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        if (path === '/wedged') return wedged;
        completed.push(path);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    fs.writeFileSync('/wedged', new Uint8Array([1]));
    fs.writeFileSync('/other', new Uint8Array([2]));

    // PRE-timeout liberation: microtasks + a few ticks, nowhere near 30s.
    await Promise.resolve(); // let an already-admitted '/other' lane settle
    await vi.advanceTimersByTimeAsync(50);
    expect(completed).toEqual(['/other']); // designed RED on main: [] — parked behind the wedge

    await vi.advanceTimersByTimeAsync(30_000); // per-op report timeout for '/wedged'
    const report = await fs.flush();

    expect(completed).toEqual(['/other']);
    expect(report.total).toBe(1);
    expect(report.failures).toEqual([expect.objectContaining({ path: '/wedged', op: 'write' })]);
  });

  // RED on main BY DESIGN (composition kill, #256 slice 2): the ceiling pin
  // above releases every held boundary BEFORE any watchdog fires, and the
  // watchdog pin above has a single successor — so an implementation that
  // FREES a timed-out op's capacity slot (admitting a 17th physical persist
  // while the uncancellable wedge is still running) passes both. This pin
  // composes them: the in-flight ceiling is measured ACROSS the 30s watchdog
  // transition with the wedge's boundary still held. It lives in THIS block
  // (not the parallel-drain one) because it pins the watchdog transition's
  // capacity semantics and needs this block's fake-timer teardown. On main
  // the serial FIFO admits one persist at a time and the wedged head admits
  // nothing after it, so peak === 1 and the `> 1` half fails.
  it('a timed-out wedge still occupies a physical lane — sustained mixed-kind backlog across the 30s timeout never exceeds the ~16 ceiling', async () => {
    const NON_WEDGE_TOTAL = 32; // 19 boundaries held across the timeout + 13 entered after it
    let inFlight = 0;
    let peak = 0;
    const completedAtBoundary: string[] = [];
    const releases: Array<() => void> = [];
    // Boundary instrumentation (same shape as the ceiling pin): inc when a
    // persist task ENTERS its surface/root call, dec + completion log when it
    // settles; the call stays HELD by a deferred until this test releases it.
    const enterBoundary = (): void => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
    };
    const heldBoundary = (label: string): Promise<void> => {
      enterBoundary();
      return new Promise<void>((release) => {
        releases.push(release);
      }).finally(() => {
        inFlight -= 1;
        completedAtBoundary.push(label);
      });
    };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        if (path === '/wedged') {
          // The wedge ENTERS its boundary (occupies a physical lane) and
          // never settles — uncancellable browser I/O. It never decrements
          // inFlight: after its watchdog fires, the slot must still count.
          enterBoundary();
          return new Promise<void>(() => {});
        }
        return heldBoundary(path);
      },
      // Only the rename's source-removal leg reaches surface.rm (rmSync
      // persists via root removeEntry) — held + labelled like every boundary.
      rm: (path: string) => heldBoundary(`rm ${path}`),
    };
    // mkdir targets + the rm target + the rename source tree ('/mv-src' with
    // one file) pre-exist in the FAKE so every inner call resolves once
    // released; refreshIndex runs BEFORE fake timers and the held wrappers go
    // in, and puts '/rm-target' and '/mv-src'(+file) in the mirror so
    // rmSync/renameSync accept them.
    const fakeDirs = new Set([
      '/',
      '/d0',
      '/d1',
      '/d2',
      '/d3',
      '/d4',
      '/d5',
      '/d6',
      '/d7',
      '/d8',
      '/d9',
      '/mv-src',
    ]);
    const root = buildFakeRoot({
      files: new Map([
        ['/rm-target', { bytes: new Uint8Array([1]) }],
        ['/mv-src/f', { bytes: new Uint8Array([7]) }],
      ]),
      dirs: fakeDirs,
    });
    const fs = new OpfsFsSync(root, surface);
    await fs.refreshIndex();
    // '/mv-dst' becomes resolvable in the FAKE only after refreshIndex, so the
    // mirror never sees it pre-rename (buildFakeRoot reads the live set).
    fakeDirs.add('/mv-dst');
    vi.useFakeTimers();
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = (name, options) =>
      heldBoundary(`mkdir /${name}`).then(() => innerGetDir(name, options));
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = (
      name,
      options,
    ) => heldBoundary(`rm /${name}`).then(() => innerRemove(name, options));

    // Phase 1 — the wedge + 19 held ops on UNRELATED paths, MIXED kinds:
    // 10 surface writes + 8 mkdirs (root getDirectoryHandle) + 1 rm (root
    // removeEntry). Every admitted boundary stays held across the transition.
    fs.writeFileSync('/wedged', new Uint8Array([0]));
    for (let i = 0; i < 10; i++) fs.writeFileSync(`/w${i}`, new Uint8Array([i]));
    for (let i = 0; i < 8; i++) fs.mkdirSync(`/d${i}`, { recursive: true });
    fs.rmSync('/rm-target');

    await Promise.resolve(); // admitted lanes enter their boundaries
    // Watchdog transition: the wedge times out and is ledgered while every
    // held boundary — its own included — is still physically in flight.
    await vi.advanceTimersByTimeAsync(30_000);

    // Phase 2 — the backlog stays non-empty PAST the transition: 13 more held
    // boundaries (8 writes + 2 mkdirs + a disjoint dir+file rename) enqueued
    // after the wedge was ledgered. The rename is ONE queued op crossing
    // THREE sequential physical boundaries — dest dir create, file move,
    // source rm — each counted into inFlight like mkdir-chain entries (same
    // accounting as the cold ceiling pin). A cap that freed the wedge's slot
    // back-fills from this backlog and overshoots.
    for (let i = 10; i < 18; i++) fs.writeFileSync(`/w${i}`, new Uint8Array([i]));
    fs.mkdirSync('/d8', { recursive: true });
    fs.mkdirSync('/d9', { recursive: true });
    fs.renameSync('/mv-src', '/mv-dst');

    // Macrotask-based wait under fake timers: each tick advances the fake
    // clock 1ms (nowhere near another watchdog) and drains the full microtask
    // chain between a release and the next boundary entry — the ceiling pin's
    // schedule-agnostic idiom, fake-timer edition. Returns false instead of
    // throwing so main (wedged FIFO head admits nothing — `releases` stays
    // empty) falls through to the peak assert, the designed RED diff.
    const waitForBoundary = async (count: number): Promise<boolean> => {
      for (let tick = 0; tick < 50; tick++) {
        if (releases.length >= count) return true;
        await vi.advanceTimersByTimeAsync(1);
      }
      return false;
    };
    // Release every NON-wedge deferred in boundary-entry order; the wedge
    // stays held to the very end.
    for (let i = 0; i < NON_WEDGE_TOTAL; i++) {
      if (!(await waitForBoundary(i + 1))) break;
      releases[i]?.();
    }
    const report = await fs.flush();

    expect(peak).toBeGreaterThan(1); // RED on main: serial FIFO peak === 1
    // Whole-run ceiling, INCLUDING after the timeout transition: the wedge
    // never decrements, so a cap that frees the timed-out op's capacity slot
    // admits a 17th in-flight persist and fails here.
    expect(peak).toBeLessThanOrEqual(16);
    // Every non-wedge op completed at its own boundary…
    expect(releases.length).toBe(NON_WEDGE_TOTAL);
    const expectedBoundaries = [
      ...Array.from({ length: 18 }, (_, i) => `/w${i}`),
      ...Array.from({ length: 10 }, (_, i) => `mkdir /d${i}`),
      'rm /rm-target',
      // The rename's three boundaries: dest dir create (root wrapper label),
      // file move (surface.writeFile label), source rm (surface.rm label).
      'mkdir /mv-dst',
      '/mv-dst/f',
      'rm /mv-src',
    ];
    expect([...completedAtBoundary].sort()).toEqual([...expectedBoundaries].sort());
    // …and the final bounded flush ledgers EXACTLY the wedge.
    expect(report.total).toBe(1);
    expect(report.failures).toEqual([expect.objectContaining({ path: '/wedged', op: 'write' })]);
  });

  // GREEN preservation pin (#256 slice 2, frozen-assumption × unbounded-read):
  // capacity-queue wait is NOT I/O time. Semantics: opfs-sync.ts:126-131 — the
  // 30s bound covers ONE ACTIVE OPFS side effect; "FIFO queue wait is not I/O
  // time", and a per-lane capacity wait inherits that rule. On main this is
  // exactly today's semantics (runPending starts the watchdog at ACTIVE) →
  // GREEN; it must survive parallelization. Kill target: a
  // timer-start-at-enqueue mutant charges the healthy op's ~29s capacity wait
  // against its budget — its watchdog fires ~1s into the op's OWN 5s of I/O,
  // releasing the in-flight flush (started while the op was queued) with the
  // healthy path ledgered as did-not-settle; correct semantics start the clock
  // at admission, so that flush resolves only on the real settle, EMPTY.
  it('a healthy op queued behind a full capacity window is never ledgered — capacity wait is not I/O time', async () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const releases: Array<() => void> = [];
    const HELD = 16; // ≥ the ~16-lane ceiling: every lane stays busy, the healthy op must WAIT
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        if (path === '/healthy') {
          // Admitted at ~29s; its OWN I/O takes 5s (well under 30s), then
          // SUCCEEDS — enqueue-to-settle ~34s, active-to-settle 5s.
          return new Promise<void>((resolve) =>
            setTimeout(() => {
              completed.push(path);
              resolve();
            }, 5_000),
          );
        }
        // Held-boundary idiom (ceiling pins): the call stays open until the
        // test releases it.
        return new Promise<void>((release) => {
          releases.push(() => {
            completed.push(path);
            release();
          });
        });
      },
      rm: () => Promise.resolve(),
    };
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/']) });
    const fs = new OpfsFsSync(root, surface);
    for (let i = 0; i < HELD; i++) fs.writeFileSync(`/h${i}`, new Uint8Array([i]));
    fs.writeFileSync('/healthy', new Uint8Array([99])); // 17th — queued behind the full window
    const flush = fs.flush(); // watermark covers all 17: resolves when their reporting settles

    await Promise.resolve(); // admitted lanes enter their boundaries
    await vi.advanceTimersByTimeAsync(29_000); // long capacity wait, under the 30s bound

    // Release the held window in boundary-entry order (schedule-agnostic:
    // serial FIFO enters one boundary at a time, parallel lanes up to the
    // cap at once) — 1ms ticks, nowhere near any correctly-started watchdog.
    for (let i = 0; i < HELD; i++) {
      for (let tick = 0; tick < 50 && releases.length <= i; tick++) {
        await vi.advanceTimersByTimeAsync(1);
      }
      releases[i]?.();
    }
    // The healthy op is admitted now (~29s) and runs its own 5s of I/O,
    // crossing t=30s MID-I/O — where the timer-start-at-enqueue mutant fires.
    await vi.advanceTimersByTimeAsync(6_000);

    const report = await flush;
    expect(completed).toContain('/healthy'); // completed at the surface after admission
    expect(report.total).toBe(0); // its capacity wait never counted toward the 30s budget
    expect(report.failures).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // GREEN preservation pins — composition gap (#256 slice 2): timeout ×
  // ancestor/rm/rename fences. The two RED pins above prove a timed-out op
  // FREES unrelated work; nothing above proves it RETAINS its routing fences
  // — an implementation that CANCELS a timed-out op's ancestor/subtree
  // fences (freeing dependents to run against the still-in-flight,
  // uncancellable wedge) passes both. ADR-0358 per-lane watchdog clause: a
  // wedged op "blocks only its own lane/fences" — its OWN fences (ancestor
  // gating, rm/rename subtree fences) SURVIVE the 30s report timeout, which
  // releases reporting only, never the physical op. Each pin: wedge one
  // boundary → enqueue a fence DEPENDENT BEFORE the 30s advance (a waiter
  // already queued when the watchdog fires must stay fenced ACROSS the
  // transition — kills a scheduler that keeps fences only for post-timeout
  // enqueues) → watchdog ledgers the wedge → enqueue more dependents + one
  // UNRELATED op AFTER it → grace ticks → NO dependent has completed its
  // boundary; then the wedge is RELEASED AS SUCCESS → everything drains,
  // dependents complete strictly after the wedged boundary in fence order,
  // the unrelated op completes (on main only post-release — FIFO parks it
  // too; post-ADR-0358 it flows mid-wedge — the pin asserts it only after
  // the drain), and every timeout/blocked ledger entry HEALS on its op's
  // late success (equal-sequence heal) → final report total 0. GREEN on main
  // (FIFO parks every successor behind the wedge); kills the
  // fence-cancelling-on-timeout approximation. The last sibling makes the
  // WEDGE ITSELF a held STRUCTURAL op (rm) with recreate successors on both
  // sides of the transition. In THIS block for its fake-timer teardown.
  // -------------------------------------------------------------------------

  it('a timed-out mkdir keeps its ancestor fence — child writes queued before and after the timeout complete only after the wedged mkdir settles', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let releaseMkdir: () => void = () => {};
    const wedge = new Promise<void>((release) => {
      releaseMkdir = release;
    });
    // '/p' pre-exists in the FAKE (not the mirror — no refreshIndex) so the
    // inner getDirectoryHandle resolves once released; the wrapper wedges
    // ONLY the '/p' persist boundary and logs its completion.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/p']) });
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = (name, options) => {
      if (name !== 'p') return innerGetDir(name, options);
      return wedge.then(async () => {
        const handle = await innerGetDir(name, options);
        events.push('mkdir /p');
        return handle;
      });
    };
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    const fs = new OpfsFsSync(root, surface);
    fs.mkdirSync('/p', { recursive: true }); // wedged at the root boundary
    fs.writeFileSync('/p/f', new Uint8Array([1])); // fence DEPENDENT queued BEFORE the timeout

    await Promise.resolve(); // wedge enters its boundary
    await vi.advanceTimersByTimeAsync(30_000); // watchdog ledgers '/p' — '/p/f' already waiting

    fs.writeFileSync('/p/f2', new Uint8Array([3])); // fence DEPENDENT enqueued AFTER the timeout
    fs.writeFileSync('/u', new Uint8Array([2])); // UNRELATED — asserted post-drain

    // Grace ticks (R5 idiom): each advances the fake clock 1ms (nowhere near
    // another watchdog) and drains the microtask chain — room for a
    // fence-cancelling implementation to run the wrongly-freed dependents.
    for (let tick = 0; tick < 10; tick++) await vi.advanceTimersByTimeAsync(1);
    expect(events).not.toContain('write /p/f'); // across-transition waiter stayed fenced
    expect(events).not.toContain('write /p/f2'); // post-timeout enqueue fenced too
    expect(events).not.toContain('mkdir /p'); // wedge still physically in flight

    releaseMkdir(); // wedge settles as SUCCESS → its timeout ledger entry heals
    const done = () =>
      ['mkdir /p', 'write /p/f', 'write /p/f2', 'write /u'].every((event) =>
        events.includes(event),
      );
    for (let tick = 0; tick < 50 && !done(); tick++) await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1); // residual heal/settle hops
    const report = await fs.flush();
    expect(events).toContain('mkdir /p');
    expect(events.indexOf('write /p/f')).toBeGreaterThan(events.indexOf('mkdir /p'));
    expect(events.indexOf('write /p/f2')).toBeGreaterThan(events.indexOf('mkdir /p'));
    expect(events).toContain('write /u');
    expect(report.total).toBe(0);
  });

  it('a timed-out write keeps the rm subtree fence — a recursive rm queued before the timeout and its post-timeout recreate complete only after the wedged write settles', async () => {
    const events: string[] = [];
    let releaseWrite: () => void = () => {};
    const wedge = new Promise<void>((release) => {
      releaseWrite = release;
    });
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        if (path === '/q/f') {
          return wedge.then(() => {
            events.push('write /q/f');
          });
        }
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    // '/q' pre-exists in the FAKE and enters the mirror via refreshIndex
    // (BEFORE fake timers — R5 idiom) so writeFileSync('/q/f') and the
    // recursive rmSync('/q') are accepted. rmSync persists via root
    // removeEntry (never surface.rm); wrappers log COMPLETION of the rm's
    // removeEntry and the post-timeout recreate's getDirectoryHandle.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/q']) });
    const fs = new OpfsFsSync(root, surface);
    await fs.refreshIndex();
    vi.useFakeTimers();
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = async (
      name,
      options,
    ) => {
      await innerRemove(name, options);
      events.push(`removeEntry /${name}`);
    };
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`mkdir /${name}`);
      return handle;
    };
    fs.writeFileSync('/q/f', new Uint8Array([1])); // wedged at the surface boundary
    fs.rmSync('/q', { recursive: true }); // fence DEPENDENT queued BEFORE the timeout

    await Promise.resolve(); // wedge enters its boundary
    await vi.advanceTimersByTimeAsync(30_000); // watchdog ledgers '/q/f' — the rm already waiting

    fs.mkdirSync('/q', { recursive: true }); // post-timeout successor: recreate over the pending rm
    fs.writeFileSync('/q/g', new Uint8Array([2])); // post-timeout successor under the recreate
    fs.writeFileSync('/u', new Uint8Array([3])); // UNRELATED — asserted post-drain

    for (let tick = 0; tick < 10; tick++) await vi.advanceTimersByTimeAsync(1);
    expect(events).not.toContain('removeEntry /q'); // across-transition subtree fence held
    expect(events).not.toContain('mkdir /q'); // recreate fenced behind the pending rm
    expect(events).not.toContain('write /q/g'); // ancestor-fenced behind the recreate
    expect(events).not.toContain('write /q/f'); // wedge still physically in flight

    releaseWrite(); // wedge settles as SUCCESS → its timeout ledger entry heals
    const done = () =>
      ['removeEntry /q', 'mkdir /q', 'write /q/g', 'write /u'].every((event) =>
        events.includes(event),
      );
    for (let tick = 0; tick < 50 && !done(); tick++) await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1); // residual heal/settle hops
    const report = await fs.flush();
    expect(events).toContain('write /q/f');
    // Fence order: wedged write → subtree rm → recreate mkdir → child write.
    expect(events.indexOf('removeEntry /q')).toBeGreaterThan(events.indexOf('write /q/f'));
    expect(events.indexOf('mkdir /q')).toBeGreaterThan(events.indexOf('removeEntry /q'));
    expect(events.indexOf('write /q/g')).toBeGreaterThan(events.indexOf('mkdir /q'));
    expect(events).toContain('write /u');
    expect(report.total).toBe(0);
  });

  it('a timed-out write keeps the rename fences — a rename queued before the timeout completes no leg until the wedged source-subtree write settles', async () => {
    const events: string[] = [];
    let releaseWrite: () => void = () => {};
    const wedge = new Promise<void>((release) => {
      releaseWrite = release;
    });
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        if (path === '/r/f') {
          return wedge.then(() => {
            events.push('write /r/f');
          });
        }
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: (path: string) => {
        events.push(`rm ${path}`);
        return Promise.resolve();
      },
    };
    // '/r' pre-exists in the FAKE and enters the mirror via refreshIndex;
    // '/s' becomes resolvable in the FAKE only after refreshIndex (R4/R5
    // idiom) so the mirror never sees it pre-rename while the rename's dest
    // dir create still resolves at the root once admitted. Legs logged at
    // COMPLETION — the both-side rename-fence pin's instrumentation.
    const fakeDirs = new Set(['/', '/r']);
    const root = buildFakeRoot({ files: new Map(), dirs: fakeDirs });
    const fs = new OpfsFsSync(root, surface);
    await fs.refreshIndex();
    fakeDirs.add('/s');
    vi.useFakeTimers();
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`dir /${name}`);
      return handle;
    };
    fs.writeFileSync('/r/f', new Uint8Array([1])); // wedged at the surface boundary
    fs.renameSync('/r', '/s'); // fence DEPENDENT queued BEFORE the timeout (source + dest fences)

    await Promise.resolve(); // wedge enters its boundary
    await vi.advanceTimersByTimeAsync(30_000); // watchdog ledgers '/r/f' — the rename already waiting

    fs.writeFileSync('/s/g', new Uint8Array([3])); // post-timeout successor INTO the destination
    fs.writeFileSync('/u', new Uint8Array([2])); // UNRELATED — asserted post-drain

    for (let tick = 0; tick < 10; tick++) await vi.advanceTimersByTimeAsync(1);
    // persistRenameAsync's three legs — dest dir create (root
    // getDirectoryHandle), file move (surface.writeFile), source rm
    // (surface.rm) — NONE completes against the in-flight wedge, and neither
    // does the destination successor behind them.
    for (const leg of ['dir /s', 'write /s/f', 'rm /r'] as const) {
      expect(events).not.toContain(leg);
    }
    expect(events).not.toContain('write /s/g'); // fenced behind every rename leg
    expect(events).not.toContain('write /r/f'); // wedge still physically in flight

    releaseWrite(); // wedge settles as SUCCESS → its timeout ledger entry heals
    const done = () =>
      ['dir /s', 'write /s/f', 'rm /r', 'write /s/g', 'write /u'].every((event) =>
        events.includes(event),
      );
    for (let tick = 0; tick < 50 && !done(); tick++) await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1); // residual heal/settle hops
    const report = await fs.flush();
    const wedgeIdx = events.indexOf('write /r/f');
    expect(wedgeIdx).toBeGreaterThanOrEqual(0);
    for (const leg of ['dir /s', 'write /s/f', 'rm /r'] as const) {
      expect(events.indexOf(leg)).toBeGreaterThan(wedgeIdx);
      // The destination successor completes after EVERY rename leg (both-side
      // fence pin's contract) even though it was enqueued post-timeout.
      expect(events.indexOf('write /s/g')).toBeGreaterThan(events.indexOf(leg));
    }
    expect(events).toContain('write /u');
    expect(report.total).toBe(0);
  });

  // Structural-wedge sibling: the WEDGE ITSELF is a held STRUCTURAL op — a
  // recursive rm whose root removeEntry is held past its watchdog. Its
  // subtree fence must survive the timeout in the other direction: recreate
  // successors under '/t' (mkdir + write), queued on BOTH sides of the
  // transition, complete only after the wedged removeEntry settles — a
  // fence-cancelling timeout would recreate '/t' while the uncancellable
  // delete is still in flight and the delete would then eat the recreate.
  it('a timed-out structural rm keeps its subtree fence — recreate mkdirs and writes queued before and after the timeout complete only after the wedged removeEntry settles', async () => {
    const events: string[] = [];
    let releaseRm: () => void = () => {};
    const wedge = new Promise<void>((release) => {
      releaseRm = release;
    });
    const surface: PairedAsyncSurface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path: string) => {
        events.push(`write ${path}`);
        return Promise.resolve();
      },
      rm: () => Promise.resolve(),
    };
    // '/t' pre-exists in the FAKE and enters the mirror via refreshIndex
    // (BEFORE fake timers — R5 idiom) so rmSync('/t') is accepted; the base
    // fake's permissive removeEntry never mutates dirs, so the recreate's
    // getDirectoryHandle('t') still resolves once released. Wrappers log
    // COMPLETION of the wedged removeEntry and each recreate mkdir.
    const root = buildFakeRoot({ files: new Map(), dirs: new Set(['/', '/t']) });
    const fs = new OpfsFsSync(root, surface);
    await fs.refreshIndex();
    vi.useFakeTimers();
    const innerGetDir = root.getDirectoryHandle.bind(root);
    (
      root as { getDirectoryHandle: FileSystemDirectoryHandle['getDirectoryHandle'] }
    ).getDirectoryHandle = async (name, options) => {
      const handle = await innerGetDir(name, options);
      events.push(`mkdir /${name}`);
      return handle;
    };
    const innerRemove = root.removeEntry.bind(root);
    (root as { removeEntry: FileSystemDirectoryHandle['removeEntry'] }).removeEntry = (
      name,
      options,
    ) =>
      wedge.then(async () => {
        await innerRemove(name, options);
        events.push(`removeEntry /${name}`);
      });
    fs.rmSync('/t', { recursive: true }); // the WEDGE — held at its removeEntry boundary
    fs.mkdirSync('/t', { recursive: true }); // recreate queued BEFORE the timeout
    fs.writeFileSync('/t/f', new Uint8Array([1])); // write under it queued BEFORE the timeout

    await Promise.resolve(); // wedge enters its removeEntry boundary
    await vi.advanceTimersByTimeAsync(30_000); // watchdog ledgers the rm — successors already waiting

    fs.mkdirSync('/t', { recursive: true }); // recreate enqueued AFTER the timeout (recursive: tolerated)
    fs.writeFileSync('/t/g', new Uint8Array([2])); // write under it enqueued AFTER the timeout

    for (let tick = 0; tick < 10; tick++) await vi.advanceTimersByTimeAsync(1);
    // NOTHING completes against the wedged structural op: not the rm itself,
    // not a recreate mkdir, not a write under the recreated dir.
    expect(events).toEqual([]);

    releaseRm(); // wedge settles as SUCCESS → its timeout ledger entry heals
    const done = () =>
      events.includes('removeEntry /t') &&
      events.filter((event) => event === 'mkdir /t').length === 2 &&
      ['write /t/f', 'write /t/g'].every((event) => events.includes(event));
    for (let tick = 0; tick < 50 && !done(); tick++) await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1); // residual heal/settle hops
    const report = await fs.flush();
    const rmIdx = events.indexOf('removeEntry /t');
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    // Fence order: both recreate mkdirs complete after the wedged rm; each
    // write completes after the recreate it depends on (ancestor gating).
    expect(events.indexOf('mkdir /t')).toBeGreaterThan(rmIdx);
    expect(events.indexOf('write /t/f')).toBeGreaterThan(events.indexOf('mkdir /t'));
    expect(events.indexOf('write /t/g')).toBeGreaterThan(events.lastIndexOf('mkdir /t'));
    // Ledger clean: the rm's watchdog entry healed on its late SUCCESS, and
    // every successor's blocked record healed on its own success
    // (equal-sequence heal — healPersistFailure keeps `<=` sequences).
    expect(report.total).toBe(0);
  });
});
