import { describe, expect, it } from 'vitest';
import { porcelainXY, statusEntriesToDelta } from './git-status.ts';

describe('rifty-git status classifier', () => {
  it('maps statusMatrix codes to porcelain XY exactly like the shell builtin', () => {
    expect(porcelainXY('111')).toBeNull();
    expect(porcelainXY('020')).toBe('??');
    expect(porcelainXY('022')).toBe('A ');
    expect(porcelainXY('003')).toBe('AD');
    expect(porcelainXY('121')).toBe(' M');
    expect(porcelainXY('122')).toBe('M ');
    expect(porcelainXY('123')).toBe('MM');
    expect(porcelainXY('101')).toBe(' D');
    expect(porcelainXY('100')).toBe('D ');
    expect(porcelainXY('999')).toBe('999');
  });

  it('omits clean entries and exposes path/code pairs for the page cache', () => {
    expect(
      statusEntriesToDelta([
        { filepath: 'clean.txt', status: '111' },
        { filepath: 'edited.txt', status: '121' },
        { filepath: 'new.txt', status: '020' },
      ]),
    ).toEqual([
      { path: 'edited.txt', code: ' M' },
      { path: 'new.txt', code: '??' },
    ]);
  });
});
