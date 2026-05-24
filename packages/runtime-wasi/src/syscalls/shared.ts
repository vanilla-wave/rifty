/**
 * Shared types and constants for WASI preview1 syscalls. The syscall factory
 * modules ({@link ./env}, {@link ./fd}, etc.) consume a {@link WasiCtx} that
 * owns the mutable runtime state and the memory accessors.
 */

// preview1 errno subset
export const E_SUCCESS = 0;
export const E_BADF = 8;
export const E_NOENT = 44;
export const E_NAMETOOLONG = 37;
export const E_NOSYS = 52;

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
