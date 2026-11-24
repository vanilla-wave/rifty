/**
 * A mask other than the FS's own: Node applies it, the VFS cannot — loud, never
 * accepted silently (backlog runtime-js/process-umask-missing). No parity oracle:
 * real Node accepts every valid mask.
 */
import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { NodeProcess } from './process.ts';

describe('process.umask(mask) the VFS cannot apply', () => {
  for (const mask of [0o022, '022', 0o777, 0o1000, 2 ** 32 - 1]) {
    it(`${typeof mask} ${String(mask)} throws NotImplementedError, umask unchanged`, () => {
      const p = new NodeProcess();
      expect(() => p.umask(mask)).toThrow(NotImplementedError);
      expect(() => p.umask(mask)).toThrow('process.umask(mask)');
      expect(p.umask()).toBe(0);
    });
  }

  it('the current mask 0 (number, octal string) returns the previous mask', () => {
    const p = new NodeProcess();
    expect([p.umask(0), p.umask('0'), p.umask('000'), p.umask()]).toEqual([0, 0, 0, 0]);
  });
});
