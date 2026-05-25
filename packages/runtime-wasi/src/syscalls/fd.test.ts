/**
 * Unit tests for file-descriptor WASI preview1 syscalls.
 *
 * The shim is exercised through synthetic `WasiCtx` instances with a real
 * `WebAssembly.Memory` so we can read back the bytes the syscall wrote.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fdSyscalls } from './fd.ts';
import {
  E_BADF,
  E_INVAL,
  E_SUCCESS,
  FDFLAGS_APPEND,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  type FileDescriptor,
  WHENCE_CUR,
  WHENCE_END,
  WHENCE_SET,
  type WasiCtx,
} from './shared.ts';

type FdReadFn = (fd: number, iovs: number, iovsLen: number, nread: number) => number;
type FdSeekFn = (fd: number, offset: bigint, whence: number, newOffset: number) => number;
type FdFdstatGetFn = (fd: number, outPtr: number) => number;

interface FdNs {
  fd_read: FdReadFn;
  fd_seek: FdSeekFn;
  fd_fdstat_get: FdFdstatGetFn;
}

interface Ctx {
  ctx: WasiCtx;
  ns: FdNs;
  memory: WebAssembly.Memory;
  fds: Map<number, FileDescriptor>;
}

function setupCtx(): Ctx {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const fds = new Map<number, FileDescriptor>();
  fds.set(0, { type: 'stdin' });
  fds.set(1, { type: 'stdout' });
  fds.set(2, { type: 'stderr' });
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds,
    nextFd: { value: 3 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
    view: () => new DataView(memory.buffer),
    bytes: () => new Uint8Array(memory.buffer),
  };
  // The factory returns `WebAssembly.ModuleImports` (string-keyed dict). We
  // bridge to a typed view for tests; the shape is stable per `fdSyscalls`.
  const ns = fdSyscalls(ctx) as unknown as FdNs;
  return { ctx, ns, memory, fds };
}

describe('fd_read', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF for an unknown fd (not silent success)', () => {
    const t = setupCtx();
    const view = new DataView(t.memory.buffer);
    // Set up iovec at offset 0: ptr=200, len=10
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(999, 0, 1, 300);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_BADF for non-file fds like stdout', () => {
    const t = setupCtx();
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(1, 0, 1, 300);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_SUCCESS with 0 bytes at EOF for a valid file fd', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new TextEncoder().encode('hello'),
      cursor: 5, // at EOF
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(5, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint32(300, true)).toBe(0);
  });

  it('reads data from a file fd into guest memory', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new TextEncoder().encode('hello'),
      cursor: 0,
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(5, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint32(300, true)).toBe(5);
    const bytes = new Uint8Array(t.memory.buffer, 200, 5);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
});

describe('fd_seek', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_INVAL for an unknown whence', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });
    const rc = t.ns.fd_seek(5, 0n, 99, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('returns E_INVAL for negative absolute offset (whence=SET)', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });
    const rc = t.ns.fd_seek(5, -1n, WHENCE_SET, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('returns E_INVAL for relative seek that lands below 0 (whence=CUR)', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 2,
    });
    const rc = t.ns.fd_seek(5, -5n, WHENCE_CUR, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('returns E_INVAL for seek-from-end that lands below 0', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });
    const rc = t.ns.fd_seek(5, -20n, WHENCE_END, 100);
    expect(rc).toBe(E_INVAL);
  });

  it('seeks to absolute position with whence=SET', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_seek(5, 7n, WHENCE_SET, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(t.fds.get(5)?.cursor).toBe(7);
    expect(view.getBigUint64(100, true)).toBe(7n);
  });

  it('seeks relative with whence=CUR', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 3,
    });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_seek(5, 2n, WHENCE_CUR, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(t.fds.get(5)?.cursor).toBe(5);
    expect(view.getBigUint64(100, true)).toBe(5n);
  });

  it('seeks from end with whence=END', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_seek(5, -2n, WHENCE_END, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(t.fds.get(5)?.cursor).toBe(8);
    expect(view.getBigUint64(100, true)).toBe(8n);
  });
});

describe('fd_fdstat_get', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF for an unknown fd', () => {
    const t = setupCtx();
    const rc = t.ns.fd_fdstat_get(99, 100);
    expect(rc).toBe(E_BADF);
  });

  it('writes a 24-byte fdstat struct for a regular file', () => {
    const t = setupCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
      fdflags: FDFLAGS_APPEND,
    });
    const view = new DataView(t.memory.buffer);
    // Pre-fill the struct region with a sentinel so we can detect missed bytes.
    new Uint8Array(t.memory.buffer, 100, 24).fill(0xab);
    const rc = t.ns.fd_fdstat_get(5, 100);
    expect(rc).toBe(E_SUCCESS);
    // fs_filetype at byte 0 (u8)
    expect(view.getUint8(100)).toBe(FILETYPE_REGULAR_FILE);
    // padding byte at 101 should be cleared
    expect(view.getUint8(101)).toBe(0);
    // fs_flags at bytes 2..4 (u16 little-endian)
    expect(view.getUint16(102, true)).toBe(FDFLAGS_APPEND);
    // padding bytes at 104..108 should be cleared
    expect(view.getUint32(104, true)).toBe(0);
    // fs_rights_base at bytes 8..16 (u64). Non-zero for files; we just check it's been written (not the sentinel).
    expect(view.getBigUint64(108, true)).not.toBe(0xababababababababn);
    // fs_rights_inheriting at bytes 16..24
    expect(view.getBigUint64(116, true)).not.toBe(0xababababababababn);
  });

  it('writes filetype=DIRECTORY for a directory fd', () => {
    const t = setupCtx();
    t.fds.set(5, { type: 'dir', path: '/d' });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_fdstat_get(5, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint8(100)).toBe(FILETYPE_DIRECTORY);
  });
});
