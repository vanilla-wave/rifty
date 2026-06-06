import { describe, expect, it } from 'vitest';
import {
  basename,
  basenameNormalized,
  dirname,
  dirnameNormalized,
  extname,
  joinPath,
  normalizePath,
  segments,
} from './path.ts';

describe('vfs/path', () => {
  it('normalizePath collapses . and ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c');
    expect(normalizePath('/a//b///c')).toBe('/a/b/c');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  // #10 (perf audit 2026-06-05): the already-normalized fast-path must be
  // byte-identical to the slow path across the full edge set — both the
  // fast-path hits (returned unchanged) and the slow-path collapses. Locking
  // every `expected` so an accidental "both return the same wrong string"
  // can't hide a regression.
  it('normalizePath fast-path is byte-identical to the slow path (#10)', () => {
    // Fast-path hits — already-normalized absolute paths (incl. dotted NAMES,
    // which are not `.`/`..` segments and must pass through untouched).
    expect(normalizePath('/a')).toBe('/a');
    expect(normalizePath('/a/b')).toBe('/a/b');
    expect(normalizePath('/a/b/c.txt')).toBe('/a/b/c.txt');
    expect(normalizePath('/foo.bar/baz')).toBe('/foo.bar/baz');
    expect(normalizePath('/...')).toBe('/...');
    expect(normalizePath('/..a')).toBe('/..a');
    expect(normalizePath('/a/..b')).toBe('/a/..b');
    expect(normalizePath('/a/b..c')).toBe('/a/b..c');
    // Slow-path inputs — must still collapse exactly as before.
    expect(normalizePath('/a/..')).toBe('/');
    expect(normalizePath('/a/.')).toBe('/a');
    expect(normalizePath('/a//b')).toBe('/a/b');
    expect(normalizePath('/.')).toBe('/');
    expect(normalizePath('/..')).toBe('/');
    expect(normalizePath('/a/./b')).toBe('/a/b');
    expect(normalizePath('/a/../b')).toBe('/b');
    expect(normalizePath('/a/b/')).toBe('/a/b');
    // Relative inputs deliberately bypass the fast path (no leading '/').
    expect(normalizePath('a/b')).toBe('a/b');
    expect(normalizePath('.')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  it('dirnameNormalized === dirname on already-normalized inputs (#10)', () => {
    for (const x of ['/a/b/c', '/a', '/', '/a/b/c.txt']) {
      expect(dirnameNormalized(x)).toBe(dirname(x));
    }
    expect(dirnameNormalized('/a/b/c')).toBe('/a/b');
    expect(dirnameNormalized('/a')).toBe('/');
    expect(dirnameNormalized('/')).toBe('/');
  });

  it('basenameNormalized === basename on already-normalized inputs (#10)', () => {
    expect(basenameNormalized('/a/b/c.txt')).toBe(basename('/a/b/c.txt'));
    expect(basenameNormalized('/a/b/c.txt')).toBe('c.txt');
    expect(basenameNormalized('/a/b/c.txt', '.txt')).toBe(basename('/a/b/c.txt', '.txt'));
    expect(basenameNormalized('/a/b/c.txt', '.txt')).toBe('c');
    expect(basenameNormalized('/a')).toBe('a');
    expect(basenameNormalized('/')).toBe('');
  });

  it('joinPath joins absolute and relative parts', () => {
    expect(joinPath('/a', 'b', 'c')).toBe('/a/b/c');
    expect(joinPath('/a', '..', 'b')).toBe('/b');
    expect(joinPath('a', 'b')).toBe('a/b');
  });

  it('dirname returns parent', () => {
    expect(dirname('/a/b/c')).toBe('/a/b');
    expect(dirname('/a')).toBe('/');
    expect(dirname('/')).toBe('/');
  });

  it('basename strips extension', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('/a/b/c.txt', '.txt')).toBe('c');
  });

  it('extname returns extension', () => {
    expect(extname('foo.js')).toBe('.js');
    expect(extname('foo.test.js')).toBe('.js');
    expect(extname('Makefile')).toBe('');
  });

  it('segments splits absolute path', () => {
    expect(segments('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(segments('/')).toEqual([]);
  });
});
