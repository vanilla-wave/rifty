/**
 * Conformance tests for `node:fs`. Each test resets the active sync mirror
 * so files written by one test don't leak into the next.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import fs, {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  promises as fsp,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => {
  resetSyncMirror();
});

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function errorOf(fn: () => void): NodeJS.ErrnoException & { dest?: string } {
  try {
    fn();
  } catch (err) {
    return err as NodeJS.ErrnoException & { dest?: string };
  }
  throw new Error('expected throw');
}

describe('node:fs sync API', () => {
  it('writeFileSync + readFileSync (utf8)', () => {
    writeFileSync('/hello.txt', 'world');
    expect(readFileSync('/hello.txt', 'utf8')).toBe('world');
  });

  it('readFileSync without encoding returns Buffer-like Uint8Array', () => {
    writeFileSync('/bin', new Uint8Array([1, 2, 3]));
    const data = readFileSync('/bin');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('mkdirSync recursive creates parents', () => {
    mkdirSync('/a/b/c', { recursive: true });
    expect(statSync('/a/b/c').isDirectory()).toBe(true);
  });

  it('readdirSync lists names sorted', () => {
    mkdirSync('/root', { recursive: true });
    writeFileSync('/root/b.txt', 'b');
    writeFileSync('/root/a.txt', 'a');
    expect(readdirSync('/root')).toEqual(['a.txt', 'b.txt']);
  });

  it('readdirSync withFileTypes returns Dirent[]', () => {
    mkdirSync('/r', { recursive: true });
    writeFileSync('/r/a', 'a');
    const out = readdirSync('/r', { withFileTypes: true }) as { isFile(): boolean }[];
    expect(out[0]?.isFile()).toBe(true);
  });

  it('existsSync / statSync', () => {
    writeFileSync('/x.txt', 'hi');
    expect(existsSync('/x.txt')).toBe(true);
    const st = statSync('/x.txt');
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
    expect(st.size).toBe(2);
  });

  it('statSync throwIfNoEntry:false suppresses ENOENT and ENOTDIR probes', () => {
    writeFileSync('/plain.txt', 'x');
    expect(statSync('/missing', { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync('/plain.txt/deep', { throwIfNoEntry: false })).toBeUndefined();
  });

  it('rmSync recursive removes a tree', () => {
    mkdirSync('/a/b/c', { recursive: true });
    writeFileSync('/a/b/c/x', 'x');
    rmSync('/a', { recursive: true });
    expect(existsSync('/a')).toBe(false);
  });

  it('throws ENOENT for missing files', () => {
    expect(() => readFileSync('/missing.txt')).toThrow(/ENOENT/);
  });

  it('appendFileSync honors non-append open flags', () => {
    expect(codeOf(() => fs.appendFileSync('/missing-rplus.txt', 'X', { flag: 'r+' }))).toBe(
      'ENOENT',
    );
    writeFileSync('/existing.txt', 'abc');
    fs.appendFileSync('/existing.txt', 'X', { flag: 'r+' });
    expect(readFileSync('/existing.txt', 'utf8')).toBe('Xbc');

    writeFileSync('/existing.txt', 'abc');
    fs.appendFileSync('/existing.txt', 'X', { flag: 'a' });
    expect(readFileSync('/existing.txt', 'utf8')).toBe('abcX');

    writeFileSync('/existing.txt', 'abc');
    fs.appendFileSync('/existing.txt', 'X', { flag: 'w' });
    expect(readFileSync('/existing.txt', 'utf8')).toBe('X');
  });

  it('copyFileSync COPYFILE_EXCL reports a missing source before existing destination', () => {
    writeFileSync('/dst.txt', 'd');
    const err = errorOf(() => copyFileSync('/missing.txt', '/dst.txt', constants.COPYFILE_EXCL));
    expect(err).toMatchObject({
      code: 'ENOENT',
      syscall: 'copyfile',
      path: '/missing.txt',
      dest: '/dst.txt',
    });
  });

  it('cpSync reports destination traversal failures as Node-shaped lstat errors', () => {
    mkdirSync('/dir', { recursive: true });
    writeFileSync('/dir/keep.txt', 'k');
    writeFileSync('/plain.txt', 'x');

    const fast = errorOf(() => fs.cpSync('/dir', '/plain.txt/out', { recursive: true }));
    expect(fast).toMatchObject({ code: 'ENOTDIR', syscall: 'lstat', path: '/plain.txt/out' });

    const edge = errorOf(() =>
      fs.cpSync('/dir', '/plain.txt/out', { recursive: true, force: false }),
    );
    expect(edge).toMatchObject({ code: 'ENOTDIR', syscall: 'lstat', path: '/plain.txt/out' });
  });
});

describe('node:fs promises API', () => {
  it('writeFile / readFile roundtrip', async () => {
    await fsp.writeFile('/hello.txt', 'world');
    expect(await fsp.readFile('/hello.txt', 'utf8')).toBe('world');
  });

  it('appendFile concatenates', async () => {
    await fsp.writeFile('/log', 'a');
    await fsp.appendFile('/log', 'b');
    expect(await fsp.readFile('/log', 'utf8')).toBe('ab');
  });

  it('readdir returns names by default; Dirent[] with withFileTypes', async () => {
    await fsp.mkdir('/d', { recursive: true });
    await fsp.writeFile('/d/x', '');
    expect(await fsp.readdir('/d')).toEqual(['x']);
    const ents = (await fsp.readdir('/d', { withFileTypes: true })) as unknown as {
      name: string;
      isFile(): boolean;
    }[];
    expect(ents[0]?.isFile()).toBe(true);
  });

  it('copyFile + rename', async () => {
    await fsp.writeFile('/src', 'data');
    await fsp.copyFile('/src', '/dst');
    expect(await fsp.readFile('/dst', 'utf8')).toBe('data');
    await fsp.rename('/dst', '/dst2');
    expect(await fsp.readFile('/dst2', 'utf8')).toBe('data');
    expect(
      await (async () =>
        fsp.access('/dst').then(
          () => true,
          () => false,
        ))(),
    ).toBe(false);
  });

  it('rm recursive', async () => {
    await fsp.mkdir('/r', { recursive: true });
    await fsp.writeFile('/r/a', 'a');
    await fsp.rm('/r', { recursive: true });
    expect(
      await (async () =>
        fsp.access('/r').then(
          () => true,
          () => false,
        ))(),
    ).toBe(false);
  });
});

describe('node:fs callback API', () => {
  it('readFile callback', async () => {
    writeFileSync('/cb.txt', 'cb');
    const result = await new Promise<string>((resolve, reject) =>
      fs.readFile('/cb.txt', 'utf8', (err, v) => (err ? reject(err) : resolve(v as string))),
    );
    expect(result).toBe('cb');
  });

  it('writeFile callback', async () => {
    await new Promise<void>((resolve, reject) =>
      fs.writeFile('/cbw.txt', 'value', (err) => (err ? reject(err) : resolve())),
    );
    expect(readFileSync('/cbw.txt', 'utf8')).toBe('value');
  });
});

describe('node:fs fd API', () => {
  it('supports positional and sequential reads/writes on fd state', () => {
    writeFileSync('/fd.txt', 'abcdef');
    const fd = openSync('/fd.txt', constants.O_RDWR);
    const buf = Buffer.alloc(2);

    expect(readSync(fd, buf, 0, 2, 2)).toBe(2);
    expect(buf.toString('utf8')).toBe('cd');
    expect(writeSync(fd, Buffer.from('Z'), 0, 1, null)).toBe(1);
    expect(writeSync(fd, Buffer.from('!'), 0, 1, 5)).toBe(1);
    expect(readFileSync('/fd.txt', 'utf8')).toBe('Zbcde!');
    closeSync(fd);
  });

  it('ftruncateSync and truncateSync resize files with zero fill', () => {
    writeFileSync('/resize.txt', 'abcd');
    const fd = openSync('/resize.txt', 'r+');

    ftruncateSync(fd, 2);
    expect(readFileSync('/resize.txt', 'utf8')).toBe('ab');
    truncateSync('/resize.txt', 4);
    expect(Array.from(readFileSync('/resize.txt') as Uint8Array)).toEqual([97, 98, 0, 0]);
    expect(fstatSync(fd).size).toBe(4);
    closeSync(fd);
  });

  it('exposes the faithful Linux-ABI constant set and rejects only garbage open flags (ADR-0153)', () => {
    // ADR-0153: fs.constants now carries the real Node Linux-ABI values; the behavioral gap
    // lives at the syscall, not by omitting the constant. Linux-ABI excludes macOS-only O_SYMLINK.
    expect(constants).toMatchObject({
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_RDWR: 2,
      O_CREAT: 64,
      O_EXCL: 128,
      O_TRUNC: 512,
      O_APPEND: 1024,
      O_DIRECTORY: 65536,
      O_SYNC: 1052672,
      O_DSYNC: 4096,
      O_NONBLOCK: 2048,
      O_NOFOLLOW: 131072,
      S_IFMT: 61440,
      S_IFDIR: 16384,
      S_IFREG: 32768,
      COPYFILE_EXCL: 1,
      COPYFILE_FICLONE: 2,
      COPYFILE_FICLONE_FORCE: 4,
    });
    expect('O_SYMLINK' in constants).toBe(false); // macOS-only — rifty is Linux-ABI
    // A bit that maps to no real flag is still an invalid argument.
    expect(codeOf(() => openSync('/bad.txt', constants.O_WRONLY | 0x40000000))).toBe('EINVAL');
  });

  it('open: durability flags are a loud gap; inert flags are accepted no-ops (ADR-0153)', () => {
    writeFileSync('/flagged.txt', 'hi');
    // O_SYNC/O_DSYNC durability can't be honored (async OPFS flush) → loud at the syscall.
    expect(() => openSync('/flagged.txt', constants.O_SYNC)).toThrow('fs.openSync.O_SYNC');
    expect(() => openSync('/flagged.txt', constants.O_DSYNC)).toThrow('fs.openSync.O_SYNC');
    // Inert-on-a-regular-VFS-file flags open successfully, matching Node.
    const fd = openSync('/flagged.txt', constants.O_NONBLOCK | constants.O_NOFOLLOW);
    closeSync(fd);
  });

  it('copyFile: FICLONE degrades to a plain copy; FICLONE_FORCE is a loud gap (ADR-0153)', () => {
    writeFileSync('/cf-src.txt', 'payload');
    copyFileSync('/cf-src.txt', '/cf-ficlone.txt', constants.COPYFILE_FICLONE);
    expect(readFileSync('/cf-ficlone.txt', 'utf8')).toBe('payload');
    expect(() =>
      copyFileSync('/cf-src.txt', '/cf-force.txt', constants.COPYFILE_FICLONE_FORCE),
    ).toThrow('COPYFILE_FICLONE_FORCE');
  });
});

describe('node:fs M11 directory/temp APIs', () => {
  it('mkdtempSync and promises.mkdtemp create unique prefixed directories', async () => {
    mkdirSync('/tmp', { recursive: true });

    const first = mkdtempSync('/tmp/rifty-');
    const second = await fsp.mkdtemp('/tmp/rifty-');

    expect(first).toMatch(/^\/tmp\/rifty-/);
    expect(second).toMatch(/^\/tmp\/rifty-/);
    expect(first).not.toBe(second);
    expect(statSync(first).isDirectory()).toBe(true);
    expect(statSync(second).isDirectory()).toBe(true);
  });

  it('opendir snapshots entries and supports async iteration', async () => {
    mkdirSync('/dir', { recursive: true });
    writeFileSync('/dir/a', 'a');
    writeFileSync('/dir/b', 'b');

    const opened = opendirSync('/dir');
    writeFileSync('/dir/c', 'c');
    expect(opened.readSync()?.name).toBe('a');
    expect(opened.readSync()?.name).toBe('b');
    expect(opened.readSync()).toBeNull();
    opened.closeSync();

    const asyncNames: string[] = [];
    for await (const dirent of await fsp.opendir('/dir')) {
      asyncNames.push(dirent.name);
    }
    expect(asyncNames).toEqual(['a', 'b', 'c']);
  });
});

// Remove-family kind gates (review 2026-07-05 handoff r3): the generic VFS
// rmSync happily removes empty dirs; each Node entry point enforces its own
// target-kind contract at the fs layer (sibling of the rmdirSync ENOTDIR gate).
describe('unlinkSync / rmSync directory targets', () => {
  it('unlinkSync on a directory throws EISDIR and never deletes it', () => {
    mkdirSync('/undel');
    // Errno persona: Linux EISDIR (FS_ERRNO's Linux ABI + the WASI layer's
    // E_ISDIR choice); darwin Node reports EPERM here — host-divergent, so
    // this is pinned in conformance rather than the parity case.
    let err: NodeJS.ErrnoException | undefined;
    try {
      fs.unlinkSync('/undel');
    } catch (e) {
      err = e as NodeJS.ErrnoException;
    }
    expect(err?.code).toBe('EISDIR');
    expect(err?.syscall).toBe('unlink');
    expect(err?.path).toBe('/undel');
    expect(existsSync('/undel')).toBe(true);
  });

  it('rmSync on a directory without recursive throws ERR_FS_EISDIR and keeps the tree', () => {
    mkdirSync('/keepdir');
    writeFileSync('/keepdir/f.txt', 'x');
    let err: (NodeJS.ErrnoException & { name?: string }) | undefined;
    try {
      rmSync('/keepdir');
    } catch (e) {
      err = e as NodeJS.ErrnoException;
    }
    expect(err?.code).toBe('ERR_FS_EISDIR');
    expect(err?.errno).toBe(21);
    expect(err?.syscall).toBe('rm');
    expect(err?.name).toBe('SystemError');
    expect(err?.message).toBe('Path is a directory: rm returned EISDIR (is a directory) /keepdir');
    expect(existsSync('/keepdir/f.txt')).toBe(true);
    rmSync('/keepdir', { recursive: true });
    expect(existsSync('/keepdir')).toBe(false);
  });
});
