export type VfsErrorCode = 'ENOENT' | 'EEXIST' | 'EISDIR' | 'ENOTDIR' | 'EPERM' | 'EINVAL';

export interface VfsStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtime: number;
}

export interface VfsDirent {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

/**
 * Virtual filesystem interface. Backends: in-memory (now), OPFS (M4).
 *
 * All paths are POSIX-style absolute paths starting with `/`. Backends
 * normalise paths internally — callers can pass either `/a/b/` or `/a/b`.
 */
export interface Vfs {
  readFile(path: string): Promise<Uint8Array>;
  readFileText(path: string, encoding?: 'utf8'): Promise<string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readdir(path: string): Promise<readonly VfsDirent[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<VfsStat>;
  exists(path: string): Promise<boolean>;
  /**
   * Open `path` as a `ReadableStream<Uint8Array>` for incremental reading.
   * `chunkSize` controls the default chunk size (default 64 KiB). `start`/`end`
   * are byte offsets (Node `createReadStream` semantics).
   *
   * Throws `VfsError('ENOENT', path)` if the file does not exist.
   * Throws `VfsError('EISDIR', path)` if `path` is a directory.
   */
  openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>>;
}
