/**
 * Unit tests for file-descriptor WASI preview1 syscalls (`fd_read`,
 * `fd_seek`, `fd_fdstat_get`, `fd_write` rights). Stat/readdir tests live
 * in {@link ./fd-stat-readdir.test.ts}.
 *
 * The shim is exercised through synthetic `WasiCtx` instances with a real
 * `WebAssembly.Memory` so we can read back the bytes the syscall wrote.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
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
  RIGHTS_FD_FILESTAT_SET_SIZE,
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

  it('returns E_PERM when explicit rights lack RIGHTS_FD_READ', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new TextEncoder().encode('hello'),
      cursor: 0,
      rights: RIGHTS_FD_WRITE,
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 5, true);

    expect(t.ns.fd_read(5, 0, 1, 300)).toBe(E_PERM);
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

  it('returns E_INVAL for unsafe BigInt offsets', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 0,
    });

    expect(t.ns.fd_seek(5, BigInt(Number.MAX_SAFE_INTEGER) + 1n, WHENCE_SET, 100)).toBe(E_INVAL);
  });

  it('returns E_PERM when explicit rights lack fd_seek', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      cursor: 3,
      rights: RIGHTS_FD_READ | RIGHTS_FD_WRITE,
    });

    expect(t.ns.fd_seek(5, 7n, WHENCE_SET, 100)).toBe(E_PERM);
    expect(t.fds.get(5)?.cursor).toBe(3);
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

  it('reports the descriptor explicit rights instead of synthetic defaults', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/x',
      data: new Uint8Array(10),
      rights: RIGHTS_FD_READ,
      rightsInheriting: RIGHTS_FD_WRITE,
    });
    const view = new DataView(t.memory.buffer);

    expect(t.ns.fd_fdstat_get(5, 100)).toBe(E_SUCCESS);
    expect(view.getBigUint64(108, true)).toBe(RIGHTS_FD_READ);
    expect(view.getBigUint64(116, true)).toBe(RIGHTS_FD_WRITE);
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

  it('honors FDFLAGS_APPEND for file writes', () => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/append.txt': 'abc' });
    setSyncMirror(mirror);
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/append.txt',
      data: new TextEncoder().encode('abc'),
      cursor: 0,
      fdflags: FDFLAGS_APPEND,
      rights: RIGHTS_FD_WRITE,
    });
    const view = new DataView(t.memory.buffer);
    const payload = new TextEncoder().encode('Z');
    new Uint8Array(t.memory.buffer).set(payload, 200);
    view.setUint32(0, 200, true);
    view.setUint32(4, payload.length, true);

    expect(t.ns.fd_write(5, 0, 1, 300)).toBe(E_SUCCESS);
    expect(new TextDecoder().decode(t.fds.get(5)?.data)).toBe('abcZ');
    expect(new TextDecoder().decode(mirror.readFileBytesSync('/append.txt'))).toBe('abcZ');
  });
});

// fd_write writes through to the VFS cache via syncMirror().writeFileSync
// (fd.ts:91). On a fitting write fd.ts reuses `fdEntry.data` IN PLACE
// (fd.ts:86-88), so the buffer last handed to writeFileSync is mutated again on
// the next write. Complementary guard for #3 / Q-2026-06-06-319: the mirror's
// defensive write-side slice must keep the cache consistent across that reuse —
// the cache reflects the bytes written, not a stale or over-mutated view.
describe('fd_write — write-through cache consistency under in-place reuse (#3)', () => {
  let mirror: MemoryFsSync;
  beforeEach(() => {
    mirror = new MemoryFsSync();
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  function writeFd(t: ReturnType<typeof setupFdCtx>, bytes: Uint8Array): number {
    new Uint8Array(t.memory.buffer).set(bytes, 200);
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true); // iov.ptr
    view.setUint32(4, bytes.length, true); // iov.len
    return t.ns.fd_write(5, 0, 1, 300);
  }

  it('two sequential same-length fd_writes (in-place reuse) land coherently in the cache', () => {
    const t = setupFdCtx();
    t.fds.set(5, { type: 'file', path: '/f.bin', data: new Uint8Array(0), cursor: 0 });

    expect(writeFd(t, new Uint8Array([1, 2, 3]))).toBe(E_SUCCESS);
    expect(Array.from(mirror.readFileBytesSync('/f.bin'))).toEqual([1, 2, 3]);

    // Reset cursor so the next write fits in the existing fdEntry.data buffer
    // (fd.ts:86 reuse branch — mutates the same buffer writeFileSync just saw).
    const fd = t.fds.get(5);
    if (fd) fd.cursor = 0;
    expect(writeFd(t, new Uint8Array([7, 8, 9]))).toBe(E_SUCCESS);
    // The cache must reflect the SECOND write, with no corruption from the
    // in-place mutation of the buffer the first write handed to the mirror.
    expect(Array.from(mirror.readFileBytesSync('/f.bin'))).toEqual([7, 8, 9]);
  });
});

describe('fd_pread', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('reads from an explicit offset without moving the cursor', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/pread.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 4,
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 3, true);

    const rc = t.ns.fd_pread(5, 0, 1, 1n, 300);

    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint32(300, true)).toBe(3);
    expect(new TextDecoder().decode(new Uint8Array(t.memory.buffer, 200, 3))).toBe('bcd');
    expect(t.fds.get(5)?.cursor).toBe(4);
  });

  it('returns E_PERM when explicit rights lack RIGHTS_FD_READ', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/pread.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 4,
      rights: RIGHTS_FD_WRITE,
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 3, true);

    expect(t.ns.fd_pread(5, 0, 1, 1n, 300)).toBe(E_PERM);
  });

  it('returns E_BADF for unknown and non-file fds', () => {
    const t = setupFdCtx();
    t.fds.set(6, { type: 'dir', path: '/d' });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 3, true);

    expect(t.ns.fd_pread(99, 0, 1, 0n, 300)).toBe(E_BADF);
    expect(t.ns.fd_pread(6, 0, 1, 0n, 300)).toBe(E_BADF);
  });

  it('returns E_INVAL for invalid offsets', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/pread.txt',
      data: new TextEncoder().encode('abc'),
      cursor: 0,
    });
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, 3, true);

    expect(t.ns.fd_pread(5, 0, 1, -1n, 300)).toBe(E_INVAL);
    expect(t.ns.fd_pread(5, 0, 1, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 300)).toBe(E_INVAL);
  });
});

describe('fd_pwrite', () => {
  let mirror: MemoryFsSync;
  beforeEach(() => {
    mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/pwrite.txt': 'abcdef' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  function writeIov(t: ReturnType<typeof setupFdCtx>, text: string): void {
    const payload = new TextEncoder().encode(text);
    new Uint8Array(t.memory.buffer).set(payload, 200);
    const view = new DataView(t.memory.buffer);
    view.setUint32(0, 200, true);
    view.setUint32(4, payload.length, true);
  }

  it('writes at an explicit offset without moving the cursor and writes through', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/pwrite.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 5,
      rights: RIGHTS_FD_WRITE,
    });
    writeIov(t, 'ZZ');

    const rc = t.ns.fd_pwrite(5, 0, 1, 2n, 300);

    expect(rc).toBe(E_SUCCESS);
    expect(new DataView(t.memory.buffer).getUint32(300, true)).toBe(2);
    expect(t.fds.get(5)?.cursor).toBe(5);
    expect(new TextDecoder().decode(t.fds.get(5)?.data)).toBe('abZZef');
    expect(new TextDecoder().decode(mirror.readFileBytesSync('/work/pwrite.txt'))).toBe('abZZef');
  });

  it('enforces write rights like fd_write', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/pwrite.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 5,
      rights: RIGHTS_FD_READ,
    });
    writeIov(t, 'NO');

    const rc = t.ns.fd_pwrite(5, 0, 1, 2n, 300);

    expect(rc).toBe(E_PERM);
    expect(t.fds.get(5)?.cursor).toBe(5);
    expect(new TextDecoder().decode(t.fds.get(5)?.data)).toBe('abcdef');
    expect(new TextDecoder().decode(mirror.readFileBytesSync('/work/pwrite.txt'))).toBe('abcdef');
  });

  it('returns E_BADF for unknown and non-file fds', () => {
    const t = setupFdCtx();
    t.fds.set(6, { type: 'dir', path: '/work' });
    writeIov(t, 'x');

    expect(t.ns.fd_pwrite(99, 0, 1, 0n, 300)).toBe(E_BADF);
    expect(t.ns.fd_pwrite(6, 0, 1, 0n, 300)).toBe(E_BADF);
  });

  it('returns E_INVAL for invalid offsets', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/pwrite.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 0,
      rights: RIGHTS_FD_WRITE,
    });
    writeIov(t, 'x');

    expect(t.ns.fd_pwrite(5, 0, 1, -1n, 300)).toBe(E_INVAL);
    expect(t.ns.fd_pwrite(5, 0, 1, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 300)).toBe(E_INVAL);
  });
});

describe('fd_filestat_set_size', () => {
  let mirror: MemoryFsSync;
  beforeEach(() => {
    mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/size.txt': 'abcdef' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('shrinks, grows with zero fill, and updates fd_filestat_get size', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/size.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 6,
      rights: RIGHTS_FD_FILESTAT_SET_SIZE,
    });
    const view = new DataView(t.memory.buffer);

    expect(t.ns.fd_filestat_set_size(5, 3n)).toBe(E_SUCCESS);
    expect(new TextDecoder().decode(t.fds.get(5)?.data)).toBe('abc');
    expect(new TextDecoder().decode(mirror.readFileBytesSync('/work/size.txt'))).toBe('abc');
    expect(t.ns.fd_filestat_get(5, 100)).toBe(E_SUCCESS);
    expect(view.getBigUint64(132, true)).toBe(3n);

    expect(t.ns.fd_filestat_set_size(5, 6n)).toBe(E_SUCCESS);
    expect(Array.from(t.fds.get(5)?.data ?? [])).toEqual([97, 98, 99, 0, 0, 0]);
    expect(Array.from(mirror.readFileBytesSync('/work/size.txt'))).toEqual([97, 98, 99, 0, 0, 0]);
    expect(t.ns.fd_filestat_get(5, 200)).toBe(E_SUCCESS);
    expect(view.getBigUint64(232, true)).toBe(6n);
  });

  it('returns E_BADF for unknown and non-file fds', () => {
    const t = setupFdCtx();
    t.fds.set(6, { type: 'dir', path: '/work' });

    expect(t.ns.fd_filestat_set_size(99, 0n)).toBe(E_BADF);
    expect(t.ns.fd_filestat_set_size(6, 0n)).toBe(E_BADF);
  });

  it('returns E_PERM when explicit rights lack fd_filestat_set_size', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/size.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 0,
      rights: RIGHTS_FD_READ | RIGHTS_FD_WRITE,
    });

    expect(t.ns.fd_filestat_set_size(5, 3n)).toBe(E_PERM);
  });

  it('returns E_INVAL for invalid sizes', () => {
    const t = setupFdCtx();
    t.fds.set(5, {
      type: 'file',
      path: '/work/size.txt',
      data: new TextEncoder().encode('abcdef'),
      cursor: 0,
    });

    expect(t.ns.fd_filestat_set_size(5, -1n)).toBe(E_INVAL);
    expect(t.ns.fd_filestat_set_size(5, BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe(E_INVAL);
  });
});
