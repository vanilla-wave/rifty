import type { FsStat } from './stat-metadata.ts';
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
 * **Path invariant** — every method asserts an absolute POSIX path on entry,
 * then normalises it: trailing slashes stripped, `.`/`..` collapsed. Relative
 * inputs throw (ADR-0199); cwd anchoring belongs to callers above VFS.
 */
export interface FsSync {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  /**
   * Positional read (ADR-0576): exactly bytes `[position, min(size, position +
   * length))` of the current content, empty at/after EOF. Errors as
   * {@link readFileBytesSync}. Read-only, valid until the store's next
   * mutation (may be a view). `TypeError` unless both are non-negative safe
   * integers.
   */
  readFileRangeSync(path: string, position: number, length: number): Uint8Array;
  /**
   * `data` is handed over: a store may keep it as the file's bytes
   * (`MemoryFsSync` does, `OpfsFsSync` copies). A caller passing memory a guest
   * still holds copies first (runtime-js `fs` does).
   */
  writeFileSync(path: string, data: Uint8Array): void;
  /**
   * Immediate children of `path` as dirent records. Symmetric with
   * `Vfs.readdir` so adapters avoid an N+1 `statSync` per child to recover
   * the kind (ADR-0041).
   */
  readdirSync(path: string): readonly VfsDirent[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): FsStat;
  /**
   * Non-throwing stat: returns `null` on a genuine miss instead of throwing
   * (ADR-0083). `statSync` stays throwing (Node `fs.statSync` parity) — this is
   * the additive companion that collapses the resolver's `existsSync`+`statSync`
   * double-probe to one call. `null` is the contract, not a stub. Precedent:
   * ADR-0029/0041 grew this interface the same way.
   */
  statSyncOrNull(path: string): FsStat | null;
  /**
   * Set access/modification timestamps (ms) on `path`. Mirrors
   * `node:fs.utimesSync` (ADR-0029). `MemoryFsSync` writes through to the
   * shared backend; `OpfsFsSync` keeps an in-memory side-table because
   * `FileSystemSyncAccessHandle` exposes no mtime mutation primitive.
   * @throws `VfsError('ENOENT')` if `path` does not exist.
   */
  utimes(path: string, atimeMs: number, mtimeMs: number): void;
  /**
   * Copy a single regular file `src` → `dst`. Byte copy; `dst` mtime = now (a
   * copy is a new file — matches `node:fs.copyFileSync`, which does NOT
   * preserve mtime). Overwrites an existing file `dst` (no `COPYFILE_EXCL`).
   * @throws `VfsError('ENOENT')` if `src` or `dst`'s parent is absent.
   * @throws `VfsError('EISDIR')` if `src` OR `dst` is a directory (single-file
   *   copy never recurses — use {@link cpSync} with `recursive`).
   */
  copyFileSync(src: string, dst: string): void;
  /**
   * `node:fs.cpSync`-faithful copy. Without `recursive`: a file behaves as
   * {@link copyFileSync}, a directory `src` throws `EISDIR`. With
   * `recursive: true`: a directory is copied depth-first (lexicographic per
   * {@link readdirSync}). Best-effort, NOT transactional — on a child failure
   * the first `VfsError` propagates (fail-fast) and entries copied before the
   * throw remain at `dst` (no rollback; backends keep no journal). Per-file
   * overwrite (Node `force: true` default).
   */
  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void;
  /**
   * Move/rename `src` → `dst`, atomic-where-the-backend-allows, **mtime
   * preserved** (a rename is not a content write). Same-dir and cross-dir.
   * `node:fs.renameSync` parity: `dst` absent → move; `dst` file & `src` file
   * → overwrite; `dst` empty-dir & `src` dir → replace; `dst` non-empty dir →
   * `ENOTEMPTY`; kind mismatch → `EISDIR`/`ENOTDIR`; `src` absent → `ENOENT`;
   * `src === dst` (post-normalize) → no-op; dir into its own subtree → `EINVAL`.
   */
  renameSync(src: string, dst: string): void;
}

/** ADR-0576 argument check shared by every range-serving store. */
export function assertReadRange(position: number, length: number): void {
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new TypeError(
      `readFileRangeSync position must be a non-negative safe integer; got ${position}`,
    );
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(
      `readFileRangeSync length must be a non-negative safe integer; got ${length}`,
    );
  }
}

/** `[position, position + length)` of `bytes`, clamped to EOF; a view. */
export function sliceReadRange(bytes: Uint8Array, position: number, length: number): Uint8Array {
  assertReadRange(position, length);
  const start = Math.min(position, bytes.byteLength);
  return bytes.subarray(start, Math.min(bytes.byteLength, start + length));
}
