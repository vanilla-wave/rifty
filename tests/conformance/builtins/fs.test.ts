/**
 * Conformance tests for `node:fs`. Each test resets the active sync mirror
 * so files written by one test don't leak into the next.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import fs, {
  existsSync,
  mkdirSync,
  promises as fsp,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => {
  resetSyncMirror();
});

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

  it('rmSync recursive removes a tree', () => {
    mkdirSync('/a/b/c', { recursive: true });
    writeFileSync('/a/b/c/x', 'x');
    rmSync('/a', { recursive: true });
    expect(existsSync('/a')).toBe(false);
  });

  it('throws ENOENT for missing files', () => {
    expect(() => readFileSync('/missing.txt')).toThrow(/ENOENT/);
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
