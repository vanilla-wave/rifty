/**
 * Shared test fixture for the `path-*` test files. Spins up a synthetic
 * {@link WasiCtx} with a real `WebAssembly.Memory` so syscall factories can
 * read/write bytes through guest memory. The VFS mirror MUST be configured
 * by the caller before each test (`setSyncMirror`).
 *
 * Lives next to the production code (not under a `__tests__/` directory)
 * because vitest's `test:run` script scans `src/`.
 */
import { pathSyscalls } from './path.ts';
import { type FileDescriptor, type WasiCtx, enc } from './shared.ts';

type PathOpenFn = (
  fd: number,
  dirflags: number,
  pathPtr: number,
  pathLen: number,
  oflags: number,
  fsRightsBase: bigint,
  fsRightsInheriting: bigint,
  fdflags: number,
  outFd: number,
) => number;
type PathFilestatGetFn = (
  fd: number,
  flags: number,
  pathPtr: number,
  pathLen: number,
  outBuf: number,
) => number;
type PathCreateDirectoryFn = (fd: number, pathPtr: number, pathLen: number) => number;
type PathUnlinkFileFn = (fd: number, pathPtr: number, pathLen: number) => number;
type PathRemoveDirectoryFn = (fd: number, pathPtr: number, pathLen: number) => number;
type PathRenameFn = (
  oldFd: number,
  oldPtr: number,
  oldLen: number,
  newFd: number,
  newPtr: number,
  newLen: number,
) => number;
type PathReadlinkFn = (
  fd: number,
  pathPtr: number,
  pathLen: number,
  bufPtr: number,
  bufLen: number,
  bufUsed: number,
) => number;
type PathLinkFn = (
  oldFd: number,
  oldDirflags: number,
  oldPtr: number,
  oldLen: number,
  newFd: number,
  newPtr: number,
  newLen: number,
) => number;

export interface PathNs {
  path_open: PathOpenFn;
  path_filestat_get: PathFilestatGetFn;
  path_create_directory: PathCreateDirectoryFn;
  path_unlink_file: PathUnlinkFileFn;
  path_remove_directory: PathRemoveDirectoryFn;
  path_rename: PathRenameFn;
  path_readlink: PathReadlinkFn;
  path_link: PathLinkFn;
}

export interface PathCtx {
  ctx: WasiCtx;
  ns: PathNs;
  memory: WebAssembly.Memory;
  fds: Map<number, FileDescriptor>;
  /** Write a UTF-8 path into guest memory at `offset` and return its length. */
  writePath(offset: number, path: string): number;
  /** Read a u32 little-endian from `offset`. */
  readU32(offset: number): number;
}

export function setupPathCtx(): PathCtx {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const fds = new Map<number, FileDescriptor>();
  fds.set(3, { type: 'dir', path: '/work', isPreopen: true, preopenName: '/work' });
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds,
    cwdFd: 3,
    nextFd: { value: 4 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
    onStdin: () => null,
    view: () => new DataView(memory.buffer),
    bytes: () => new Uint8Array(memory.buffer),
  };
  // The factory returns `WebAssembly.ModuleImports` (a string-keyed dict).
  // For tests we want a typed view; cast through `unknown` is the standard
  // bridge here. The shape is stable — see `pathSyscalls`.
  const ns = pathSyscalls(ctx) as unknown as PathNs;
  return {
    ctx,
    ns,
    memory,
    fds,
    writePath(offset: number, path: string): number {
      const b = enc.encode(path);
      new Uint8Array(memory.buffer).set(b, offset);
      return b.length;
    },
    readU32(offset: number): number {
      return new DataView(memory.buffer).getUint32(offset, true);
    },
  };
}
