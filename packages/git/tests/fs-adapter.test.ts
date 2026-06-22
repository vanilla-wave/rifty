/**
 * VFS→isomorphic-git fs adapter: backed by a real {@link MemoryVfs} (no mocks).
 * Covers round-trips (bytes + utf8), readdir name-listing, POSIX stat
 * synthesis (field + method forms), ENOENT on missing paths, and the
 * symlink-less `readlink` loud-throw (VFS has no symlink layer — ADR-0050).
 */
import { MemoryVfs } from '@riftydev/vfs';
import { beforeEach, describe, expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';

describe('vfsToGitFs', () => {
  let vfs: MemoryVfs;
  let fs: ReturnType<typeof vfsToGitFs>['promises'];

  beforeEach(async () => {
    vfs = new MemoryVfs();
    // Recursive setup via the VFS directly — the adapter's mkdir is non-recursive.
    await vfs.mkdir('/repo', { recursive: true });
    fs = vfsToGitFs(vfs).promises;
  });

  it('round-trips bytes via writeFile/readFile', async () => {
    const bytes = new TextEncoder().encode('hi');
    await fs.writeFile('/repo/a.txt', bytes);
    const out = await fs.readFile('/repo/a.txt');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(out as Uint8Array)).toBe('hi');
  });

  it('readFile with { encoding: utf8 } returns a string', async () => {
    await fs.writeFile('/repo/b.txt', 'héllo');
    const out = await fs.readFile('/repo/b.txt', { encoding: 'utf8' });
    expect(typeof out).toBe('string');
    expect(out).toBe('héllo');
  });

  it('readdir returns sorted string[] names', async () => {
    await fs.writeFile('/repo/two', 'x');
    await fs.writeFile('/repo/one', 'y');
    const names = await fs.readdir('/repo');
    expect(Array.isArray(names)).toBe(true);
    expect([...names].sort()).toEqual(['one', 'two']);
    for (const n of names) expect(typeof n).toBe('string');
  });

  it('synthesises POSIX stat fields + method forms for a file', async () => {
    await fs.writeFile('/repo/f.txt', 'abc');
    const s = await fs.stat('/repo/f.txt');
    expect(s.type).toBe('file');
    expect(s.isFile()).toBe(true);
    expect(s.isDirectory()).toBe(false);
    expect(s.isSymbolicLink()).toBe(false);
    expect(s.mode).toBe(0o100644);
    expect(s.size).toBe(3);
    expect(typeof s.ino).toBe('number');
    expect(typeof s.mtimeMs).toBe('number');
    expect(s.ctimeMs).toBe(s.mtimeMs);
    expect(s.uid).toBe(0);
    expect(s.gid).toBe(0);
    expect(s.dev).toBe(0);
  });

  it('synthesises POSIX stat fields + method forms for a directory', async () => {
    const s = await fs.stat('/repo');
    expect(s.type).toBe('dir');
    expect(s.isDirectory()).toBe(true);
    expect(s.isFile()).toBe(false);
    expect(s.mode).toBe(0o040755);
  });

  it('gives stable ino across repeated stats of the same path', async () => {
    await fs.writeFile('/repo/g.txt', 'z');
    const a = await fs.stat('/repo/g.txt');
    const b = await fs.stat('/repo/g.txt');
    expect(a.ino).toBe(b.ino);
  });

  it('lstat mirrors stat (no symlink layer)', async () => {
    await fs.writeFile('/repo/h.txt', 'zz');
    const s = await fs.lstat('/repo/h.txt');
    expect(s.isFile()).toBe(true);
    expect(s.isSymbolicLink()).toBe(false);
    expect(s.size).toBe(2);
  });

  it('rejects stat on a missing path with code ENOENT', async () => {
    await expect(fs.stat('/repo/missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects readFile on a missing path with code ENOENT', async () => {
    await expect(fs.readFile('/repo/missing')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects readdir on a missing path with code ENOENT', async () => {
    await expect(fs.readdir('/repo/nope')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects readlink with code ENOENT (no symlink layer)', async () => {
    await expect(fs.readlink('/repo/whatever')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
