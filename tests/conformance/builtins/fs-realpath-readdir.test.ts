import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import {
  promises as fsp,
  lstat,
  lstatSync,
  mkdirSync,
  readdir,
  readlinkSync,
  realpath,
  realpathSync,
  stat,
  writeFileSync,
} from '../../../packages/runtime-js/src/builtins/fs.ts';

/**
 * Regression for "run real Vite": chokidar (Vite's watcher) calls
 * `util.promisify(fs.realpath)` / `fs.lstat`, and readdirp calls
 * `fs.readdir(path, {withFileTypes:true}, cb)`. The earlier loud-throw on
 * realpath/lstat aborted `vite createServer`; the 2-arg-only `readdir`
 * mis-bound the callback. The VFS has no symlinks, so `lstat ≡ stat` and
 * `realpath ≡ normalise-if-exists` are the correct semantics.
 */
afterEach(() => resetSyncMirror());

describe('node:fs realpath/lstat — no-symlink VFS semantics', () => {
  it('lstatSync is identical to stat for a file', () => {
    writeFileSync('/f.txt', 'x');
    expect(lstatSync('/f.txt').isFile()).toBe(true);
    expect(lstatSync('/f.txt').isDirectory()).toBe(false);
  });

  it('realpathSync returns the normalised absolute path of an existing entry', () => {
    mkdirSync('/a/b', { recursive: true });
    writeFileSync('/a/b/f.txt', 'x');
    expect(realpathSync('/a/b/../b/f.txt')).toBe('/a/b/f.txt');
  });

  it('realpathSync throws ENOENT for a missing path', () => {
    expect(() => realpathSync('/nope')).toThrow(/ENOENT/);
  });

  it('realpathSync and readlinkSync report ENOTDIR through a file', () => {
    writeFileSync('/plain.txt', 'x');
    for (const fn of [
      () => realpathSync('/plain.txt/deep'),
      () => readlinkSync('/plain.txt/deep'),
    ]) {
      try {
        fn();
      } catch (err) {
        expect(err).toMatchObject({ code: 'ENOTDIR' });
        continue;
      }
      throw new Error('expected ENOTDIR');
    }
  });

  it('realpathSync.native exists and resolves identically', () => {
    writeFileSync('/n.txt', 'x');
    expect(typeof realpathSync.native).toBe('function');
    expect(realpathSync.native('/n.txt')).toBe('/n.txt');
  });

  it('promises.realpath + promises.lstat resolve', async () => {
    writeFileSync('/g.txt', 'y');
    expect(await fsp.realpath('/g.txt')).toBe('/g.txt');
    expect((await fsp.lstat('/g.txt')).isFile()).toBe(true);
  });

  it('callback realpath(p, cb) resolves (the chokidar promisify path)', async () => {
    writeFileSync('/h.txt', 'z');
    const out = await new Promise<string>((res, rej) => {
      realpath('/h.txt', (e, v) => (e ? rej(e) : res(v as string)));
    });
    expect(out).toBe('/h.txt');
  });
});

describe('node:fs readdir callback — options arg', () => {
  it('readdir(p, cb) yields names', async () => {
    mkdirSync('/d', { recursive: true });
    writeFileSync('/d/a.txt', '1');
    writeFileSync('/d/b.txt', '2');
    const names = await new Promise<string[]>((res, rej) => {
      readdir('/d', (e, v) => (e ? rej(e) : res(v as string[])));
    });
    expect([...names].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('readdir(p, {withFileTypes:true}, cb) yields Dirent[] (readdirp path)', async () => {
    mkdirSync('/e/sub', { recursive: true });
    writeFileSync('/e/f.txt', '1');
    type D = { name: string; isDirectory(): boolean; isFile(): boolean };
    const ents = await new Promise<D[]>((res, rej) => {
      readdir('/e', { withFileTypes: true }, (e, v) => (e ? rej(e) : res(v as unknown as D[])));
    });
    expect(ents.find((d) => d.name === 'sub')?.isDirectory()).toBe(true);
    expect(ents.find((d) => d.name === 'f.txt')?.isFile()).toBe(true);
  });
});

describe('node:fs stat/lstat callback — options arg', () => {
  it('stat(p, {}, cb) and lstat(p, {}, cb) resolve Stats', async () => {
    writeFileSync('/s.txt', '1');
    const st = await new Promise<{ isFile(): boolean }>((res, rej) => {
      stat('/s.txt', {}, (e, v) => (e ? rej(e) : res(v as { isFile(): boolean })));
    });
    const lst = await new Promise<{ isFile(): boolean }>((res, rej) => {
      lstat('/s.txt', {}, (e, v) => (e ? rej(e) : res(v as { isFile(): boolean })));
    });
    expect(st.isFile()).toBe(true);
    expect(lst.isFile()).toBe(true);
  });

  it('bigint Stats are a loud ceiling, not a silent normal Stats object', async () => {
    writeFileSync('/bigint-stat.txt', '1');
    await expect(fsp.stat('/bigint-stat.txt', { bigint: true })).rejects.toThrow(
      /Not implemented: fs\.promises\.stat\.bigint/,
    );
  });
});
