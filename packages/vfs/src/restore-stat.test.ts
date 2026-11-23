/**
 * `MemoryFsSync.restoreStatSync` (ADR-0567 §6): a snapshot restore sets the
 * four times of an entry verbatim — `ctime`/`birthtime` included, which
 * `utimes` cannot — and leaves `ino` alone.
 */
import { describe, expect, it } from 'vitest';
import { VfsError } from './errors.ts';
import { createMemoryFs } from './sync-mirror.ts';

const carrier = it;
const STAT = { mtimeMs: 1.25, atimeMs: -2, ctimeMs: 3.5, birthtimeMs: 4 };

describe('MemoryFsSync.restoreStatSync', () => {
  carrier('sets mtime, atime, ctime and birthtime of a file, a dir and the root exactly', () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/d', { recursive: false });
    fsSync.writeFileSync('/d/f', new Uint8Array([1]));
    for (const path of ['/', '/d', '/d/f']) {
      const ino = fsSync.statSync(path).metadata?.ino;
      fsSync.restoreStatSync(path, STAT);
      const s = fsSync.statSync(path);
      expect([s.mtime, s.atime, s.metadata?.ctime, s.metadata?.birthtime, s.metadata?.ino]).toEqual(
        [STAT.mtimeMs, STAT.atimeMs, STAT.ctimeMs, STAT.birthtimeMs, ino],
      );
    }
  });

  carrier('a missing path is ENOENT', () => {
    const { fsSync } = createMemoryFs();
    expect(() => fsSync.restoreStatSync('/nope', STAT)).toThrow(VfsError);
  });
});
