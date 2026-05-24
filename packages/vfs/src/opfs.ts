/**
 * OPFS (Origin Private File System) backend.
 *
 * Works inside a Worker (where `navigator.storage.getDirectory()` is available
 * and so is `FileSystemFileHandle.createSyncAccessHandle()`). Use this for
 * persistent storage in the deployed playground.
 *
 * Outside of an OPFS-capable environment (Node tests, some private browsing
 * modes), `OpfsVfs.isSupported()` returns `false` and the constructor throws.
 */

import { VfsError } from './errors.ts';
import { basename, dirname, segments } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

export class OpfsVfs implements Vfs {
  private root: FileSystemDirectoryHandle | null = null;

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
    let dir = this.root!;
    for (const part of segments(path)) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        throw new VfsError('ENOENT', path, (err as Error).message);
      }
    }
    return dir;
  }

  private async getFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.getDirectory(dirname(path), create);
    try {
      return await parent.getFileHandle(basename(path), { create });
    } catch (err) {
      throw new VfsError('ENOENT', path, (err as Error).message);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const handle = await this.getFileHandle(path);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readFileText(path: string): Promise<string> {
    const bytes = await this.readFile(path);
    return new TextDecoder().decode(bytes);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const handle = await this.getFileHandle(path, true);
    const writable = await handle.createWritable();
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await writable.write(bytes as unknown as FileSystemWriteChunkType);
    await writable.close();
  }

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const dir = await this.getDirectory(path);
    const out: VfsDirent[] = [];
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
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const recursive = options?.recursive ?? false;
    await this.init();
    let dir = this.root!;
    const parts = segments(path);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      try {
        dir = await dir.getDirectoryHandle(part, { create: recursive || i === parts.length - 1 });
      } catch (err) {
        throw new VfsError('ENOENT', `/${parts.slice(0, i + 1).join('/')}`, (err as Error).message);
      }
    }
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const parent = await this.getDirectory(dirname(path)).catch(() => null);
    if (!parent) {
      if (options?.force) return;
      throw new VfsError('ENOENT', dirname(path));
    }
    try {
      await parent.removeEntry(basename(path), { recursive: options?.recursive ?? false });
    } catch (err) {
      if (options?.force) return;
      throw new VfsError('ENOENT', path, (err as Error).message);
    }
  }

  async stat(path: string): Promise<VfsStat> {
    // Try as file first, then directory.
    try {
      const handle = await this.getFileHandle(path);
      const file = await handle.getFile();
      return { isFile: true, isDirectory: false, size: file.size, mtime: file.lastModified };
    } catch {
      await this.getDirectory(path);
      return { isFile: false, isDirectory: true, size: 0, mtime: 0 };
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
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
    const file = await handle.getFile();
    const start = opts?.start ?? 0;
    const end = opts?.end ?? file.size;
    const slice = start === 0 && end === file.size ? file : file.slice(start, end);
    return slice.stream() as ReadableStream<Uint8Array>;
  }
}
