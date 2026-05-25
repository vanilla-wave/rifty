/// <reference lib="webworker" />
/**
 * `OpfsFsSync` — synchronous {@link FsSync} backed by OPFS via
 * `FileSystemSyncAccessHandle` (ADR-0013).
 *
 * Realm constraint: `FileSystemSyncAccessHandle` only exists inside a Worker
 * realm. Main-realm code that tries to construct an `OpfsFsSync` gets a
 * `NotImplementedError` with the canonical message — it's not a stub, it's
 * an intrinsic platform constraint.
 *
 * Scope (M11): **file ops** (`existsSync`, `readFileBytesSync`,
 * `writeFileSync`, `statSync` on files and directories) are wired through
 * the OPFS sync surface. **Mutating directory ops** (`mkdirSync`, `rmSync`,
 * `readdirSync`) require the async `FileSystemDirectoryHandle` API and
 * therefore can't run from a sync method. They throw
 * `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an
 * async bootstrap; use OpfsVfs for those')`. Callers that need both
 * surfaces should drive directory ops through {@link OpfsVfs} on the
 * paired async side.
 *
 * Warm index (ADR-0014 acceptance): at {@link init} time the implementation
 * walks the OPFS tree and caches `{ kind, size }` for every entry. Sync ops
 * consult this index so `existsSync('/foo')` and `statSync('/foo')` return
 * truthful answers for files that were created through the paired
 * {@link OpfsVfs} surface without a separate `openSync` pre-warm step. The
 * index is mutated in place by `writeFileSync` to stay in sync with sync
 * writes. Async writes through the paired `OpfsVfs` make the index stale —
 * callers can refresh it by re-invoking {@link OpfsFsSync.init}.
 *
 * Handle lifecycle: a separate `Map<string, FileSystemSyncAccessHandle>`
 * keyed by absolute path holds open sync access handles, acquired lazily on
 * the first read/write against that path. Browsers serialise access on a
 * single handle — keeping one per path avoids re-creating it on every call.
 * There is no cross-instance eviction; the assumption is that the Worker
 * realm owns its filesystem view for its lifetime.
 */

import { NotImplementedError } from '@rifty/io';
import { VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import { basename, dirname, normalizePath, segments } from './path.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

interface IndexEntry {
  readonly kind: 'file' | 'dir';
  /** Last-known size in bytes (files only; `0` for dirs). */
  size: number;
}

/**
 * Walks an OPFS directory tree and yields `{ path, kind, size }` for every
 * entry under `root`. The root itself is reported as `'/' → dir`. Exported
 * for unit tests; not part of the public surface.
 */
export async function walkOpfsTree(
  root: FileSystemDirectoryHandle,
): Promise<Map<string, IndexEntry>> {
  const out = new Map<string, IndexEntry>();
  out.set('/', { kind: 'dir', size: 0 });

  async function recurse(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    // FileSystemDirectoryHandle is async-iterable yielding [name, handle].
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      const childPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
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
        out.set(childPath, { kind: 'dir', size: 0 });
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
   * see the new entries through {@link existsSync} / {@link statSync}.
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
    handle.truncate(0);
    handle.write(data, { at: 0 });
    handle.flush();
    // Keep the warm index honest: a sync write may have created the file
    // or changed its size.
    this.index.set(normalized, { kind: 'file', size: data.byteLength });
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const normalized = normalizePath(path);
    const entry = this.index.get(normalized);
    if (!entry) throw new VfsError('ENOENT', path);
    if (entry.kind === 'dir') {
      // OPFS does not expose directory mtime; mtime=0 is documented.
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    }
    // File: prefer a live size from the open sync access handle when we
    // have one; otherwise fall back to the cached size from the last
    // walk / write. mtime is not exposed by OPFS sync handles.
    const handle = this.handles.get(normalized);
    const size = handle ? handle.getSize() : entry.size;
    return { isFile: true, isDirectory: false, size, mtime: 0 };
  }

  readdirSync(_path: string): readonly string[] {
    throw new NotImplementedError(
      'OpfsFsSync.readdirSync',
      'directory ops require an async bootstrap; use OpfsVfs for those',
    );
  }

  mkdirSync(_path: string, _options: { recursive?: boolean }): void {
    throw new NotImplementedError(
      'OpfsFsSync.mkdirSync',
      'directory ops require an async bootstrap; use OpfsVfs for those',
    );
  }

  rmSync(_path: string, _options: { recursive?: boolean; force?: boolean }): void {
    throw new NotImplementedError(
      'OpfsFsSync.rmSync',
      'directory ops require an async bootstrap; use OpfsVfs for those',
    );
  }
}
