/**
 * Unit tests for `fd_filestat_get` and `fd_readdir` — split from
 * {@link ./fd.test.ts} so each file stays under the ADR-0024 line budget.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupFdCtx } from './fd-test-fixture.ts';
import {
  E_BADF,
  E_NOTDIR,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
} from './shared.ts';

describe('fd_filestat_get', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF for an unknown fd', () => {
    const t = setupFdCtx();
    const rc = t.ns.fd_filestat_get(99, 100);
    expect(rc).toBe(E_BADF);
  });

  it('reports the file size for an open file fd', () => {
    const t = setupFdCtx();
    // Pre-populate the VFS so syncMirror().statSync returns the size.
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/abc': 'abcde' });
    setSyncMirror(mirror);
    t.fds.set(5, {
      type: 'file',
      path: '/work/abc',
      data: new TextEncoder().encode('abcde'),
      cursor: 0,
    });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_filestat_get(5, 100);
    expect(rc).toBe(E_SUCCESS);
    // filestat layout (64 bytes):
    //   0: dev (u64), 8: ino (u64), 16: filetype (u8),
    //   17..24: padding, 24: nlink (u64), 32: size (u64),
    //   40: atim (u64), 48: mtim (u64), 56: ctim (u64)
    expect(view.getUint8(116)).toBe(FILETYPE_REGULAR_FILE);
    expect(view.getBigUint64(132, true)).toBe(5n);
  });

  it('reports directory filetype for an open directory fd', () => {
    const t = setupFdCtx();
    const mirror = new MemoryFsSync();
    mirror.mkdirSync('/work/d', { recursive: true });
    setSyncMirror(mirror);
    t.fds.set(5, { type: 'dir', path: '/work/d' });
    const view = new DataView(t.memory.buffer);
    const rc = t.ns.fd_filestat_get(5, 100);
    expect(rc).toBe(E_SUCCESS);
    expect(view.getUint8(116)).toBe(FILETYPE_DIRECTORY);
  });
});

describe('fd_readdir', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF for an unknown fd', () => {
    const t = setupFdCtx();
    const rc = t.ns.fd_readdir(99, 100, 256, 0n, 400);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_NOTDIR (not E_BADF) for a valid file fd (ADR-0049)', () => {
    // Go's WASIp1 os layer (esbuild) opens a path then probes it with
    // fd_readdir: E_NOTDIR means "it's a file, read it as one" while E_BADF is
    // a hard error. Returning E_BADF here made esbuild abort on every file
    // entry point with "Cannot read directory: Bad file number".
    const t = setupFdCtx();
    t.fds.set(5, { type: 'file', path: '/work/f.txt', data: new Uint8Array(0) });
    const rc = t.ns.fd_readdir(5, 100, 256, 0n, 400);
    expect(rc).toBe(E_NOTDIR);
  });

  it('enumerates directory entries through the VFS', () => {
    const t = setupFdCtx();
    const mirror = new MemoryFsSync();
    mirror.loadFixture({
      '/work/d/a.txt': 'a',
      '/work/d/b.txt': 'b',
    });
    mirror.mkdirSync('/work/d/sub', { recursive: true });
    setSyncMirror(mirror);
    t.fds.set(5, { type: 'dir', path: '/work/d' });
    const rc = t.ns.fd_readdir(5, 100, 512, 0n, 400);
    expect(rc).toBe(E_SUCCESS);
    const view = new DataView(t.memory.buffer);
    const used = view.getUint32(400, true);
    expect(used).toBeGreaterThan(0);
    // Walk the dirent stream and collect names. dirent layout (21 bytes):
    //   0: d_next (u64), 8: d_ino (u64), 16: d_namlen (u32), 20: d_type (u8)
    const names: string[] = [];
    const dec = new TextDecoder();
    let off = 100;
    const end = 100 + used;
    while (off < end) {
      const namlen = view.getUint32(off + 16, true);
      const headerEnd = off + 21;
      if (headerEnd + namlen > end) break;
      const name = dec.decode(new Uint8Array(t.memory.buffer, headerEnd, namlen));
      names.push(name);
      off = headerEnd + namlen;
    }
    expect(names).toEqual(['a.txt', 'b.txt', 'sub']);
  });

  it('honours the cookie across paginated calls (no duplicates, no skips)', () => {
    // Reproduces the silent-stub bug: with N=5 entries and a buffer big
    // enough for only 2 per call, two successive `fd_readdir` calls should
    // return [0,1] then [2,3,4] — every entry exactly once. The first call
    // uses cookie=0, the second uses the cookie reported by the first.
    const t = setupFdCtx();
    const mirror = new MemoryFsSync();
    mirror.loadFixture({
      '/work/d/a.txt': 'a',
      '/work/d/b.txt': 'b',
      '/work/d/c.txt': 'c',
      '/work/d/d.txt': 'd',
      '/work/d/e.txt': 'e',
    });
    setSyncMirror(mirror);
    t.fds.set(5, { type: 'dir', path: '/work/d' });

    const view = new DataView(t.memory.buffer);
    const dec = new TextDecoder();

    // Each name is 5 bytes (`a.txt`), each dirent header is 21 bytes,
    // so each record is 26 bytes. Two records ≈ 52 bytes; sizing the
    // buffer at 60 leaves room for two complete records but cuts off the
    // third's header (21 bytes > 60 - 52 = 8).
    const bufA = 100;
    const lenA = 60;
    const usedPtrA = 400;
    const rcA = t.ns.fd_readdir(5, bufA, lenA, 0n, usedPtrA);
    expect(rcA).toBe(E_SUCCESS);
    const usedA = view.getUint32(usedPtrA, true);

    const namesA: string[] = [];
    let nextCookie = 0n;
    {
      let off = bufA;
      const end = bufA + usedA;
      while (off + 21 <= end) {
        const d_next = view.getBigUint64(off, true);
        const namlen = view.getUint32(off + 16, true);
        const headerEnd = off + 21;
        if (headerEnd + namlen > end) break;
        namesA.push(dec.decode(new Uint8Array(t.memory.buffer, headerEnd, namlen)));
        nextCookie = d_next;
        off = headerEnd + namlen;
      }
    }
    expect(namesA).toEqual(['a.txt', 'b.txt']);
    expect(nextCookie).toBe(2n);

    // Second call with the reported cookie. Bigger buffer so the rest fits.
    const bufB = 1024;
    const lenB = 512;
    const usedPtrB = 1600;
    const rcB = t.ns.fd_readdir(5, bufB, lenB, nextCookie, usedPtrB);
    expect(rcB).toBe(E_SUCCESS);
    const usedB = view.getUint32(usedPtrB, true);

    const namesB: string[] = [];
    {
      let off = bufB;
      const end = bufB + usedB;
      while (off + 21 <= end) {
        const namlen = view.getUint32(off + 16, true);
        const headerEnd = off + 21;
        if (headerEnd + namlen > end) break;
        namesB.push(dec.decode(new Uint8Array(t.memory.buffer, headerEnd, namlen)));
        off = headerEnd + namlen;
      }
    }
    expect(namesB).toEqual(['c.txt', 'd.txt', 'e.txt']);
  });
});
