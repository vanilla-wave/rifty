/**
 * Shared types, constants, and helpers for WASI preview1 syscalls. The syscall
 * factory modules ({@link ./fd.ts}, {@link ./path.ts}, {@link ./proc.ts}) consume
 * a {@link WasiCtx} that owns the mutable runtime state and memory accessors.
 *
 * Also owns the canonical preview1 rights bitsets ({@link RIGHTS_FILE_BASE},
 * {@link RIGHTS_DIR_BASE}) and the host-error → WASI errno mapping
 * ({@link errToWasiErrno}), keeping these definitions in one place.
 */

import { joinPath, normalizePath } from '@riftydev/vfs';

// preview1 errno subset
export const E_SUCCESS = 0;
export const E_ACCES = 2;
export const E_BADF = 8;
export const E_EXIST = 20;
export const E_INVAL = 28;
export const E_ISDIR = 31;
export const E_NAMETOOLONG = 37;
export const E_NOENT = 44;
export const E_NOSYS = 52;
export const E_NOTDIR = 54;
export const E_NOTEMPTY = 55;
export const E_PERM = 63;

// path_open oflags (preview1)
export const OFLAGS_CREAT = 1 << 0;
export const OFLAGS_DIRECTORY = 1 << 1;
export const OFLAGS_EXCL = 1 << 2;
export const OFLAGS_TRUNC = 1 << 3;

// fdflags (preview1, fs_flags in fdstat)
export const FDFLAGS_APPEND = 1 << 0;
export const FDFLAGS_DSYNC = 1 << 1;
export const FDFLAGS_NONBLOCK = 1 << 2;
export const FDFLAGS_RSYNC = 1 << 3;
export const FDFLAGS_SYNC = 1 << 4;

// preview1 rights bits we explicitly check (WASI spec rights table): `path_open`
// derives a new fd's granted rights; `fd_write` enforces write capability.
export const RIGHTS_FD_READ = 1n << 1n;
export const RIGHTS_FD_SEEK = 1n << 2n;
export const RIGHTS_FD_WRITE = 1n << 6n;
export const RIGHTS_FD_FILESTAT_SET_SIZE = 1n << 22n;

/**
 * Default `fs_rights_base` for a newly-opened file fd when the caller passes
 * `0n` (WASI spec: "do not restrict"). Also what `fd_fdstat_get` reports for
 * file fds and the clamp ceiling when a child fd inherits from a parent dir fd.
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

/**
 * Default `fs_rights_base` for a directory fd. `fd_fdstat_get` reports this, and
 * `path_open` uses it as the upper bound when a guest passes 0n (no restriction)
 * so child fds inherit only what the parent could do.
 */
export const RIGHTS_DIR_BASE =
  /* fd_fdstat_set_flags */ (1n << 3n) |
  /* fd_sync */ (1n << 4n) |
  /* path_create_directory */ (1n << 9n) |
  /* path_create_file */ (1n << 10n) |
  /* path_link_source */ (1n << 11n) |
  /* path_link_target */ (1n << 12n) |
  /* path_open */ (1n << 13n) |
  /* fd_readdir */ (1n << 14n) |
  /* path_readlink */ (1n << 15n) |
  /* path_rename_source */ (1n << 16n) |
  /* path_rename_target */ (1n << 17n) |
  /* path_filestat_get */ (1n << 18n) |
  /* path_filestat_set_size */ (1n << 19n) |
  /* path_filestat_set_times */ (1n << 20n) |
  /* fd_filestat_get */ (1n << 21n) |
  /* path_remove_directory */ (1n << 28n) |
  /* path_unlink_file */ (1n << 29n);

// clock ids (preview1)
export const CLOCKID_REALTIME = 0;
export const CLOCKID_MONOTONIC = 1;
export const CLOCKID_PROCESS_CPUTIME_ID = 2;
export const CLOCKID_THREAD_CPUTIME_ID = 3;

// whence (preview1)
export const WHENCE_SET = 0;
export const WHENCE_CUR = 1;
export const WHENCE_END = 2;

// preview1 filetype subset
export const FILETYPE_UNKNOWN = 0;
export const FILETYPE_DIRECTORY = 3;
export const FILETYPE_REGULAR_FILE = 4;

export interface FileDescriptor {
  type: 'stdin' | 'stdout' | 'stderr' | 'file' | 'dir';
  /** VFS path (for files/dirs). */
  path?: string;
  /** File contents (for files), kept in memory for the fd's lifetime. */
  data?: Uint8Array;
  cursor?: number;
  isPreopen?: boolean;
  preopenName?: string;
  /**
   * preview1 `fdflags` bitset (FDFLAGS_APPEND etc). Set by `path_open`.
   * Defaults to 0 for stdio/preopens and when unset.
   */
  fdflags?: number;
  /**
   * preview1 `rights` bitset granted at open time. `undefined` =
   * default-permissive (stdio/preopens — guests never open these, so never
   * negotiate rights). `path_open` sets it from `fs_rights_base`
   * (default-permissive when caller passed 0n, per spec). `fd_write` checks
   * `RIGHTS_FD_WRITE` and returns `E_PERM` if absent.
   */
  rights?: bigint;
  /**
   * preview1 `rights_inheriting` bitset — upper bound for rights granted to fds
   * opened *through* this fd via `path_open`. Stored on dir fds to clamp child
   * fds. `undefined` = default-permissive (stdio, preopens).
   */
  rightsInheriting?: bigint;
}

/**
 * WASI's `AT_FDCWD` base-fd sentinel: "resolve against the cwd". The witx type
 * is a signed `i32` of `-1`, but a wasm `i32` arg arrives in JS as either `-1`
 * (signed) or `0xffffffff` (unsigned) depending on the engine — callers must
 * check both.
 *
 * esbuild's Go/WASIp1 runtime emits `path_open(AT_FDCWD, "entry.ts")` rather
 * than threading the cwd dir fd through every call (ADR-0049).
 */
export const AT_FDCWD = -1;
export const AT_FDCWD_U32 = 0xffffffff;

export interface WasiCtx {
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly fds: Map<number, FileDescriptor>;
  /**
   * Fd that `AT_FDCWD` resolves to — the cwd preopen (fd 3 by default, or the
   * preopen named by `WasiOptions.cwd`). Path syscalls map an incoming
   * `AT_FDCWD` base fd to this before looking it up in the fd table.
   */
  readonly cwdFd: number;
  /** Allocator for the next file descriptor id. Mutable. */
  nextFd: { value: number };
  /** True once `proc_exit` was called. */
  exited: { value: boolean };
  exitCode: { value: number };
  readonly onStdout: (chunk: string) => void;
  readonly onStderr: (chunk: string) => void;
  /**
   * Pull the next stdin chunk, or `null` at EOF (immediate EOF when no `stdin`
   * option was passed). esbuild's `transform` surface (vite's TS/JSX path)
   * feeds source bytes here instead of via a file preopen.
   */
  readonly onStdin: () => Uint8Array | null;
  /** Lazy memory accessors — memory is bound after instantiation. */
  view(): DataView;
  bytes(): Uint8Array;
}

export const enc = new TextEncoder();
export const dec = new TextDecoder('utf-8');

export class WasiExit extends Error {
  readonly exitCode: number;
  constructor(code: number) {
    super(`WASI proc_exit(${code})`);
    this.name = 'WasiExit';
    this.exitCode = code;
  }
}

/**
 * Map a caught error from the sync VFS mirror to a WASI preview1 errno.
 *
 * Reads an `errno`-style `code` (`VfsError`, Node fs shims, bare `Error`).
 * Unrecognised codes fall back to `E_INVAL`, not the previous `E_NOENT`: that
 * lied to guests (they assumed a missing parent dir and emitted misleading
 * messages). EINVAL is the honest catch-all.
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
 * Map an incoming base fd to a concrete fd id, translating WASI's `AT_FDCWD`
 * sentinel (`-1` / `0xffffffff`) to the ctx's cwd fd. All path-relative
 * syscalls run their base fd through this before touching the fd table.
 */
export function resolveDirFd(ctx: WasiCtx, fd: number): number {
  return fd === AT_FDCWD || fd === AT_FDCWD_U32 ? ctx.cwdFd : fd;
}

/**
 * Resolve a directory-fd to its VFS path, or signal `E_BADF` if it isn't a
 * directory. Honours `AT_FDCWD` via {@link resolveDirFd}.
 */
export function dirBase(
  ctx: WasiCtx,
  fd: number,
): { ok: true; path: string } | { ok: false; rc: number } {
  const base = ctx.fds.get(resolveDirFd(ctx, fd));
  if (!base || base.type !== 'dir' || !base.path) return { ok: false, rc: E_BADF };
  return { ok: true, path: base.path };
}
