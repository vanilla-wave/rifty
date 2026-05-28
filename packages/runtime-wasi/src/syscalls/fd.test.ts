/**
 * Unit tests for file-descriptor WASI preview1 syscalls (`fd_read`,
 * `fd_seek`, `fd_fdstat_get`, `fd_write` rights). Stat/readdir tests live
 * in {@link ./fd-stat-readdir.test.ts}.
 *
 * The shim is exercised through synthetic `WasiCtx` instances with a real
 * `WebAssembly.Memory` so we can read back the bytes the syscall wrote.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupFdCtx } from './fd-test-fixture.ts';
import {
  E_BADF,
  E_INVAL,
  E_PERM,
  E_SUCCESS,
  FDFLAGS_APPEND,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  RIGHTS_FD_READ,
  RIGHTS_FD_WRITE,
  WHENCE_CUR,
  WHENCE_END,
  WHENCE_SET,
} from './shared.ts';

describe('fd_read', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF for an unknown fd (not silent success)', () => {
    const t = setupFdCtx();
    const view = new DataView(t.memory.buffer);
    // Set up iovec at offset 0: ptr=200, len=10
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(999, 0, 1, 300);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_BADF for non-file fds like stdout', () => {
    const t = setupFdCtx();
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 10, true);
    const rc = t.ns.fd_read(1, 0, 1, 300);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_SUCCESS with 0 bytes at EOF for a valid file fd', () => {
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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

describe('fd_read — stdin (ADR-0049)', () => {
  // esbuild's `transform` surface (vite's TS/JSX path) feeds source over
  // stdin. fd 0 pulls from `ctx.onStdin`; a null/empty result is EOF.
  afterEach(() => resetSyncMirror());

  it('reads stdin bytes from the onStdin callback', () => {
    let delivered = false;
    const src = new TextEncoder().encode('hi stdin');
    const t = setupFdCtx({
      onStdin: () => {
        if (delivered) return null;
        delivered = true;
        return src;
      },
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true); // iov.ptr
    view.setUint32(4, 32, true); // iov.len
    const rc = t.ns.fd_read(0, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint32(300, true)).toBe(src.length);
    const got = new Uint8Array(t.memory.buffer, 200, src.length);
    expect(new TextDecoder().decode(got)).toBe('hi stdin');
  });

  it('returns 0 bytes (EOF) when onStdin yields null', () => {
    const t = setupFdCtx(); // default onStdin returns null
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 32, true);
    const rc = t.ns.fd_read(0, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint32(300, true)).toBe(0);
  });
});

describe('fd_seek', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_INVAL for an unknown whence', () => {
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
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
    const t = setupFdCtx();
    const rc = t.ns.fd_fdstat_get(99, 100);
    expect(rc).toBe(E_BADF);
  });

  it('writes a 24-byte fdstat struct for a regular file', () => {
    const t = setupFdCtx();
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
    const t = setupFdCtx();
    t.fds.set(5, { type: 'dir', path: '/d' });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_fdstat_get(5, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint8(100)).toBe(FILETYPE_DIRECTORY);
  });
});

describe('fd_write — rights enforcement', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_PERM when the open fd lacks RIGHTS_FD_WRITE', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/ro.txt',
      data: new Uint8Array(0),
      cursor: 0,
      // explicitly granted READ only — write must be rejected.
      rights: RIGHTS_FD_READ,
    });
    const view = new DataView(t.memory.buffer);
    const payload = new TextEncoder().encode('nope');
    new Uint8Array(t.memory.buffer).set(payload, 200);
    view.setUint32(0, 200, true); // iov.ptr
    view.setUint32(4, payload.length, true); // iov.len
    const rc = t.ns.fd_write(5, 0, 1, 300);
    expect(rc).toBe(E_PERM);
  });

  it('allows write when the open fd has RIGHTS_FD_WRITE', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/rw.txt',
      data: new Uint8Array(0),
      cursor: 0,
      rights: RIGHTS_FD_WRITE,
    });
    const view = new DataView(t.memory.buffer);
    const payload = new TextEncoder().encode('ok');
    new Uint8Array(t.memory.buffer).set(payload, 200);
    view.setUint32(0, 200, true);
    view.setUint32(4, payload.length, true);
    const rc = t.ns.fd_write(5, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
  });

  it('allows write when rights are undefined (default-permissive — stdio, preopens)', () => {
    // The fd was opened without explicit rights restriction (e.g. stdio,
    // preopens, default-permissive path_open). Writing must be permitted.
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/rw.txt',
      data: new Uint8Array(0),
      cursor: 0,
      // rights omitted on purpose
    });
    const view = new DataView(t.memory.buffer);
    const payload = new TextEncoder().encode('hello');
    new Uint8Array(t.memory.buffer).set(payload, 200);
    view.setUint32(0, 200, true);
    view.setUint32(4, payload.length, true);
    const rc = t.ns.fd_write(5, 0, 1, 300);
    expect(rc).toBe(E_SUCCESS);
  });
});
