/**
 * Conformance for the symlink-shaped APIs in `node:fs`. The VFS has no symlink
 * layer (in-memory + OPFS — no symlinks until M12), so per ADR-0050 these are
 * the CORRECT POSIX semantics for a symlink-free filesystem, not silent stubs:
 *   - `lstat ≡ stat` (lstat differs from stat ONLY on symlinks);
 *   - `realpath ≡ normalise-if-exists` (canonicalise + ENOENT on a missing path);
 *   - `readlink` throws EINVAL (non-link) / ENOENT (missing) — never a fake target.
 * The non-existent-path ENOENT throw is the line that keeps this honest. The M9
 * loud-throw contract this replaces was moved forward by the Real Vite forcing
 * consumer (chokidar/readdirp call these on the happy path).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import fs, {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from './fs.ts';
import { setProcessCwd } from './process.ts';

afterEach(() => {
  resetSyncMirror();
  setProcessCwd('/workspace'); // restore the default cwd cell after cwd tests
});

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('node:fs symlink-shaped APIs (no-symlink VFS semantics, ADR-0050)', () => {
  it('lstatSync is identical to statSync and reports no symlink', () => {
    writeFileSync('/exists.txt', 'data');
    const ls = lstatSync('/exists.txt');
    const st = statSync('/exists.txt');
    expect(ls.isFile()).toBe(st.isFile());
    expect(ls.isDirectory()).toBe(st.isDirectory());
    expect(ls.size).toBe(st.size);
    expect(ls.isSymbolicLink()).toBe(false);
  });

  it('realpathSync canonicalises an existing path (collapses ./..), not identity', () => {
    writeFileSync('/exists.txt', 'data');
    expect(realpathSync('/./a/../exists.txt')).toBe('/exists.txt');
  });

  it('realpathSync throws ENOENT for a missing path (not a silent normalise)', () => {
    expect(() => realpathSync('/missing.txt')).toThrow(/ENOENT/);
    try {
      realpathSync('/missing.txt');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('ENOENT');
    }
  });

  it('realpathSync.native aliases realpathSync', () => {
    writeFileSync('/exists.txt', 'data');
    expect(realpathSync.native('/exists.txt')).toBe(realpathSync('/exists.txt'));
  });

  it('readlinkSync keeps honest errors: EINVAL on a non-link, ENOENT on missing', () => {
    writeFileSync('/exists.txt', 'data');
    expect(() => readlinkSync('/exists.txt')).toThrow(/EINVAL/);
    expect(() => readlinkSync('/missing.txt')).toThrow(/ENOENT/);
  });
});

describe('resolvePath relative branch against a non-root cwd (#6)', () => {
  // Guards #6: dropping the outer `normalizePath` in resolvePath's relative
  // branch (joinPath already normalizes) keeps relative + dot-segment
  // resolution correct against a non-`/` cwd.
  it('resolves bare and dotted relative paths to the same file under cwd=/proj', () => {
    setProcessCwd('/proj');
    mkdirSync('/proj', { recursive: true });
    writeFileSync('a.txt', 'x'); // relative — anchors at /proj
    expect(statSync('a.txt').size).toBe(1);
    expect(statSync('./sub/../a.txt').size).toBe(1);
    expect(statSync('/proj/a.txt').size).toBe(1);
  });
});

describe('require("fs") module object exposes the stream factories', () => {
  // Regression: createReadStream/createWriteStream were named ESM exports but
  // missing from the default module object the builtin registry serves — so
  // `require('fs').createReadStream` (serve-static/send under express.static)
  // was undefined while the ESM named import worked.
  it('default fs object carries createReadStream/createWriteStream', async () => {
    const fs = (await import('./fs.ts')).default as Record<string, unknown>;
    expect(typeof fs.createReadStream).toBe('function');
    expect(typeof fs.createWriteStream).toBe('function');
  });
});

describe('fs stream classes are exposed for instanceof probes', () => {
  // send/destroy does `stream instanceof fs.ReadStream` on cleanup; an absent
  // class made that probe THROW (instanceof undefined) on every static file
  // teardown in the express demo.
  it('ReadStream/WriteStream classes exist and instanceof works', async () => {
    const fs = (await import('./fs.ts')).default as Record<string, unknown> & {
      createReadStream: (p: string) => unknown;
      ReadStream: new (...args: never[]) => unknown;
      WriteStream: new (...args: never[]) => unknown;
    };
    expect(typeof fs.ReadStream).toBe('function');
    expect(typeof fs.WriteStream).toBe('function');
    writeFileSync('/probe.txt', 'x');
    expect(fs.createReadStream('/probe.txt') instanceof fs.ReadStream).toBe(true);
  });
});

describe('node:fs fd APIs (M11 runtime-local surface)', () => {
  it('tracks fd position and supports positional read/write without moving it', () => {
    writeFileSync('/fd.txt', 'abcdef');
    const fd = openSync('/fd.txt', constants.O_RDWR);
    const positioned = Buffer.alloc(3);

    expect(readSync(fd, positioned, 0, 3, 1)).toBe(3);
    expect(positioned.toString('utf8')).toBe('bcd');
    expect(writeSync(fd, Buffer.from('XY'), 0, 2, 2)).toBe(2);
    expect(readFileSync('/fd.txt', 'utf8')).toBe('abXYef');

    const sequential = Buffer.alloc(2);
    expect(readSync(fd, sequential, 0, 2, null)).toBe(2);
    expect(sequential.toString('utf8')).toBe('ab');
    closeSync(fd);
  });

  it('treats position -1 as "current position" like Node', () => {
    writeFileSync('/minus.txt', 'abcdef');
    const fd = openSync('/minus.txt', constants.O_RDWR);
    const buf = Buffer.alloc(2);

    expect(readSync(fd, buf, 0, 2, -1)).toBe(2);
    expect(buf.toString('utf8')).toBe('ab');
    expect(readSync(fd, buf, 0, 2, -1)).toBe(2);
    expect(buf.toString('utf8')).toBe('cd'); // position advanced
    expect(writeSync(fd, Buffer.from('ZZ'), 0, 2, -1)).toBe(2);
    expect(readFileSync('/minus.txt', 'utf8')).toBe('abcdZZ');
    closeSync(fd);
  });

  it('read(fd, cb) and read(fd, options, cb) invoke the callback (Node short forms)', async () => {
    writeFileSync('/short.txt', 'hello');
    const fd = openSync('/short.txt', 'r');

    const first = await new Promise<{ bytesRead: number; text: string }>((resolve, reject) => {
      fs.read(fd, (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => {
        if (err) return reject(err);
        resolve({
          bytesRead: bytesRead ?? 0,
          text: Buffer.from(buffer ?? new Uint8Array())
            .subarray(0, bytesRead)
            .toString('utf8'),
        });
      });
    });
    expect(first).toEqual({ bytesRead: 5, text: 'hello' });

    const second = await new Promise<{ bytesRead: number; text: string }>((resolve, reject) => {
      fs.read(
        fd,
        { position: 1, length: 3, buffer: Buffer.alloc(3) },
        (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => {
          if (err) return reject(err);
          resolve({
            bytesRead: bytesRead ?? 0,
            text: Buffer.from(buffer ?? new Uint8Array()).toString('utf8'),
          });
        },
      );
    });
    expect(second).toEqual({ bytesRead: 3, text: 'ell' });
    closeSync(fd);
  });

  it('honors the flag option in readFile/writeFile/appendFile (was: silently ignored)', () => {
    writeFileSync('/flagged.txt', 'seed');
    expect(codeOf(() => writeFileSync('/flagged.txt', 'x', { flag: 'wx' }))).toBe('EEXIST');
    expect(readFileSync('/flagged.txt', 'utf8')).toBe('seed');

    writeFileSync('/flagged.txt', '+more', { flag: 'a' });
    expect(readFileSync('/flagged.txt', 'utf8')).toBe('seed+more');

    expect(codeOf(() => readFileSync('/missing-r.txt', { flag: 'r' }))).toBe('ENOENT');
    expect(readFileSync('/missing-aplus.txt', { encoding: 'utf8', flag: 'a+' })).toBe('');
    expect(statSync('/missing-aplus.txt').isFile()).toBe(true);
  });

  it('ftruncateSync shrinks and zero-extends through an open fd', () => {
    writeFileSync('/truncate.txt', 'abcdef');
    const fd = openSync('/truncate.txt', 'r+');

    ftruncateSync(fd, 3);
    expect(readFileSync('/truncate.txt', 'utf8')).toBe('abc');
    ftruncateSync(fd, 5);
    expect(Array.from(readFileSync('/truncate.txt') as Uint8Array)).toEqual([97, 98, 99, 0, 0]);
    expect(fstatSync(fd).size).toBe(5);
    closeSync(fd);
  });

  it('ftruncateSync preserves the current fd position', () => {
    writeFileSync('/cursor.txt', 'abcdef');
    const fd = openSync('/cursor.txt', 'r+');
    const consumed = Buffer.alloc(6);
    expect(readSync(fd, consumed, 0, 6, null)).toBe(6);

    ftruncateSync(fd, 2);
    expect(writeSync(fd, 'Z')).toBe(1);

    expect(Array.from(readFileSync('/cursor.txt') as Uint8Array)).toEqual([97, 98, 0, 0, 0, 0, 90]);
    closeSync(fd);
  });

  it('honors create/exclusive/truncate/append/open-directory flags', () => {
    const created = openSync('/created.txt', constants.O_WRONLY | constants.O_CREAT);
    expect(writeSync(created, 'a')).toBe(1);
    closeSync(created);
    expect(readFileSync('/created.txt', 'utf8')).toBe('a');

    expect(
      codeOf(() =>
        openSync('/created.txt', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL),
      ),
    ).toBe('EEXIST');

    const append = openSync('/created.txt', constants.O_WRONLY | constants.O_APPEND);
    expect(writeSync(append, Buffer.from('b'), 0, 1, 0)).toBe(1);
    closeSync(append);
    expect(readFileSync('/created.txt', 'utf8')).toBe('ab');

    const truncated = openSync('/created.txt', constants.O_WRONLY | constants.O_TRUNC);
    closeSync(truncated);
    expect(readFileSync('/created.txt', 'utf8')).toBe('');
    writeFileSync('/created.txt', 'ab');

    mkdirSync('/dir', { recursive: true });
    const dirFd = openSync('/dir', constants.O_RDONLY | constants.O_DIRECTORY);
    expect(fstatSync(dirFd).isDirectory()).toBe(true);
    closeSync(dirFd);
    expect(codeOf(() => openSync('/created.txt', constants.O_RDONLY | constants.O_DIRECTORY))).toBe(
      'ENOTDIR',
    );
  });

  it('throws loudly for unsupported numeric open flag bits', () => {
    expect(codeOf(() => openSync('/x', constants.O_WRONLY | 0x20000000))).toBe('EINVAL');
  });
});

describe('node:fs directory and temp APIs (M11 runtime-local surface)', () => {
  it('mkdtempSync creates unique directories under the exact prefix', () => {
    mkdirSync('/tmp', { recursive: true });
    const first = mkdtempSync('/tmp/rifty-');
    const second = mkdtempSync('/tmp/rifty-');

    expect(first.startsWith('/tmp/rifty-')).toBe(true);
    expect(second.startsWith('/tmp/rifty-')).toBe(true);
    expect(first).not.toBe(second);
    expect(statSync(first).isDirectory()).toBe(true);
    expect(statSync(second).isDirectory()).toBe(true);
  });

  it('opendirSync snapshots entries and supports readSync plus async iteration', async () => {
    mkdirSync('/snap', { recursive: true });
    writeFileSync('/snap/a.txt', 'a');
    writeFileSync('/snap/b.txt', 'b');

    const dir = opendirSync('/snap');
    writeFileSync('/snap/c.txt', 'c');
    expect(dir.readSync()?.name).toBe('a.txt');
    expect(dir.readSync()?.name).toBe('b.txt');
    expect(dir.readSync()).toBeNull();
    dir.closeSync();

    const iterated: string[] = [];
    for await (const dirent of opendirSync('/snap')) {
      iterated.push(dirent.name);
    }
    expect(iterated).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('Dir read/close support callback overloads and closed-dir errors', async () => {
    mkdirSync('/callbacks', { recursive: true });
    writeFileSync('/callbacks/a.txt', 'a');

    const dir = opendirSync('/callbacks');
    const first = await new Promise<string | undefined>((resolve, reject) => {
      (
        dir as unknown as { read(cb: (err: Error | null, dirent?: { name: string }) => void): void }
      ).read((err, dirent) => (err ? reject(err) : resolve(dirent?.name)));
      setTimeout(() => resolve('not-called'), 0);
    });
    expect(first).toBe('a.txt');

    const closeResult = await new Promise<string>((resolve, reject) => {
      (dir as unknown as { close(cb: (err: Error | null) => void): void }).close((err) =>
        err ? reject(err) : resolve('closed'),
      );
      setTimeout(() => resolve('not-called'), 0);
    });
    expect(closeResult).toBe('closed');
    expect(codeOf(() => dir.closeSync())).toBe('ERR_DIR_CLOSED');
    expect(() => dir.readSync()).toThrow(/ERR_DIR_CLOSED/);
  });

  it('truncateSync and promises.truncate shrink and zero-extend files', async () => {
    writeFileSync('/path-truncate.txt', 'abcdef');
    truncateSync('/path-truncate.txt', 2);
    expect(readFileSync('/path-truncate.txt', 'utf8')).toBe('ab');
    await fs.promises.truncate('/path-truncate.txt', 4);
    expect(Array.from(readFileSync('/path-truncate.txt') as Uint8Array)).toEqual([97, 98, 0, 0]);
  });

  it('copyFileSync honors COPYFILE_EXCL', () => {
    writeFileSync('/src.txt', 'source');
    copyFileSync('/src.txt', '/dst.txt', constants.COPYFILE_EXCL);
    expect(readFileSync('/dst.txt', 'utf8')).toBe('source');
    expect(codeOf(() => copyFileSync('/src.txt', '/dst.txt', constants.COPYFILE_EXCL))).toBe(
      'EEXIST',
    );
  });
});
