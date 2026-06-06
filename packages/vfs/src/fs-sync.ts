import type { VfsDirent } from './types.ts';

/**
 * Sync-side counterpart of {@link Vfs}. Implementations:
 *   - {@link MemoryFsSync} — in-memory, backed by a shared `MemoryBackend`
 *     (ADR-0014).
 *   - {@link OpfsFsSync} — OPFS via `FileSystemSyncAccessHandle`, Worker
 *     realm only (ADR-0013).
 *
 * Own module so backend impls and the swap-in registry (`sync-mirror.ts`)
 * don't import each other.
 *
 * **Normalisation invariant** — every method normalises `path` on entry:
 * trailing slashes stripped, `.`/`..` collapsed, relative coerced to
 * absolute. Backends MAY assume normalised input here but should still
 * tolerate un-normalised paths from external sources.
 */
export interface FsSync {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  /**
   * Immediate children of `path` as dirent records. Symmetric with
   * `Vfs.readdir` so adapters avoid an N+1 `statSync` per child to recover
   * the kind (ADR-0041).
   */
  readdirSync(path: string): readonly VfsDirent[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
  /**
   * Set access/modification timestamps (ms) on `path`. Mirrors
   * `node:fs.utimesSync` (ADR-0029). `MemoryFsSync` writes through to the
   * shared backend; `OpfsFsSync` keeps an in-memory side-table because
   * `FileSystemSyncAccessHandle` exposes no mtime mutation primitive.
   * @throws `VfsError('ENOENT')` if `path` does not exist.
   */
  utimes(path: string, atimeMs: number, mtimeMs: number): void;
}
