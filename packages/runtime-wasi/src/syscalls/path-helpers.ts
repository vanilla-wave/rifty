/**
 * Internal helpers for the `path-*` syscall families: error mapping, fd-to-
 * dir-path resolution, default rights bag for `path_open`.
 *
 * Not exported from `@rifty/runtime-wasi` — these are implementation seams
 * for the {@link ../path-{open,filestat,mutate}.ts} factories.
 */
import { joinPath, normalizePath } from '@rifty/vfs';
import {
  E_ACCES,
  E_BADF,
  E_EXIST,
  E_INVAL,
  E_ISDIR,
  E_NOENT,
  E_NOTDIR,
  E_NOTEMPTY,
  E_PERM,
  type WasiCtx,
  dec,
} from './shared.ts';

/**
 * Map a caught error from the sync VFS mirror to a WASI preview1 errno.
 *
 * The VFS layer raises `VfsError` instances with a `code` field; native fs
 * shims (Node) and bare `Error` callers may also pass a `code` like
 * `'ENOENT'` / `'EEXIST'`. Anything we don't recognise falls back to
 * `E_INVAL` — `E_NOENT` was the previous default but it lied to guests
 * (they assumed the parent dir was missing and emitted misleading
 * messages). EINVAL ("Invalid argument") is the honest catch-all.
 */
export function errToWasiErrno(err: unknown): number {
  if (err && typeof err === 'object' && 'code' in err) {
    switch ((err as { code: unknown }).code) {
      case 'ENOENT':
        return E_NOENT;
      case 'EEXIST':
        return E_EXIST;
      case 'EISDIR':
        return E_ISDIR;
      case 'ENOTDIR':
        return E_NOTDIR;
      case 'EACCES':
        return E_ACCES;
      case 'EPERM':
        return E_PERM;
      case 'EINVAL':
        return E_INVAL;
      case 'ENOTEMPTY':
        return E_NOTEMPTY;
    }
  }
  return E_INVAL;
}

/** Read a NUL-free UTF-8 path from guest memory, resolved against `basePath`. */
export function resolveRel(ctx: WasiCtx, basePath: string, ptr: number, len: number): string {
  const relative = dec.decode(ctx.bytes().subarray(ptr, ptr + len));
  return normalizePath(joinPath(basePath, relative));
}

/**
 * Resolve a directory-fd to its VFS path, or signal `E_BADF` if it isn't a
 * directory. Compact helper so each call doesn't repeat the same guard.
 */
export function dirBase(
  ctx: WasiCtx,
  fd: number,
): { ok: true; path: string } | { ok: false; rc: number } {
  const base = ctx.fds.get(fd);
  if (!base || base.type !== 'dir' || !base.path) return { ok: false, rc: E_BADF };
  return { ok: true, path: base.path };
}

/**
 * Default `fs_rights_base` granted to a newly-opened file fd when the caller
 * passes `0n` (WASI spec: "do not restrict"). Mirrors what `fdSyscalls`
 * reports through `fd_fdstat_get`.
 */
export const RIGHTS_FILE_BASE =
  /* fd_datasync */ (1n << 0n) |
  /* fd_read */ (1n << 1n) |
  /* fd_seek */ (1n << 2n) |
  /* fd_fdstat_set_flags */ (1n << 3n) |
  /* fd_sync */ (1n << 4n) |
  /* fd_tell */ (1n << 5n) |
  /* fd_write */ (1n << 6n) |
  /* fd_advise */ (1n << 7n) |
  /* fd_allocate */ (1n << 8n) |
  /* fd_filestat_get */ (1n << 21n) |
  /* fd_filestat_set_size */ (1n << 22n) |
  /* fd_filestat_set_times */ (1n << 23n);
