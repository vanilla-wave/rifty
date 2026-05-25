/**
 * Shared types and constants for WASI preview1 syscalls. The syscall factory
 * modules ({@link ./env}, {@link ./fd}, etc.) consume a {@link WasiCtx} that
 * owns the mutable runtime state and the memory accessors.
 */

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

// preview1 rights subset — bits we explicitly check (see WASI spec rights table).
// Used by `path_open` to derive the granted rights set on a new fd and by
// `fd_write` to enforce that the open token actually had write capability.
export const RIGHTS_FD_READ = 1n << 1n;
export const RIGHTS_FD_WRITE = 1n << 6n;

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
  /** File contents (for files), kept in memory for the lifetime of the fd. */
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
   * preview1 `rights` bitset granted at open time. When undefined, the fd is
   * treated as default-permissive (used for stdio and preopens — guests don't
   * open these and so never negotiate rights). `path_open` sets this from
   * `fs_rights_base` (default-permissive when caller passed 0n, per WASI
   * spec). `fd_write` checks `RIGHTS_FD_WRITE` and returns `E_PERM` if absent.
   */
  rights?: bigint;
}

export interface WasiCtx {
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly fds: Map<number, FileDescriptor>;
  /** Allocator for the next file descriptor id. Mutable. */
  nextFd: { value: number };
  /** True once `proc_exit` was called. */
  exited: { value: boolean };
  exitCode: { value: number };
  readonly onStdout: (chunk: string) => void;
  readonly onStderr: (chunk: string) => void;
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
