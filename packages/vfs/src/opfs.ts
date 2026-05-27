/**
 * OPFS (Origin Private File System) backend.
 *
 * Works inside a Worker (where `navigator.storage.getDirectory()` is available
 * and so is `FileSystemFileHandle.createSyncAccessHandle()`). Use this for
 * persistent storage in the deployed playground.
 *
 * Outside of an OPFS-capable environment (Node tests, some private browsing
 * modes), `OpfsVfs.isSupported()` returns `false` and the constructor throws.
 *
 * OPFS errors are translated via {@link mapOpfsError} so callers see the
 * POSIX-flavoured codes they expect (`ENOENT`, `EACCES`, `EDQUOT`, `EISDIR`,
 * `ENOTDIR`, `EIO`) — ADR-0013 acceptance.
 */

import { VfsError } from './errors.ts';
import { type OpfsErrorContext, mapOpfsError } from './opfs-errors.ts';
import { basename, dirname, segments } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

type ReadFileEncoding = 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' | 'latin1';

function decodeBytes(bytes: Uint8Array, encoding: ReadFileEncoding): string {
  // Normalise the encoding name to the form `TextDecoder` accepts.
  const label = encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : encoding;
  return new TextDecoder(label).decode(bytes);
}

export class OpfsVfs implements Vfs {
  private root: FileSystemDirectoryHandle | null = null;
  /**
   * Side-table for `utimes` — OPFS exposes no mtime mutation on either
   * `FileSystemFileHandle` or `FileSystemSyncAccessHandle` (ADR-0029, ADR-0041).
   * Mirrors the same shape `OpfsFsSync` uses. Each surface keeps its own
   * table; pairing them at storage is out of scope until a consumer needs it.
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

  private async getDirectory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    await this.init();
    let dir = this.root as FileSystemDirectoryHandle;
    const parts = segments(path);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        throw mapOpfsError(err, `/${parts.slice(0, i + 1).join('/')}`, 'dir');
      }
    }
    return dir;
  }

  private async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.getDirectory(dirname(path), create);
    try {
      return await parent.getFileHandle(basename(path), { create });
    } catch (err) {
      throw mapOpfsError(err, path, 'file');
    }
  }

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: ReadFileEncoding): Promise<string>;
  async readFile(path: string, encoding?: ReadFileEncoding): Promise<Uint8Array | string> {
    const handle = await this.getFileHandle(path);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (err) {
      throw mapOpfsError(err, path, 'file');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return encoding === undefined ? bytes : decodeBytes(bytes, encoding);
  }

  async readFileText(path: string, encoding: 'utf8' = 'utf8'): Promise<string> {
    const bytes = await this.readFile(path);
    return decodeBytes(bytes, encoding);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const handle = await this.getFileHandle(path, true);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    try {
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as FileSystemWriteChunkType);
      await writable.close();
    } catch (err) {
      throw mapOpfsError(err, path, 'file');
    }
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const dir = await this.getDirectory(path);
    const out: VfsDirent[] = [];
    try {
      // FileSystemDirectoryHandle is async-iterable
      for await (const [name, handle] of dir as unknown as AsyncIterable<
        [string, FileSystemHandle]
      >) {
        out.push({
          name,
          isFile: handle.kind === 'file',
          isDirectory: handle.kind === 'directory',
        });
      }
    } catch (err) {
      throw mapOpfsError(err, path, 'dir');
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const recursive = options?.recursive ?? false;
    await this.init();
    let dir = this.root as FileSystemDirectoryHandle;
    const parts = segments(path);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      try {
        dir = await dir.getDirectoryHandle(part, { create: recursive || i === parts.length - 1 });
      } catch (err) {
        throw mapOpfsError(err, `/${parts.slice(0, i + 1).join('/')}`, 'dir');
      }
    }
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await this.getDirectory(dirname(path));
    } catch (err) {
      if (options?.force) return;
      throw err;
    }
    try {
      await parent.removeEntry(basename(path), { recursive: options?.recursive ?? false });
    } catch (err) {
      if (options?.force) return;
      throw mapOpfsError(err, path, 'file');
    }
  }

  async stat(path: string): Promise<VfsStat> {
    // Try as file first via the parent directory; fall back to directory.
    // We deliberately probe the parent handle for the entry kind rather than
    // catching opaque `getFileHandle` errors — that way `NotAllowedError`
    // and `QuotaExceededError` propagate correctly instead of getting masked
    // as "must be a directory then".
    const parent = await this.getDirectory(dirname(path));
    const name = basename(path);
    if (name === '') {
      // root: it's a directory; mtime is not tracked by OPFS.
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
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
        return { isFile: true, isDirectory: false, size: file.size, mtime: file.lastModified };
      } catch (err) {
        throw mapOpfsError(err, path, 'file');
      }
    }
    // Either entry doesn't exist as a file, or it's a directory.
    // TypeMismatchError says "exists, but other kind" → it's a dir.
    const isDirByTypeMismatch =
      fileErr &&
      typeof fileErr === 'object' &&
      (fileErr as { name?: string }).name === 'TypeMismatchError';
    if (isDirByTypeMismatch) {
      // OPFS does not expose dir mtime — synthesise as 0 (documented).
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    }
    // Not a known file. Try as a directory; if that throws we propagate the
    // proper code (NotFoundError → ENOENT, NotAllowedError → EACCES, etc.).
    try {
      await parent.getDirectoryHandle(name, { create: false });
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    } catch (err) {
      throw mapOpfsError(err, path, 'dir');
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof VfsError && err.code === 'ENOENT') return false;
      // Bubble up real failures (EACCES, EDQUOT, EIO) — silently swallowing
      // them would re-introduce the original silent-stub problem.
      throw err;
    }
  }

  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    if (!(await this.exists(path))) throw new VfsError('ENOENT', path);
    this.times.set(path, { atime: atimeMs, mtime: mtimeMs });
  }

  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    // ADR-0020 phase 2: wrap `File.stream()` from `FileSystemFileHandle`.
    // `start`/`end` are honoured via `File.slice(start, end)`; `chunkSize`
    // is informational — the underlying browser stream picks its own chunk
    // boundaries (typically 64 KiB), which already satisfies the "no whole-
    // file buffering" goal for `createReadStream` on big files.
    const handle = await this.getFileHandle(path);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (err) {
      throw mapOpfsError(err, path, 'file');
    }
    const start = opts?.start ?? 0;
    const end = opts?.end ?? file.size;
    const slice = start === 0 && end === file.size ? file : file.slice(start, end);
    return slice.stream() as ReadableStream<Uint8Array>;
  }
}

/** Re-exported to keep call sites that catch and wrap OPFS errors uniform. */
export type { OpfsErrorContext };
