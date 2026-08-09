import { describe, expect, it } from 'vitest';
import path from '../../../packages/runtime-js/src/builtins/path.ts';

describe('node:path', () => {
  it('join', () => {
    expect(path.join('/a', 'b', 'c')).toBe('/a/b/c');
    expect(path.join('/a', '..', 'b')).toBe('/b');
    expect(path.join('a', 'b', 'c')).toBe('a/b/c');
    expect(path.join('.')).toBe('.');
    expect(path.join('', './')).toBe('./');
    expect(path.join('foo', '../')).toBe('./');
    expect(path.join('foo', '..', './')).toBe('./');
    expect(path.join('..', './')).toBe('../');
    expect(path.join('../..', './')).toBe('../../');
    expect(path.join('foo/', 'bar/')).toBe('foo/bar/');
    expect(path.join('/', './')).toBe('/');
  });
  it('resolve', () => {
    expect(path.resolve('/a/b', 'c')).toBe('/a/b/c');
    expect(path.resolve('/a/b', '/c/d')).toBe('/c/d');
    // `resolve('a', 'b')` is cwd-dependent in Node — pinned in the cwd test
    // below (the old `'/a/b'` expectation encoded the pre-fix '/' anchor).
  });
  it('resolve anchors relative paths at process.cwd(), like Node', async () => {
    // Regression: a '/'-anchored resolve broke express.static('public') under
    // a non-root cwd (fs already resolved against cwd; path.resolve did not).
    const { getProcessCwd, setProcessCwd } = await import(
      '../../../packages/runtime-js/src/builtins/process.ts'
    );
    const saved = getProcessCwd();
    try {
      setProcessCwd('/workspace');
      expect(path.resolve('public')).toBe('/workspace/public');
      expect(path.resolve('a', 'b')).toBe('/workspace/a/b');
      expect(path.resolve()).toBe('/workspace');
      expect(path.resolve('/abs', 'c')).toBe('/abs/c');
    } finally {
      setProcessCwd(saved);
    }
  });
  it('normalize', () => {
    expect(path.normalize('.')).toBe('.');
    expect(path.normalize('/a/./b/../c')).toBe('/a/c');
    expect(path.normalize('/a//b')).toBe('/a/b');
  });
  it('dirname / basename / extname', () => {
    expect(path.dirname('/a/b/c.txt')).toBe('/a/b');
    expect(path.basename('/a/b/c.txt')).toBe('c.txt');
    expect(path.basename('/a/b/c.txt', '.txt')).toBe('c');
    expect(path.extname('a.test.js')).toBe('.js');
  });
  it('relative', () => {
    expect(path.relative('/a/b/c', '/a/b/d')).toBe('../d');
    expect(path.relative('/a/b', '/a/b')).toBe('');
    expect(path.relative('/a/b', '/a/b/c/d')).toBe('c/d');
  });
  it('parse / format roundtrip', () => {
    const parsed = path.parse('/foo/bar/baz.txt');
    expect(parsed).toEqual({
      root: '/',
      dir: '/foo/bar',
      base: 'baz.txt',
      name: 'baz',
      ext: '.txt',
    });
    expect(path.format(parsed)).toBe('/foo/bar/baz.txt');
  });
  it('isAbsolute / sep / delimiter', () => {
    expect(path.isAbsolute('/x')).toBe(true);
    expect(path.isAbsolute('x')).toBe(false);
    expect(path.sep).toBe('/');
    expect(path.delimiter).toBe(':');
  });
});
