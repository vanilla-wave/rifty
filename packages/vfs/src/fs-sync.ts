import type { VfsDirent } from './types.ts';

/**
 * Sync-side counterpart of {@link Vfs}. Implementations:
 *   - {@link MemoryFsSync} — in-memory, backed by a shared `MemoryBackend`
 *     (ADR-0014).
 *   - {@link OpfsFsSync} — OPFS via `FileSystemSyncAccessHandle`, Worker
 *     realm only (ADR-0013).
 *
 * Kept in its own module so backend implementations and the swap-in
 * registry (`sync-mirror.ts`) don't import each other.
 *
 * **Normalisation invariant** — every public method normalises its `path`
 * argument on entry: trailing slashes are stripped, `.`/`..` segments are
 * collapsed, and relative inputs are coerced to absolute. Backend
 * implementations MAY assume normalised input from this interface but
 * should still tolerate external sources passing un-normalised paths.
 */
export interface FsSync {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  /**
   * List immediate children of `path` as dirent records. Symmetric with
   * `Vfs.readdir` so adapter layers don't need an N+1 `statSync` per child
   * to recover the kind (ADR-0041).
   */
  readdirSync(path: string): readonly VfsDirent[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
  /**
   * Update the access and modification timestamps (in ms) on `path`. Mirrors
   * `node:fs.utimesSync` semantics (ADR-0029). `MemoryFsSync` writes through
   * to the shared backend; `OpfsFsSync` keeps an in-memory side-table because
   * `FileSystemSyncAccessHandle` exposes no mtime mutation primitive.
   * Throws `VfsError('ENOENT')` if `path` does not exist.
   */
  utimes(path: string, atimeMs: number, mtimeMs: number): void;
}
