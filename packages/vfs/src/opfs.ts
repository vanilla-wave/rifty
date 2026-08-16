/**
 * OPFS (Origin Private File System) backend.
 *
 * Works inside a Worker, where `navigator.storage.getDirectory()` and
 * `FileSystemFileHandle.createSyncAccessHandle()` are available; used for
 * persistent storage in the deployed playground. Outside an OPFS-capable
 * environment (Node tests, some private-browsing modes), `isSupported()`
 * returns `false` and the constructor throws.
 *
 * Errors are translated via {@link mapOpfsError} to POSIX-flavoured codes
 * (`ENOENT`, `EACCES`, `EDQUOT`, `EISDIR`, `ENOTDIR`, `EIO`) — ADR-0013.
 */

import { VfsError, assertReadWindow } from './errors.ts';
import {
  type OpfsErrorContext,
  assertNotCrswapReserved,
  isCrswapArtifactName,
  mapOpfsError,
} from './opfs-errors.ts';
import { basename, dirname, normalizeAbsolute, segments } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

type ReadFileEncoding = 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' | 'latin1';

function decodeBytes(bytes: Uint8Array, encoding: ReadFileEncoding): string {
  // Normalise to the form `TextDecoder` accepts.
  const label = encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : encoding;
  return new TextDecoder(label).decode(bytes);
}

export class OpfsVfs implements Vfs {
  private root: FileSystemDirectoryHandle | null = null;
  /**
   * Side-table for `utimes` — OPFS exposes no mtime mutation on
   * `FileSystemFileHandle` or `FileSystemSyncAccessHandle` (ADR-0029, ADR-0041).
   * `stat` OBSERVES it (files fall back to lastModified, dirs to 0) and
   * `writeFile`/`rm` invalidate stamps — an unpaired table made utimes a
   * silent no-op (vfs-async-contract). In-memory per instance, like the
   * OpfsFsSync twin's table: stamps do not survive a reload.
   */
  private readonly times = new Map<string, { atime: number; mtime: number }>();

  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    const s = (navigator as { storage?: { getDirectory?: unknown } }).storage;
    return Boolean(s && typeof s.getDirectory === 'function');
  }

  async init(): Promise<void> {
    if (this.root) return;
    if (!OpfsVfs.isSupported()) {
      throw new VfsError('EPERM', '/', 'OPFS is not available in this environment');
    }
    const dir = await navigator.storage?.getDirectory();
    if (!dir) throw new VfsError('EPERM', '/', 'OPFS getDirectory returned undefined');
    this.root = dir;
  }

  private async getDirectory(
    path: string,
    create = false,
    errorPath?: string,
  ): Promise<FileSystemDirectoryHandle> {
    await this.init();
    let dir = this.root as FileSystemDirectoryHandle;
    const parts = segments(path);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        throw mapOpfsError(err, errorPath ?? `/${parts.slice(0, i + 1).join('/')}`, 'dir');
      }
    }
    return dir;
  }

  private async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.getDirectory(dirname(path), false, path);
    try {
      return await parent.getFileHandle(basename(path), { create });
    } catch (err) {
      throw mapOpfsError(err, path, 'file');
    }
  }

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: ReadFileEncoding): Promise<string>;
  async readFile(path: string, encoding?: ReadFileEncoding): Promise<Uint8Array | string> {
    // ADR-0199: every public entry asserts an absolute path BEFORE any handle
    // walk — `segments`/`dirname` on a raw relative input silently rooted it.
    const np = normalizeAbsolute(path);
    const handle = await this.getFileHandle(np);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (err) {
      throw mapOpfsError(err, np, 'file');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return encoding === undefined ? bytes : decodeBytes(bytes, encoding);
  }

  async readFileText(path: string, encoding: 'utf8' = 'utf8'): Promise<string> {
    const bytes = await this.readFile(path);
    return decodeBytes(bytes, encoding);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const np = normalizeAbsolute(path);
    assertNotCrswapReserved(np);
    const handle = await this.getFileHandle(np, true);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    try {
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
    } catch (err) {
      throw mapOpfsError(err, np, 'file');
    }
    // A write refreshes mtime in Node — drop any utimes stamp so stat falls
    // back to the fresh lastModified (vfs-async-contract).
    this.times.delete(np);
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const np = normalizeAbsolute(path);
    const dir = await this.getDirectory(np, false, np);
    const out: VfsDirent[] = [];
    try {
      // FileSystemDirectoryHandle is async-iterable (not in the TS lib types).
      for await (const [name, handle] of dir as unknown as AsyncIterable<
        [string, FileSystemHandle]
      >) {
        // Platform atomic-swap temps are not tree content (see opfs-errors.ts).
        if (handle.kind === 'file' && isCrswapArtifactName(name)) continue;
        out.push({
          name,
          isFile: handle.kind === 'file',
          isDirectory: handle.kind === 'directory',
        });
      }
    } catch (err) {
      throw mapOpfsError(err, np, 'dir');
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const np = normalizeAbsolute(path);
    assertNotCrswapReserved(np);
    const recursive = options?.recursive ?? false;
    await this.init();
    let dir = this.root as FileSystemDirectoryHandle;
    const parts = segments(np);
    if (parts.length === 0) {
      // mkdir('/'): root always exists — EEXIST unless recursive (backend
      // contract, same as MemoryVfs/OpfsFsSync; vfs-async-contract).
      if (!recursive) throw new VfsError('EEXIST', np);
      return;
    }
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      const last = i === parts.length - 1;
      if (last && !recursive) {
        // Non-recursive mkdir must FAIL on an existing target: probe without
        // create first — the old unconditional `create: true` returned the
        // existing dir's handle and masked EEXIST (vfs-async-contract).
        try {
          await dir.getDirectoryHandle(part, { create: false });
          throw new VfsError('EEXIST', np);
        } catch (err) {
          if (err instanceof VfsError) throw err;
          const mapped = mapOpfsError(err, np, 'dir');
          // Exists as a FILE (TypeMismatch → ENOTDIR at the final segment).
          if (mapped.code === 'ENOTDIR') throw new VfsError('EEXIST', np);
          if (mapped.code !== 'ENOENT') throw mapped;
        }
      }
      try {
        dir = await dir.getDirectoryHandle(part, { create: recursive || last });
      } catch (err) {
        // Component-level failure (missing parent, through-file) still names
        // the TARGET — the backend error contract (fs-sync-strict-paths).
        const mapped = mapOpfsError(err, np, 'dir');
        if (last && mapped.code === 'ENOTDIR') {
          throw new VfsError('EEXIST', np);
        }
        throw mapped;
      }
    }
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const np = normalizeAbsolute(path);
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.getDirectory(dirname(np), false, np);
    } catch (err) {
      if (options?.force && err instanceof VfsError && err.code === 'ENOENT') return;
      throw err;
    }
    try {
      await parent.removeEntry(basename(np), { recursive: options?.recursive ?? false });
    } catch (err) {
      if (options?.force) {
        const mapped = mapOpfsError(err, np, 'file');
        if (mapped.code === 'ENOENT') return;
        throw mapped;
      }
      throw mapOpfsError(err, np, 'file');
    }
    // Removed paths must not resurrect an old utimes stamp on recreation —
    // drop the target's stamp and every descendant's (vfs-async-contract).
    this.times.delete(np);
    for (const key of [...this.times.keys()]) {
      if (key.startsWith(`${np}/`)) this.times.delete(key);
    }
  }

  async stat(path: string): Promise<VfsStat> {
    const np = normalizeAbsolute(path);
    // Probe the parent handle for the entry kind rather than catching opaque
    // `getFileHandle` errors, so `NotAllowedError`/`QuotaExceededError`
    // propagate instead of being masked as "must be a directory then".
    const parent = await this.getDirectory(dirname(np), false, np);
    const name = basename(np);
    // `utimes` writes into the side-table; stat must OBSERVE it or utimes is
    // a silent-success lie (OpfsFsSync pairs its tables the same way;
    // vfs-async-contract). Files fall back to the real lastModified, dirs to
    // 0 (OPFS exposes no dir mtime).
    const stamped = this.times.get(np)?.mtime;
    if (name === '') {
      // root dir; OPFS does not track mtime.
      return { isFile: false, isDirectory: true, size: 0, mtime: stamped ?? 0 };
    }
    let fileHandle: FileSystemFileHandle | null = null;
    let fileErr: unknown = null;
    try {
      fileHandle = await parent.getFileHandle(name, { create: false });
    } catch (err) {
      fileErr = err;
    }
    if (fileHandle) {
      try {
        const file = await fileHandle.getFile();
        return {
          isFile: true,
          isDirectory: false,
          size: file.size,
          mtime: stamped ?? file.lastModified,
        };
      } catch (err) {
        throw mapOpfsError(err, np, 'file');
      }
    }
    // TypeMismatchError means "exists, but other kind" → it's a dir.
    const isDirByTypeMismatch =
      fileErr &&
      typeof fileErr === 'object' &&
      (fileErr as { name?: string }).name === 'TypeMismatchError';
    if (isDirByTypeMismatch) {
      return { isFile: false, isDirectory: true, size: 0, mtime: stamped ?? 0 };
    }
    // Try as a directory; on throw, propagate the mapped code
    // (NotFoundError → ENOENT, NotAllowedError → EACCES, etc.).
    try {
      await parent.getDirectoryHandle(name, { create: false });
      return { isFile: false, isDirectory: true, size: 0, mtime: stamped ?? 0 };
    } catch (err) {
      throw mapOpfsError(err, np, 'dir');
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof VfsError && err.code === 'ENOENT') return false;
      // Bubble up real failures (EACCES, EDQUOT, EIO); swallowing them would
      // re-introduce the silent-stub problem.
      throw err;
    }
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    const np = normalizeAbsolute(path);
    if (!(await this.exists(np))) throw new VfsError('ENOENT', np);
    this.times.set(np, { atime: atimeMs, mtime: mtimeMs });
  }

  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const np = normalizeAbsolute(path);
    const handle = await this.getFileHandle(np);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (err) {
      throw mapOpfsError(err, np, 'file');
    }
    return chunkedFileStream(file, opts);
  }
}

/**
 * Chunked `ReadableStream` over a `Blob`/`File` — pulls `chunkSize` ranges via
 * `slice(...).arrayBuffer()` instead of `File.stream()` (which stalls in a Worker
 * under cross-realm serving). Half-open `[start, end)` window, `end` clamped to
 * the blob size so an out-of-range `end` never enqueues trailing empty chunks
 * (parity with `MemoryVfs`/`SyncMirrorVfs`).
 */
export function chunkedFileStream(
  file: Blob,
  opts?: { chunkSize?: number; start?: number; end?: number },
): ReadableStream<Uint8Array> {
  assertReadWindow(opts);
  const start = opts?.start ?? 0;
  const end = Math.min(opts?.end ?? file.size, file.size);
  const chunkSize = opts?.chunkSize ?? 64 * 1024;
  let offset = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= end) {
        controller.close();
        return;
      }
      const next = Math.min(offset + chunkSize, end);
      const bytes = new Uint8Array(await file.slice(offset, next).arrayBuffer());
      offset = next;
      controller.enqueue(bytes);
    },
  });
}

/** Re-exported to keep call sites that catch and wrap OPFS errors uniform. */
export type { OpfsErrorContext };
