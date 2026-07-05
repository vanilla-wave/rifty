/**
 * Strict path semantics shared by BOTH FsSync backends (review 2026-07-05):
 *  - traversal THROUGH a file is ENOTDIR, never a silent miss→ENOENT
 *    (Node: open/stat/scandir/unlink 'file/x' → ENOTDIR);
 *  - `rm force` suppresses only ENOENT (verified against real Node);
 *  - errors name the TARGET path as passed, not the parent.
 * Node-vs-rifty cross-engine contract: parity case
 * fs/error-shape-errno-syscall. Here the SAME assertions run against
 * `MemoryFsSync` and `OpfsFsSync` so the backends cannot drift apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import { OpfsFsSync } from './opfs-sync.ts';
import { MemoryFsSync } from './sync-mirror.ts';

const enc = new TextEncoder();

/**
 * Minimal root handle: OpfsFsSync persist paths are fire-and-forget and
 * swallow errors, so every async method can just reject — the sync mirror is
 * the surface under test.
 */
function stubRoot(): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: '',
    isSameEntry: () => Promise.resolve(false),
    getFileHandle: () => Promise.reject(new Error('stub')),
    getDirectoryHandle: () => Promise.reject(new Error('stub')),
    removeEntry: () => Promise.reject(new Error('stub')),
    resolve: () => Promise.resolve([]),
    entries: () => {
      throw new Error('stub');
    },
  } as unknown as FileSystemDirectoryHandle;
}

function thrown(fn: () => unknown): VfsError {
  try {
    fn();
  } catch (err) {
    return err as VfsError;
  }
  throw new Error('expected throw, got none');
}

const backends: ReadonlyArray<[string, () => FsSync]> = [
  ['MemoryFsSync', () => new MemoryFsSync()],
  ['OpfsFsSync', () => new OpfsFsSync(stubRoot())],
];

describe.each(backends)('%s strict path semantics', (_name, make) => {
  beforeEach(() => {
    vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seed(): FsSync {
    const fs = make();
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/dir/keep.txt', enc.encode('k'));
    fs.writeFileSync('/plain.txt', enc.encode('x'));
    return fs;
  }

  it('read/stat/readdir/utimes THROUGH a file → ENOTDIR naming the target', () => {
    const fs = seed();
    for (const fn of [
      () => fs.readFileBytesSync('/plain.txt/x'),
      () => fs.statSync('/plain.txt/x'),
      () => fs.readdirSync('/plain.txt/x'),
      () => fs.utimes('/plain.txt/x', 1, 1),
    ]) {
      const err = thrown(fn);
      expect(err.code).toBe('ENOTDIR');
      expect(err.path).toBe('/plain.txt/x');
    }
  });

  it('rm through a file → ENOTDIR even with force; force still suppresses ENOENT', () => {
    const fs = seed();
    expect(thrown(() => fs.rmSync('/plain.txt/x', { force: true })).code).toBe('ENOTDIR');
    expect(() => fs.rmSync('/missing', { force: true })).not.toThrow();
    expect(thrown(() => fs.rmSync('/missing', {})).code).toBe('ENOENT');
  });

  it('writeFile errors name the TARGET, not the parent', () => {
    const fs = seed();
    const missingParent = thrown(() => fs.writeFileSync('/nodir/f.txt', enc.encode('x')));
    expect(missingParent.code).toBe('ENOENT');
    expect(missingParent.path).toBe('/nodir/f.txt');
    const throughFile = thrown(() => fs.writeFileSync('/plain.txt/f.txt', enc.encode('x')));
    expect(throughFile.code).toBe('ENOTDIR');
    expect(throughFile.path).toBe('/plain.txt/f.txt');
  });

  it('mkdir through a file → ENOTDIR naming the full target', () => {
    const fs = seed();
    const err = thrown(() => fs.mkdirSync('/plain.txt/sub', {}));
    expect(err.code).toBe('ENOTDIR');
    expect(err.path).toBe('/plain.txt/sub');
  });

  it('rename/copy report src/dst target paths', () => {
    const fs = seed();
    const renameSrc = thrown(() => fs.renameSync('/missing.txt', '/dst.txt'));
    expect(renameSrc.code).toBe('ENOENT');
    expect(renameSrc.path).toBe('/missing.txt');
    const renameDst = thrown(() => fs.renameSync('/plain.txt', '/nodir/x.txt'));
    expect(renameDst.code).toBe('ENOENT');
    expect(renameDst.path).toBe('/nodir/x.txt');
    const renameDstThroughFile = thrown(() => fs.renameSync('/dir/keep.txt', '/plain.txt/x'));
    expect(renameDstThroughFile.code).toBe('ENOTDIR');
    expect(renameDstThroughFile.path).toBe('/plain.txt/x');
    const copySrc = thrown(() => fs.copyFileSync('/missing.txt', '/dst.txt'));
    expect(copySrc.code).toBe('ENOENT');
    expect(copySrc.path).toBe('/missing.txt');
    const copyDst = thrown(() => fs.copyFileSync('/plain.txt', '/plain.txt/x'));
    expect(copyDst.code).toBe('ENOTDIR');
    expect(copyDst.path).toBe('/plain.txt/x');
  });

  it('existsSync through a file stays a plain false (Node existsSync never throws)', () => {
    const fs = seed();
    expect(fs.existsSync('/plain.txt/x')).toBe(false);
  });
});
