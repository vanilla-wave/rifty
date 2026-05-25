/**
 * Unit tests for path-resolving WASI preview1 syscalls.
 *
 * The shim runs in Node (no Wasm engine attached). We synthesise a `WasiCtx`
 * with a real memory buffer and call the syscall factories directly. The VFS
 * mirror is reset between tests via `resetSyncMirror`.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathSyscalls } from './path.ts';
import {
  E_ACCES,
  E_BADF,
  E_EXIST,
  E_INVAL,
  E_NOENT,
  E_SUCCESS,
  type FileDescriptor,
  OFLAGS_CREAT,
  OFLAGS_EXCL,
  OFLAGS_TRUNC,
  type WasiCtx,
  enc,
} from './shared.ts';

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

interface PathNs {
  path_open: PathOpenFn;
  path_filestat_get: PathFilestatGetFn;
  path_create_directory: PathCreateDirectoryFn;
}

interface Ctx {
  ctx: WasiCtx;
  ns: PathNs;
  memory: WebAssembly.Memory;
  fds: Map<number, FileDescriptor>;
  /** Write a UTF-8 path into guest memory at `offset` and return its length. */
  writePath(offset: number, path: string): number;
  /** Read a u32 little-endian from `offset`. */
  readU32(offset: number): number;
}

function setupCtx(): Ctx {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const fds = new Map<number, FileDescriptor>();
  fds.set(3, { type: 'dir', path: '/work', isPreopen: true, preopenName: '/work' });
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds,
    nextFd: { value: 4 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
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

describe('path_open', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/hello.txt': 'hi' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF when base fd is not a dir', () => {
    const t = setupCtx();
    t.fds.set(9, { type: 'file', path: '/x' });
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(9, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_NOENT for a missing file when O_CREAT is absent', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'missing.txt');
    const rc = t.ns.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_NOENT);
    // Must NOT have created an fd.
    expect(t.ctx.nextFd.value).toBe(4);
  });

  it('opens an existing file when O_CREAT is absent', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    expect(newFd).toBe(4);
    const entry = t.fds.get(newFd);
    expect(entry?.type).toBe('file');
    expect(entry?.data && new TextDecoder().decode(entry.data)).toBe('hi');
  });

  it('creates a new empty file when O_CREAT is set and the file is missing', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'fresh.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_CREAT, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    expect(entry?.type).toBe('file');
    expect(entry?.data?.length).toBe(0);
  });

  it('returns E_EXIST when O_CREAT|O_EXCL and the file already exists', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_CREAT | OFLAGS_EXCL, 0n, 0n, 0, 200);
    expect(rc).toBe(E_EXIST);
    // Must NOT have created an fd.
    expect(t.ctx.nextFd.value).toBe(4);
  });

  it('truncates an existing file to zero when O_TRUNC is set', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_TRUNC, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    expect(entry?.type).toBe('file');
    expect(entry?.data?.length).toBe(0);
  });
});

describe('path_create_directory', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/existing/.keep': '' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('returns E_SUCCESS for a new directory', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'newdir');
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_SUCCESS);
  });

  it('maps EEXIST through to E_EXIST when the path exists as a directory', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'existing');
    // Install a sync mirror that throws an EEXIST-coded error from mkdirSync,
    // so we exercise the error-mapping path of `path_create_directory`.
    setSyncMirror({
      existsSync: () => true,
      readFileBytesSync: () => {
        throw new Error('unused');
      },
      writeFileSync: () => {},
      readdirSync: () => [],
      mkdirSync: () => {
        const err = new Error('EEXIST: /work/existing') as Error & { code: string };
        err.code = 'EEXIST';
        throw err;
      },
      rmSync: () => {},
      statSync: () => ({ isFile: false, isDirectory: true, size: 0, mtime: 0 }),
      utimes: () => {},
    });
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_EXIST);
  });

  it('maps EACCES through to E_ACCES', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'denied');
    setSyncMirror({
      existsSync: () => false,
      readFileBytesSync: () => {
        throw new Error('unused');
      },
      writeFileSync: () => {},
      readdirSync: () => [],
      mkdirSync: () => {
        const err = new Error('EACCES: /work/denied') as Error & { code: string };
        err.code = 'EACCES';
        throw err;
      },
      rmSync: () => {},
      statSync: () => ({ isFile: false, isDirectory: false, size: 0, mtime: 0 }),
      utimes: () => {},
    });
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_ACCES);
  });

  it('maps EINVAL to E_INVAL', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'bad-name');
    setSyncMirror({
      existsSync: () => false,
      readFileBytesSync: () => {
        throw new Error('unused');
      },
      writeFileSync: () => {},
      readdirSync: () => [],
      mkdirSync: () => {
        const err = new Error('EINVAL: bad path') as Error & { code: string };
        err.code = 'EINVAL';
        throw err;
      },
      rmSync: () => {},
      statSync: () => ({ isFile: false, isDirectory: false, size: 0, mtime: 0 }),
      utimes: () => {},
    });
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_INVAL);
  });

  it('falls back to E_NOENT for unknown errors (no code field)', () => {
    const t = setupCtx();
    const len = t.writePath(100, 'oops');
    setSyncMirror({
      existsSync: () => false,
      readFileBytesSync: () => {
        throw new Error('unused');
      },
      writeFileSync: () => {},
      readdirSync: () => [],
      mkdirSync: () => {
        throw new Error('no specific code attached');
      },
      rmSync: () => {},
      statSync: () => ({ isFile: false, isDirectory: false, size: 0, mtime: 0 }),
      utimes: () => {},
    });
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_NOENT);
  });
});
