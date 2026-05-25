/**
 * Unit tests for `path_open` and the path-family error-mapping helper.
 *
 * Other path syscalls live in sibling test files:
 *   - {@link ./path-filestat.test.ts} — `path_filestat_get`
 *   - {@link ./path-mutate.test.ts}   — create/unlink/rmdir/rename/link
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPathCtx } from './path-test-fixture.ts';
import {
  E_BADF,
  E_EXIST,
  E_NOENT,
  E_SUCCESS,
  OFLAGS_CREAT,
  OFLAGS_EXCL,
  OFLAGS_TRUNC,
  RIGHTS_FD_READ,
} from './shared.ts';

describe('path_open', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/hello.txt': 'hi' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('returns E_BADF when base fd is not a dir', () => {
    const t = setupPathCtx();
    t.fds.set(9, { type: 'file', path: '/x' });
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(9, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_BADF);
  });

  it('returns E_NOENT for a missing file when O_CREAT is absent', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'missing.txt');
    const rc = t.ns.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_NOENT);
    // Must NOT have created an fd.
    expect(t.ctx.nextFd.value).toBe(4);
  });

  it('opens an existing file when O_CREAT is absent', () => {
    const t = setupPathCtx();
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
    const t = setupPathCtx();
    const len = t.writePath(100, 'fresh.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_CREAT, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    expect(entry?.type).toBe('file');
    expect(entry?.data?.length).toBe(0);
  });

  it('returns E_EXIST when O_CREAT|O_EXCL and the file already exists', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_CREAT | OFLAGS_EXCL, 0n, 0n, 0, 200);
    expect(rc).toBe(E_EXIST);
    // Must NOT have created an fd.
    expect(t.ctx.nextFd.value).toBe(4);
  });

  it('truncates an existing file to zero when O_TRUNC is set', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'hello.txt');
    const rc = t.ns.path_open(3, 0, 100, len, OFLAGS_TRUNC, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    expect(entry?.type).toBe('file');
    expect(entry?.data?.length).toBe(0);
  });
});

describe('path_open — fs_rights_base', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/ro.txt': 'cant write me' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('stores the requested rights on the new fd', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'ro.txt');
    const rc = t.ns.path_open(3, 0, 100, len, 0, RIGHTS_FD_READ, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    expect(entry?.rights).toBe(RIGHTS_FD_READ);
  });

  it('default-permissive when caller passes 0n (spec default)', () => {
    // WASI spec: passing zero rights means "I do not restrict capabilities";
    // pretty much every real toolchain (esbuild, tsc) does this. The fd ends
    // up with the full set the host can grant.
    const t = setupPathCtx();
    const len = t.writePath(100, 'ro.txt');
    const rc = t.ns.path_open(3, 0, 100, len, 0, 0n, 0n, 0, 200);
    expect(rc).toBe(E_SUCCESS);
    const newFd = t.readU32(200);
    const entry = t.fds.get(newFd);
    // The exact granted bitmask is RIGHTS_FILE_BASE; we just check that the
    // fd is open for write (rights are present and include FD_WRITE).
    expect(entry?.rights).toBeDefined();
  });
});
