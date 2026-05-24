import { describe, expect, it } from 'vitest';
import { basename, dirname, extname, joinPath, normalizePath, segments } from './path.ts';

describe('vfs/path', () => {
  it('normalizePath collapses . and ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c');
    expect(normalizePath('/a//b///c')).toBe('/a/b/c');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
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
