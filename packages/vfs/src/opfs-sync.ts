/// <reference lib="webworker" />
/**
 * `OpfsFsSync` — synchronous {@link FsSync} backed by OPFS via
 * `FileSystemSyncAccessHandle` (ADR-0013). Worker realm only; main-thread
 * construction throws `NotImplementedError`.
 *
 * Scope: all seven `FsSync` methods are implemented. File **content** I/O
 * goes through `FileSystemSyncAccessHandle` (true sync, OPFS-native).
 * Directory-shape ops (`readdirSync`, `mkdirSync`, `rmSync`) read/write an
 * in-memory directory tree mirror that is **seeded** at boot from the OPFS
 * root and kept in sync as the page runs. Persistence of directory-shape
 * mutations back to OPFS happens via fire-and-forget async helpers
 * (`getDirectoryHandle`/`removeEntry`); if the page is closed before a
 * flush completes, the on-disk tree is slightly behind the in-memory
 * mirror — acceptable for a dev runtime.
 *
 * Warm index (ADR-0014): {@link init} walks the OPFS tree and caches
 * `{ kind, size, children? }` so `existsSync`/`statSync`/`readdirSync`
 * see the same tree the async {@link OpfsVfs} sees. `writeFileSync`
 * mutates the cache in place; async writes through the paired async
 * surface make it stale until {@link refreshIndex} is called.
 *
 * Handle lifecycle: a `Map<path, FileSystemSyncAccessHandle>` opens
 * lazily on `openSync(path)` and is reused (browsers serialise handle
 * access). No cross-instance eviction — Worker owns its filesystem
 * view for life.
 *
 * atime/mtime side-table (ADR-0029): `FileSystemSyncAccessHandle`
 * exposes no mtime mutation; `utimes` records into an in-memory map and
 * `statSync` prefers it over the default `0`. Not persisted across page
 * reloads.
 */

import { NotImplementedError, VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import { basename, dirname, normalizePath, segments } from './path.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

interface IndexEntry {
  readonly kind: 'file' | 'dir';
  /** Last-known size in bytes (files only; `0` for dirs). */
  size: number;
  /**
   * For directories: the set of child names (one segment, no slash).
   * Maintained in lockstep with the prefix-keyed `index` map so dir-shape
   * ops are O(children) instead of O(tree). `undefined` for files.
   */
  children?: Set<string>;
}

/**
 * Walks an OPFS directory tree and yields `{ path, kind, size, children? }`
 * for every entry under `root`. The root itself is reported as
 * `'/' → dir`. Exported for unit tests; not part of the public surface.
 */
export async function walkOpfsTree(
  root: FileSystemDirectoryHandle,
): Promise<Map<string, IndexEntry>> {
  const out = new Map<string, IndexEntry>();
  out.set('/', { kind: 'dir', size: 0, children: new Set() });

  async function recurse(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const parentEntry = out.get(prefix);
    const parentChildren = parentEntry?.children;
    // FileSystemDirectoryHandle is async-iterable yielding [name, handle].
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      const childPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
      parentChildren?.add(name);
      if (handle.kind === 'file') {
        let size = 0;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          size = file.size;
        } catch {
          // Permission or other errors — keep size as 0 so the entry is
          // still discoverable. statSync will surface the real error if
          // the file is later opened.
        }
        out.set(childPath, { kind: 'file', size });
      } else if (handle.kind === 'directory') {
        out.set(childPath, { kind: 'dir', size: 0, children: new Set() });
        await recurse(handle as FileSystemDirectoryHandle, childPath);
      }
    }
  }

  await recurse(root, '/');
  return out;
}

export class OpfsFsSync implements FsSync {
  private readonly handles = new Map<string, FileSystemSyncAccessHandle>();
  private readonly index = new Map<string, IndexEntry>();
  /** atime/mtime side-table — see file header (ADR-0029). */
  private readonly times = new Map<string, { atime: number; mtime: number }>();
  private readonly root: FileSystemDirectoryHandle;

  /**
   * `true` when the current realm is a Worker that exposes
   * `FileSystemFileHandle.prototype.createSyncAccessHandle`. Always
   * `false` in the main thread (no sync OPFS API) and in Node tests
   * (no `FileSystemFileHandle` at all).
   */
  static isSupported(): boolean {
    const inWorker =
      typeof globalThis !== 'undefined' &&
      (typeof (globalThis as { importScripts?: unknown }).importScripts !== 'undefined' ||
        (typeof (globalThis as { window?: unknown }).window === 'undefined' &&
          typeof (globalThis as { document?: unknown }).document === 'undefined'));
    if (!inWorker) return false;
    const ctor = (globalThis as { FileSystemFileHandle?: { prototype?: unknown } })
      .FileSystemFileHandle;
    const proto = ctor?.prototype as { createSyncAccessHandle?: unknown } | undefined;
    return typeof proto?.createSyncAccessHandle === 'function';
  }

  /**
   * Constructs an instance bound to an already-obtained OPFS root. Use
   * {@link OpfsFsSync.init} in normal code; the constructor is exposed
   * for tests that want to inject a fake root.
   */
  constructor(root: FileSystemDirectoryHandle) {
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    this.root = root;
    // Seed the root entry so `readdirSync('/')` works even before
    // `refreshIndex` populates the rest of the tree.
    this.index.set('/', { kind: 'dir', size: 0, children: new Set() });
  }

  /**
   * Acquires the OPFS root via `navigator.storage.getDirectory()`,
   * builds the warm path index, and returns a ready-to-use
   * `OpfsFsSync`. Throws (via the constructor) if called outside a
   * Worker realm that supports `createSyncAccessHandle`.
   */
  static async init(): Promise<OpfsFsSync> {
    if (!OpfsFsSync.isSupported()) {
      throw new NotImplementedError(
        'OpfsFsSync',
        'sync OPFS only available inside a Web Worker realm',
      );
    }
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new VfsError('EPERM', '/', 'OPFS navigator.storage.getDirectory unavailable');
    }
    const dir = await navigator.storage.getDirectory();
    const instance = new OpfsFsSync(dir);
    await instance.refreshIndex();
    return instance;
  }

  /**
   * Re-walks the OPFS tree and rebuilds the warm path index. Callers that
   * have done async writes through the paired {@link OpfsVfs} surface
   * (which the sync index can't observe directly) should invoke this to
   * see the new entries through {@link existsSync} / {@link statSync} /
   * {@link readdirSync}.
   */
  async refreshIndex(): Promise<void> {
    const fresh = await walkOpfsTree(this.root);
    this.index.clear();
    for (const [k, v] of fresh) this.index.set(k, v);
  }

  // --- async-only helpers (used internally to acquire handles lazily) ---
  private async resolveParent(path: string): Promise<FileSystemDirectoryHandle> {
    let dir: FileSystemDirectoryHandle = this.root;
    for (const part of segments(dirname(path))) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    return dir;
  }

  /**
   * Returns a memoised sync access handle for `path`, opening the file
   * (creating if absent) and acquiring a handle on first call.
   *
   * Side note: this is an async helper *invoked from sync methods* via a
   * pre-warm step. Sync methods only call it after the handle is
   * known-present in `this.handles`. The first read/write to a brand-new
   * path must therefore be preceded by a separate `await
   * fsSync.openSync(path)` from the caller, or by an `OpfsVfs.writeFile`
   * on the same path through the paired async surface — which is the
   * intended bootstrap path.
   */
  private async ensureHandle(path: string, create: boolean): Promise<FileSystemSyncAccessHandle> {
    const normalized = normalizePath(path);
    const existing = this.handles.get(normalized);
    if (existing) return existing;
    const parent = await this.resolveParent(normalized);
    const file = await parent.getFileHandle(basename(normalized), { create });
    const handle = await file.createSyncAccessHandle();
    this.handles.set(normalized, handle);
    // Pre-warm also adds the path to the index if it wasn't already there
    // (e.g. `openSync(path, create=true)` for a brand-new file).
    if (!this.index.has(normalized)) {
      this.index.set(normalized, { kind: 'file', size: handle.getSize() });
      this.attachChild(normalized);
    }
    return handle;
  }

  /**
   * Pre-warms a sync access handle for `path` so subsequent sync ops on
   * the same path are fully synchronous. Callers that know the working
   * set ahead of time should warm it once at bootstrap.
   */
  async openSync(path: string, create = false): Promise<void> {
    await this.ensureHandle(path, create);
  }

  /** Releases all open sync access handles. Idempotent. */
  closeAll(): void {
    for (const handle of this.handles.values()) handle.close();
    this.handles.clear();
  }

  // --- in-memory dir-tree mirror maintenance ---

  /**
   * Adds `path`'s basename to its parent directory's `children` set.
   * Idempotent. No-op if the parent isn't in the index — callers must
   * ensure parent exists (sync mkdir does this; async paths arrive via
   * `walkOpfsTree`).
   */
  private attachChild(path: string): void {
    if (path === '/') return;
    const parent = dirname(path);
    const parentEntry = this.index.get(parent);
    if (parentEntry?.kind === 'dir' && parentEntry.children) {
      parentEntry.children.add(basename(path));
    }
  }

  /** Removes `path`'s basename from its parent's `children` set. Idempotent. */
  private detachChild(path: string): void {
    if (path === '/') return;
    const parent = dirname(path);
    const parentEntry = this.index.get(parent);
    if (parentEntry?.kind === 'dir' && parentEntry.children) {
      parentEntry.children.delete(basename(path));
    }
  }

  /**
   * Recursively removes `path` and all descendants from the in-memory
   * index, closing any open sync access handles along the way.
   */
  private removeSubtree(path: string): void {
    const entry = this.index.get(path);
    if (!entry) return;
    if (entry.kind === 'dir' && entry.children) {
      // Iterate a snapshot — we mutate `children` via recursion.
      for (const name of [...entry.children]) {
        const childPath = path === '/' ? `/${name}` : `${path}/${name}`;
        this.removeSubtree(childPath);
      }
    }
    const handle = this.handles.get(path);
    if (handle) {
      try {
        handle.close();
      } catch {
        // Closing a stale handle is best-effort; nothing else to do.
      }
      this.handles.delete(path);
    }
    this.index.delete(path);
    this.times.delete(path);
  }

  /**
   * Fire-and-forget async persist of a directory creation to OPFS. Caller
   * already mutated the in-memory mirror; this brings disk in line.
   * Errors are swallowed — the next `refreshIndex` will reconcile.
   */
  private persistMkdirAsync(path: string, recursive: boolean): void {
    void (async () => {
      try {
        const parts = segments(path);
        let dir: FileSystemDirectoryHandle = this.root;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i] as string;
          dir = await dir.getDirectoryHandle(part, {
            create: recursive || i === parts.length - 1,
          });
        }
      } catch {
        // The mirror already reflects the user's intent; if OPFS persist
        // fails (quota, perm), the mismatch shows up on next refresh.
      }
    })();
  }

  /**
   * Fire-and-forget async persist of an `rm` to OPFS.
   */
  private persistRmAsync(path: string, recursive: boolean): void {
    void (async () => {
      try {
        const parent = await this.resolveParent(path);
        await parent.removeEntry(basename(path), { recursive });
      } catch {
        // See `persistMkdirAsync` — mismatch reconciles on refresh.
      }
    })();
  }

  // --- FsSync sync surface ---

  existsSync(path: string): boolean {
    return this.index.has(normalizePath(path));
  }

  readFileBytesSync(path: string): Uint8Array {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    if (entry.kind === 'dir') throw new VfsError('EISDIR', path);
    const handle = this.handles.get(normalized);
    if (!handle) {
      // The path is known-existing but no sync access handle has been
      // acquired yet. We can't open one synchronously — the caller must
      // pre-warm with `await fsSync.openSync(path)` (or do a sync write
      // first, which acquires the handle as a side effect).
      throw new NotImplementedError(
        'OpfsFsSync.readFileBytesSync',
        `path '${path}' is known but its sync access handle isn't open; call openSync(path) first`,
      );
    }
    const size = handle.getSize();
    const buf = new Uint8Array(size);
    const read = handle.read(buf, { at: 0 });
    return read === size ? buf : buf.subarray(0, read);
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const normalized = normalizePath(path);
    const handle = this.handles.get(normalized);
    if (!handle) {
      // For brand-new paths the sync access handle hasn't been acquired.
      // The caller must pre-warm via `await fsSync.openSync(path, true)`
      // first; opening a sync access handle is itself async.
      throw new NotImplementedError(
        'OpfsFsSync.writeFileSync',
        `no sync access handle open for '${path}'; call openSync(path, true) first`,
      );
    }
    // Parent dir must exist for a coherent tree; refuse if it doesn't.
    const parent = dirname(normalized);
    const parentEntry = this.index.get(parent);
    if (!parentEntry || parentEntry.kind !== 'dir') {
      throw new VfsError('ENOENT', parent);
    }
    handle.truncate(0);
    handle.write(data, { at: 0 });
    handle.flush();
    // Keep the warm index honest: a sync write may have created the file
    // or changed its size. Also link it into the parent's children set
    // (idempotent if already present).
    const wasKnown = this.index.has(normalized);
    this.index.set(normalized, { kind: 'file', size: data.byteLength });
    if (!wasKnown) this.attachChild(normalized);
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    // mtime: prefer the user-supplied value from the side-table (set by
    // `utimes`); fall back to 0 because OPFS doesn't expose a native mtime
    // to the sync surface (ADR-0029).
    const mtime = this.times.get(normalized)?.mtime ?? 0;
    if (entry.kind === 'dir') {
      return { isFile: false, isDirectory: true, size: 0, mtime };
    }
    // File: prefer a live size from the open sync access handle when we
    // have one; otherwise fall back to the cached size from the last
    // walk / write.
    const handle = this.handles.get(normalized);
    const size = handle ? handle.getSize() : entry.size;
    return { isFile: true, isDirectory: false, size, mtime };
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    const normalized = normalizePath(path);
    if (!this.index.has(normalized)) throw new VfsError('ENOENT', path);
    this.times.set(normalized, { atime: atimeMs, mtime: mtimeMs });
  }

  /**
   * Lists immediate children of `path`. Reads the in-memory dir-tree
   * mirror that was seeded by {@link refreshIndex} / boot. Result is
   * sorted lexicographically for deterministic iteration (matches
   * `MemoryBackend.readdir`).
   */
  readdirSync(path: string): readonly string[] {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    if (entry.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    if (!entry.children) return [];
    return [...entry.children].sort();
  }

  /**
   * Creates the directory at `path` in the in-memory mirror and kicks
   * off a fire-and-forget async persist to OPFS. With `recursive`, any
   * missing parent segments are also created.
   *
   * If `recursive` is false and the parent does not exist, throws
   * `VfsError('ENOENT')`. If the target already exists as a directory,
   * non-recursive callers get `VfsError('EEXIST')`; recursive callers
   * are tolerated. If the target exists as a file, throws
   * `VfsError('ENOTDIR')`.
   */
  mkdirSync(path: string, options: { recursive?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const normalized = normalizePath(path);
    const parts = segments(normalized);
    if (parts.length === 0) {
      // mkdir('/') — root always exists.
      if (!recursive) throw new VfsError('EEXIST', path);
      return;
    }
    let cumulative = '';
    for (let i = 0; i < parts.length; i++) {
      cumulative = `${cumulative}/${parts[i]}`;
      const existing = this.index.get(cumulative);
      if (existing) {
        if (existing.kind !== 'dir') throw new VfsError('ENOTDIR', cumulative);
        if (i === parts.length - 1 && !recursive) {
          throw new VfsError('EEXIST', path);
        }
        continue;
      }
      // Missing intermediate without recursive → ENOENT.
      if (!recursive && i < parts.length - 1) {
        throw new VfsError('ENOENT', cumulative);
      }
      this.index.set(cumulative, { kind: 'dir', size: 0, children: new Set() });
      this.attachChild(cumulative);
    }
    // Persist to OPFS asynchronously — the mirror is the source of truth
    // for sync callers; OPFS catches up best-effort.
    this.persistMkdirAsync(normalized, recursive);
  }

  /**
   * Removes `path` from the in-memory mirror and kicks off a
   * fire-and-forget async persist to OPFS. `recursive: true` deletes a
   * non-empty directory subtree; `force: true` makes missing paths a
   * no-op.
   *
   * Throws `VfsError('ENOTEMPTY')` for non-empty directories without
   * `recursive` (Node `fs.rmSync` parity). Throws `VfsError('ENOENT')`
   * for unknown paths unless `force` is set.
   */
  rmSync(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const force = options.force ?? false;
    const normalized = normalizePath(path);
    if (normalized === '/') {
      if (recursive) {
        // Clear root's children, leave the root entry itself.
        const rootEntry = this.index.get('/');
        if (rootEntry?.children) {
          for (const name of [...rootEntry.children]) {
            this.removeSubtree(`/${name}`);
          }
        }
        this.persistRmAsync('/', true);
        return;
      }
      throw new VfsError('EPERM', '/');
    }
    const entry = this.index.get(normalized);
    if (!entry) {
      if (force) return;
      throw new VfsError('ENOENT', path);
    }
    if (entry.kind === 'dir' && entry.children && entry.children.size > 0 && !recursive) {
      // Match Node's `fs.rmSync` ENOTEMPTY message so callers can branch
      // on a single code regardless of backend.
      throw new VfsError('ENOTEMPTY', path, `ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }
    this.detachChild(normalized);
    this.removeSubtree(normalized);
    this.persistRmAsync(normalized, recursive);
  }
}
