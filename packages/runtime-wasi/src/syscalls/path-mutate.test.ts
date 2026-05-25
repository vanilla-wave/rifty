/**
 * Unit tests for mutating path syscalls: `path_create_directory`,
 * `path_unlink_file`, `path_remove_directory`, `path_rename`, plus the link
 * family stubs (`path_link`, `path_readlink`). See {@link ./path-mutate.ts}.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPathCtx } from './path-test-fixture.ts';
import {
  E_ACCES,
  E_BADF,
  E_EXIST,
  E_INVAL,
  E_NOENT,
  E_NOSYS,
  E_NOTEMPTY,
  E_SUCCESS,
} from './shared.ts';

describe('path_create_directory', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/existing/.keep': '' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('returns E_SUCCESS for a new directory', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'newdir');
    const rc = t.ns.path_create_directory(3, 100, len);
    expect(rc).toBe(E_SUCCESS);
  });

  it('maps EEXIST through to E_EXIST when the path exists as a directory', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'existing');
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
    const t = setupPathCtx();
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
    const t = setupPathCtx();
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

  it('falls back to E_INVAL for unknown errors (no code field)', () => {
    // Previously this mapped to E_NOENT, which lied to guests — they assumed
    // the parent dir was missing and emitted a misleading message. WASI spec
    // EINVAL ("Invalid argument") is the honest catch-all for unmapped errors
    // from the host VFS layer; guests retry / abort accordingly.
    const t = setupPathCtx();
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
    expect(rc).toBe(E_INVAL);
  });
});

describe('path_unlink_file', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/doomed.txt': 'bye' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('removes the file from the VFS', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'doomed.txt');
    const rc = t.ns.path_unlink_file(3, 100, len);
    expect(rc).toBe(E_SUCCESS);
    // Confirm via path_filestat_get that the file is gone.
    const len2 = t.writePath(100, 'doomed.txt');
    const rc2 = t.ns.path_filestat_get(3, 0, 100, len2, 300);
    expect(rc2).toBe(E_NOENT);
  });

  it('returns E_NOENT for a missing file', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'never-there.txt');
    const rc = t.ns.path_unlink_file(3, 100, len);
    expect(rc).toBe(E_NOENT);
  });

  it('returns E_BADF if base is not a directory', () => {
    const t = setupPathCtx();
    t.fds.set(9, { type: 'file', path: '/x' });
    const len = t.writePath(100, 'whatever');
    const rc = t.ns.path_unlink_file(9, 100, len);
    expect(rc).toBe(E_BADF);
  });
});

describe('path_remove_directory', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({
      '/work/empty/.keep': '',
      '/work/full/a.txt': 'a',
      '/work/full/b.txt': 'b',
    });
    // Remove the .keep so /work/empty is truly empty
    mirror.rmSync('/work/empty/.keep', {});
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('removes an empty directory', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'empty');
    const rc = t.ns.path_remove_directory(3, 100, len);
    expect(rc).toBe(E_SUCCESS);
  });

  it('returns E_NOTEMPTY for a non-empty directory', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'full');
    const rc = t.ns.path_remove_directory(3, 100, len);
    expect(rc).toBe(E_NOTEMPTY);
  });

  it('returns E_NOENT for a missing directory', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'missing');
    const rc = t.ns.path_remove_directory(3, 100, len);
    expect(rc).toBe(E_NOENT);
  });
});

describe('path_rename', () => {
  beforeEach(() => {
    const mirror = new MemoryFsSync();
    mirror.loadFixture({ '/work/src.txt': 'payload' });
    setSyncMirror(mirror);
  });
  afterEach(() => resetSyncMirror());

  it('moves a file and removes the source', () => {
    const t = setupPathCtx();
    const srcLen = t.writePath(100, 'src.txt');
    const dstLen = t.writePath(200, 'dst.txt');
    const rc = t.ns.path_rename(3, 100, srcLen, 3, 200, dstLen);
    expect(rc).toBe(E_SUCCESS);
    // Source is gone.
    const len2 = t.writePath(100, 'src.txt');
    expect(t.ns.path_filestat_get(3, 0, 100, len2, 300)).toBe(E_NOENT);
    // Dest exists.
    const len3 = t.writePath(200, 'dst.txt');
    expect(t.ns.path_filestat_get(3, 0, 200, len3, 400)).toBe(E_SUCCESS);
  });

  it('returns E_NOENT when source does not exist', () => {
    const t = setupPathCtx();
    const srcLen = t.writePath(100, 'absent.txt');
    const dstLen = t.writePath(200, 'dst.txt');
    const rc = t.ns.path_rename(3, 100, srcLen, 3, 200, dstLen);
    expect(rc).toBe(E_NOENT);
  });

  it('returns E_BADF when source base fd is not a directory', () => {
    const t = setupPathCtx();
    t.fds.set(9, { type: 'file', path: '/x' });
    const srcLen = t.writePath(100, 'src.txt');
    const dstLen = t.writePath(200, 'dst.txt');
    const rc = t.ns.path_rename(9, 100, srcLen, 3, 200, dstLen);
    expect(rc).toBe(E_BADF);
  });
});

describe('path_readlink', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_NOSYS — VFS does not model symlinks', () => {
    const t = setupPathCtx();
    const len = t.writePath(100, 'some-link');
    const rc = t.ns.path_readlink(3, 100, len, 300, 100, 400);
    expect(rc).toBe(E_NOSYS);
  });
});

describe('path_link', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
  });
  afterEach(() => resetSyncMirror());

  it('returns E_NOSYS — VFS does not model hard links', () => {
    const t = setupPathCtx();
    const srcLen = t.writePath(100, 'src');
    const dstLen = t.writePath(200, 'dst');
    const rc = t.ns.path_link(3, 0, 100, srcLen, 3, 200, dstLen);
    expect(rc).toBe(E_NOSYS);
  });
});
