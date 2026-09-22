import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { win32 } from './path-win32.ts';
import { getProcessCwd, setProcessCwd } from './process.ts';

describe('path.win32', () => {
  const previous = getProcessCwd();

  it('matches Node path.win32 on the Windows algorithm', () => {
    setProcessCwd(process.cwd());
    try {
      const node = nodePath.win32;
      expect(win32.sep).toBe(node.sep);
      expect(win32.delimiter).toBe(node.delimiter);
      expect(win32.join('a', 'b')).toBe(node.join('a', 'b'));
      expect(win32.join('a', '/b')).toBe(node.join('a', '/b'));
      expect(win32.join('C:\\foo', 'bar')).toBe(node.join('C:\\foo', 'bar'));
      expect(win32.join('//server', 'share')).toBe(node.join('//server', 'share'));
      expect(win32.join('foo/bar', '..', 'baz')).toBe(node.join('foo/bar', '..', 'baz'));
      expect(win32.normalize('C:/foo/../bar')).toBe(node.normalize('C:/foo/../bar'));
      expect(win32.normalize('\\\\server\\share\\')).toBe(node.normalize('\\\\server\\share\\'));
      expect(win32.isAbsolute('C:\\foo')).toBe(true);
      expect(win32.isAbsolute('C:foo')).toBe(false);
      expect(win32.dirname('C:\\foo\\bar\\')).toBe(node.dirname('C:\\foo\\bar\\'));
      expect(win32.dirname('\\\\server\\share\\file')).toBe(
        node.dirname('\\\\server\\share\\file'),
      );
      expect(win32.basename('C:\\foo\\bar.txt', '.txt')).toBe('bar');
      expect(win32.extname('.hidden')).toBe(node.extname('.hidden'));
      expect(win32.extname('C:\\foo\\bar.txt')).toBe('.txt');
      expect(win32.relative('C:\\a\\b', 'C:\\a\\c')).toBe(node.relative('C:\\a\\b', 'C:\\a\\c'));
      expect(win32.relative('C:\\foo\\bar', 'C:\\foo')).toBe(
        node.relative('C:\\foo\\bar', 'C:\\foo'),
      );
      expect(win32.resolve('C:\\foo', 'bar')).toBe(node.resolve('C:\\foo', 'bar'));
      expect(win32.resolve('foo', 'bar')).toBe(node.resolve('foo', 'bar'));
      expect(win32.resolve('/foo', 'bar')).toBe(node.resolve('/foo', 'bar'));
      expect(win32.toNamespacedPath('C:\\foo')).toBe(node.toNamespacedPath('C:\\foo'));
      expect(win32.toNamespacedPath('\\\\server\\share\\a')).toBe(
        node.toNamespacedPath('\\\\server\\share\\a'),
      );
      expect(win32.parse('C:\\foo\\bar.txt')).toEqual(node.parse('C:\\foo\\bar.txt'));
      expect(win32.format({ dir: 'C:\\foo', base: 'bar.txt' })).toBe(
        node.format({ dir: 'C:\\foo', base: 'bar.txt' }),
      );
      expect(win32).not.toBe(nodePath.posix);
    } finally {
      setProcessCwd(previous);
    }
  });
});
