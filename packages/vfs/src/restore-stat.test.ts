/**
 * `MemoryFsSync.restoreStatSync` (ADR-0567 §6): a snapshot restore sets `ino`
 * and the four times of an entry verbatim, and later entries never reuse a
 * restored inode. RED until it lands (`red` = `it.fails`).
 */
import { describe, expect, it } from 'vitest';
import { VfsError } from './errors.ts';
import { createMemoryFs } from './sync-mirror.ts';

const red = it.fails;
const STAT = { ino: 9_000_000, mtimeMs: 1.25, atimeMs: -2, ctimeMs: 3.5, birthtimeMs: 4 };

describe('MemoryFsSync.restoreStatSync', () => {
  red('sets ino, mtime, atime, ctime and birthtime of a file, a dir and the root exactly', () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/d', { recursive: false });
    fsSync.writeFileSync('/d/f', new Uint8Array([1]));
    for (const [path, ino] of [
      ['/', 9_000_001],
      ['/d', 9_000_002],
      ['/d/f', 9_000_003],
    ] as const) {
      fsSync.restoreStatSync(path, { ...STAT, ino });
      const s = fsSync.statSync(path);
      expect([s.metadata?.ino, s.mtime, s.atime, s.metadata?.ctime, s.metadata?.birthtime]).toEqual(
        [ino, STAT.mtimeMs, STAT.atimeMs, STAT.ctimeMs, STAT.birthtimeMs],
      );
    }
  });

  red(
    'entries created afterwards, in any MemoryFs of the realm, get inodes above the restored one',
    () => {
      const one = createMemoryFs().fsSync;
      one.writeFileSync('/a', new Uint8Array(0));
      one.restoreStatSync('/a', STAT);
      one.writeFileSync('/b', new Uint8Array(0));
      const other = createMemoryFs().fsSync;
      other.writeFileSync('/c', new Uint8Array(0));
      expect(one.statSync('/b').metadata?.ino).toBeGreaterThan(STAT.ino);
      expect(other.statSync('/c').metadata?.ino).toBeGreaterThan(STAT.ino);
    },
  );

  red('a missing path is ENOENT', () => {
    const { fsSync } = createMemoryFs();
    expect(() => fsSync.restoreStatSync('/nope', STAT)).toThrow(VfsError);
  });
});
