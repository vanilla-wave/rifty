export type VfsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  /** Directory removal attempted without `recursive: true` on a non-empty dir (Node parity). */
  | 'ENOTEMPTY'
  | 'EPERM'
  | 'EINVAL'
  | 'EACCES'
  | 'EDQUOT'
  | 'EIO';

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
 *
 * **Path invariant** — every public method asserts an absolute POSIX path on
 * entry, then normalises it: trailing slashes are stripped and `.`/`..`
 * segments are collapsed. Relative inputs throw (ADR-0199); cwd anchoring
 * belongs to callers above VFS.
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
   * Update the access and modification timestamps (in ms) on `path`. Mirrors
   * `node:fs.promises.utimes` semantics; symmetric with `FsSync.utimes`
   * (ADR-0029, ADR-0041). `MemoryVfs` writes through to the shared backend;
   * `OpfsVfs` keeps an in-memory side-table (`FileSystemFileHandle` exposes
   * no native mtime mutation).
   * Throws `VfsError('ENOENT', path)` if `path` does not exist.
   */
  utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void>;
  /**
   * Open `path` as a `ReadableStream<Uint8Array>` for incremental reading.
   * `chunkSize` controls the default chunk size (default 64 KiB). `start`/`end`
   * are byte offsets over a HALF-OPEN `[start, end)` window (`end` exclusive,
   * `slice`-like, default file size). Node's `fs.createReadStream` `end` is
   * inclusive — the `createReadStream` layer adds the `+1` conversion.
   *
   * Throws `VfsError('ENOENT', path)` if the file does not exist.
   * Throws `VfsError('EISDIR', path)` if `path` is a directory.
   */
  openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>>;
}
