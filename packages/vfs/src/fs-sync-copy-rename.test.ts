/**
 * `FsSync.copyFileSync` / `cpSync` / `renameSync` over the memory backend
 * (ADR-0090). Parity tier: node-fs-reuse — these map 1:1 onto
 * `node:fs.{copyFileSync,cpSync,renameSync}` semantics; the cross-engine
 * Node-vs-rifty parity case lives under the parity runner (U32). Here we pin
 * the contract directly against `MemoryFsSync`.
 */
import { describe, expect, it } from 'vitest';
import type { VfsError } from './errors.ts';
import { createMemoryFs } from './sync-mirror.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function seed() {
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/dir', { recursive: true });
  fsSync.writeFileSync('/dir/a.txt', enc.encode('alpha'));
  return fsSync;
}

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return (err as VfsError).code;
  }
  throw new Error('expected throw, got none');
}

describe('FsSync.renameSync (ADR-0090)', () => {
  it('same-dir rename PRESERVES mtime (not restamped like copy+write+rm)', () => {
    const fs = seed();
    fs.utimes('/dir/a.txt', 123_000, 123_000);
    const before = fs.statSync('/dir/a.txt').mtime;
    fs.renameSync('/dir/a.txt', '/dir/b.txt');
    expect(fs.existsSync('/dir/a.txt')).toBe(false);
    expect(fs.existsSync('/dir/b.txt')).toBe(true);
    expect(fs.statSync('/dir/b.txt').mtime).toBe(before); // the core ADR-0090 win
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha');
  });

  it('cross-dir rename moves the entry between parents (old excludes, new includes)', () => {
    const fs = seed();
    fs.mkdirSync('/other', { recursive: true });
    fs.renameSync('/dir/a.txt', '/other/a.txt');
    expect(fs.readdirSync('/dir').map((d) => d.name)).not.toContain('a.txt');
    expect(fs.readdirSync('/other').map((d) => d.name)).toContain('a.txt');
  });

  it('invalidates cached dirents for both source and destination parents', () => {
    const fs = seed();
    fs.mkdirSync('/other', { recursive: true });
    expect(fs.readdirSync('/dir').map((d) => d.name)).toEqual(['a.txt']);
    expect(fs.readdirSync('/other').map((d) => d.name)).toEqual([]);

    fs.renameSync('/dir/a.txt', '/other/a.txt');

    expect(fs.readdirSync('/dir').map((d) => d.name)).toEqual([]);
    expect(fs.readdirSync('/other').map((d) => d.name)).toEqual(['a.txt']);
  });

  it('renames a whole directory subtree cross-dir, preserving descendants', () => {
    const fs = seed();
    fs.mkdirSync('/dir/sub', { recursive: true });
    fs.writeFileSync('/dir/sub/leaf.txt', enc.encode('leaf'));
    fs.mkdirSync('/parent', { recursive: true });
    fs.renameSync('/dir', '/parent/moved');
    expect(fs.existsSync('/dir')).toBe(false);
    expect(dec.decode(fs.readFileBytesSync('/parent/moved/a.txt'))).toBe('alpha');
    expect(dec.decode(fs.readFileBytesSync('/parent/moved/sub/leaf.txt'))).toBe('leaf');
  });

  it('dst-absent move; src===dst is a no-op', () => {
    const fs = seed();
    fs.renameSync('/dir/a.txt', '/dir/a.txt'); // no-op, must not throw or lose the file
    expect(dec.decode(fs.readFileBytesSync('/dir/a.txt'))).toBe('alpha');
  });

  it('rename file onto an existing file overwrites it', () => {
    const fs = seed();
    fs.writeFileSync('/dir/b.txt', enc.encode('beta'));
    fs.renameSync('/dir/a.txt', '/dir/b.txt');
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha');
    expect(fs.existsSync('/dir/a.txt')).toBe(false);
  });

  it('rename dir onto a NON-EMPTY dir throws ENOTEMPTY (no silent clobber)', () => {
    const fs = seed();
    fs.mkdirSync('/dst', { recursive: true });
    fs.writeFileSync('/dst/occupied.txt', enc.encode('x'));
    expect(codeOf(() => fs.renameSync('/dir', '/dst'))).toBe('ENOTEMPTY');
  });

  it('rename dir onto an EMPTY dir replaces it', () => {
    const fs = seed();
    fs.mkdirSync('/dst', { recursive: true });
    fs.renameSync('/dir', '/dst');
    expect(dec.decode(fs.readFileBytesSync('/dst/a.txt'))).toBe('alpha');
  });

  it('rename file onto a dir throws EISDIR; dir onto a file throws ENOTDIR', () => {
    const fs = seed();
    fs.mkdirSync('/asdir', { recursive: true });
    fs.writeFileSync('/target.txt', enc.encode('t')); // dst file OUTSIDE /dir (else into-subtree EINVAL)
    expect(codeOf(() => fs.renameSync('/dir/a.txt', '/asdir'))).toBe('EISDIR');
    expect(codeOf(() => fs.renameSync('/dir', '/target.txt'))).toBe('ENOTDIR');
  });

  it('rename a dir into its OWN subtree throws EINVAL (no corruption)', () => {
    const fs = seed();
    expect(codeOf(() => fs.renameSync('/dir', '/dir/sub'))).toBe('EINVAL');
  });

  it('rename of a missing src throws ENOENT', () => {
    const fs = seed();
    expect(codeOf(() => fs.renameSync('/dir/missing', '/dir/x'))).toBe('ENOENT');
  });
});

describe('FsSync.copyFileSync (ADR-0090)', () => {
  it('copies bytes and overwrites an existing dst (Node default, no EXCL)', () => {
    const fs = seed();
    fs.writeFileSync('/dir/b.txt', enc.encode('old'));
    fs.copyFileSync('/dir/a.txt', '/dir/b.txt');
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha');
    expect(fs.existsSync('/dir/a.txt')).toBe(true); // copy keeps the source
  });

  it('dst mtime is NOW, not the source mtime (a copy is a new file ≠ rename)', () => {
    const fs = seed();
    fs.utimes('/dir/a.txt', 1000, 1000);
    fs.copyFileSync('/dir/a.txt', '/dir/b.txt');
    expect(fs.statSync('/dir/b.txt').mtime).toBeGreaterThan(1000);
  });

  it('EISDIR when src is a directory (single-file copy never recurses)', () => {
    const fs = seed();
    expect(codeOf(() => fs.copyFileSync('/dir', '/x'))).toBe('EISDIR');
  });

  it('EISDIR when dst is an existing directory', () => {
    const fs = seed();
    fs.mkdirSync('/dst', { recursive: true });
    expect(codeOf(() => fs.copyFileSync('/dir/a.txt', '/dst'))).toBe('EISDIR');
  });

  it('ENOENT when src missing or dst parent missing', () => {
    const fs = seed();
    expect(codeOf(() => fs.copyFileSync('/dir/missing', '/dir/x'))).toBe('ENOENT');
    expect(codeOf(() => fs.copyFileSync('/dir/a.txt', '/nope/x'))).toBe('ENOENT');
  });
});

describe('FsSync.cpSync (ADR-0090)', () => {
  it('cpSync of a dir WITHOUT recursive throws EISDIR (Node parity)', () => {
    const fs = seed();
    expect(codeOf(() => fs.cpSync('/dir', '/copy'))).toBe('EISDIR');
  });

  it('cpSync of a file behaves like copyFileSync', () => {
    const fs = seed();
    fs.cpSync('/dir/a.txt', '/dir/b.txt');
    expect(dec.decode(fs.readFileBytesSync('/dir/b.txt'))).toBe('alpha');
  });

  it('cpSync recursive deep-copies a tree', () => {
    const fs = seed();
    fs.mkdirSync('/dir/sub', { recursive: true });
    fs.writeFileSync('/dir/sub/leaf.txt', enc.encode('leaf'));
    fs.cpSync('/dir', '/copy', { recursive: true });
    expect(dec.decode(fs.readFileBytesSync('/copy/a.txt'))).toBe('alpha');
    expect(dec.decode(fs.readFileBytesSync('/copy/sub/leaf.txt'))).toBe('leaf');
    // source untouched
    expect(fs.existsSync('/dir/a.txt')).toBe(true);
  });

  it('cpSync recursive is FAIL-FAST: first error propagates, pre-failure entries remain (no rollback)', () => {
    const fs = seed();
    fs.writeFileSync('/dir/b.txt', enc.encode('beta')); // children sorted: a.txt, b.txt
    fs.mkdirSync('/copy', { recursive: true });
    fs.mkdirSync('/copy/b.txt', { recursive: true }); // b.txt as a DIR forces EISDIR on the 2nd child
    expect(codeOf(() => fs.cpSync('/dir', '/copy', { recursive: true }))).toBe('EISDIR');
    expect(fs.existsSync('/copy/a.txt')).toBe(true); // copied before the throw — not rolled back
  });

  it('cpSync recursive into the SOURCE itself (a → a) throws EINVAL, not a stack overflow', () => {
    const fs = seed(); // /dir is a dir with /dir/a.txt
    expect(codeOf(() => fs.cpSync('/dir', '/dir', { recursive: true }))).toBe('EINVAL');
  });

  it('cpSync recursive into the source SUBTREE (a → a/b) throws EINVAL, not a stack overflow', () => {
    const fs = seed();
    expect(codeOf(() => fs.cpSync('/dir', '/dir/sub', { recursive: true }))).toBe('EINVAL');
  });
});
