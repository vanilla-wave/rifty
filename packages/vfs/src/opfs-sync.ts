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
 * `writeFileSync`, `statSync` on files) are wired through sync access
 * handles. **Directory ops** (`readdirSync`, `mkdirSync`, `rmSync`,
 * `statSync` on dirs) require the async `FileSystemDirectoryHandle` API
 * and therefore can't run from a sync method. They throw
 * `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an
 * async bootstrap; use OpfsVfs for those')`. Callers that need both
 * surfaces should drive directory ops through {@link OpfsVfs} on the
 * paired async side.
 *
 * Handle lifecycle: the class maintains a `Map<string,
 * FileSystemSyncAccessHandle>` keyed by absolute path; handles are
 * acquired lazily on first sync op against that path. Browsers serialise
 * access on a single handle — keeping one per path avoids re-creating it
 * on every call. There is no cross-instance eviction; the assumption is
 * that the Worker realm owns its filesystem view for its lifetime.
 */

import { NotImplementedError } from '@rifty/io';
import { VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import { basename, dirname, normalizePath, segments } from './path.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

interface SyncHandleHost {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

export class OpfsFsSync implements FsSync {
  private readonly handles = new Map<string, FileSystemSyncAccessHandle>();
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
   * Acquires the OPFS root via `navigator.storage.getDirectory()` and
   * returns a ready-to-use `OpfsFsSync`. Throws (via the constructor)
   * if called outside a Worker realm that supports
   * `createSyncAccessHandle`.
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
    return new OpfsFsSync(dir);
  }

  // --- async-only helpers (used internally to acquire handles lazily) ---

  private async resolveParent(path: string): Promise<SyncHandleHost> {
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
    return this.handles.has(normalizePath(path));
  }

  readFileBytesSync(path: string): Uint8Array {
    const normalized = normalizePath(path);
    const handle = this.handles.get(normalized);
    if (!handle) throw new VfsError('ENOENT', path);
    const size = handle.getSize();
    const buf = new Uint8Array(size);
    const read = handle.read(buf, { at: 0 });
    return read === size ? buf : buf.subarray(0, read);
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const normalized = normalizePath(path);
    const handle = this.handles.get(normalized);
    if (!handle) throw new VfsError('ENOENT', path);
    handle.truncate(0);
    handle.write(data, { at: 0 });
    handle.flush();
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const normalized = normalizePath(path);
    const handle = this.handles.get(normalized);
    if (handle) {
      return { isFile: true, isDirectory: false, size: handle.getSize() };
    }
    throw new VfsError('ENOENT', path);
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
