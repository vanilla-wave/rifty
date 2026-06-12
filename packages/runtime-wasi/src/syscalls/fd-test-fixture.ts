/**
 * Shared test fixture for the `fd-*` test files. Spins up a synthetic
 * {@link WasiCtx} with a real `WebAssembly.Memory` so syscall factories can
 * read/write bytes through guest memory. The VFS mirror MUST be configured
 * by the caller before each test (`setSyncMirror`).
 *
 * Lives next to the production code (not under a `__tests__/` directory)
 * because vitest's `test:run` script scans `src/`.
 */
import { fdSyscalls } from './fd.ts';
import type { FileDescriptor, WasiCtx } from './shared.ts';

type FdReadFn = (fd: number, iovs: number, iovsLen: number, nread: number) => number;
type FdSeekFn = (fd: number, offset: bigint, whence: number, newOffset: number) => number;
type FdFdstatGetFn = (fd: number, outPtr: number) => number;
type FdWriteFn = (fd: number, iovs: number, iovsLen: number, nwritten: number) => number;
type FdPreadFn = (
  fd: number,
  iovs: number,
  iovsLen: number,
  offset: bigint,
  nread: number,
) => number;
type FdPwriteFn = (
  fd: number,
  iovs: number,
  iovsLen: number,
  offset: bigint,
  nwritten: number,
) => number;
type FdFilestatGetFn = (fd: number, outBuf: number) => number;
type FdFilestatSetSizeFn = (fd: number, size: bigint) => number;
type FdReaddirFn = (
  fd: number,
  bufPtr: number,
  bufLen: number,
  cookie: bigint,
  bufUsed: number,
) => number;

export interface FdNs {
  fd_read: FdReadFn;
  fd_seek: FdSeekFn;
  fd_fdstat_get: FdFdstatGetFn;
  fd_write: FdWriteFn;
  fd_pread: FdPreadFn;
  fd_pwrite: FdPwriteFn;
  fd_filestat_get: FdFilestatGetFn;
  fd_filestat_set_size: FdFilestatSetSizeFn;
  fd_readdir: FdReaddirFn;
}

export interface FdCtx {
  ctx: WasiCtx;
  ns: FdNs;
  memory: WebAssembly.Memory;
  fds: Map<number, FileDescriptor>;
}

export interface FdCtxOptions {
  /** Override the stdin source (defaults to immediate EOF). */
  onStdin?: () => Uint8Array | null;
}

export function setupFdCtx(opts: FdCtxOptions = {}): FdCtx {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const fds = new Map<number, FileDescriptor>();
  fds.set(0, { type: 'stdin' });
  fds.set(1, { type: 'stdout' });
  fds.set(2, { type: 'stderr' });
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds,
    cwdFd: 3,
    nextFd: { value: 3 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
    onStdin: opts.onStdin ?? (() => null),
    view: () => new DataView(memory.buffer),
    bytes: () => new Uint8Array(memory.buffer),
  };
  // The factory returns `WebAssembly.ModuleImports` (string-keyed dict). We
  // bridge to a typed view for tests; the shape is stable per `fdSyscalls`.
  const ns = fdSyscalls(ctx) as unknown as FdNs;
  return { ctx, ns, memory, fds };
}
