import { describe, expect, it } from 'vitest';
import {
  decorationForPath,
  gitDecorationKind,
  gitStatusDecorationMaps,
} from './git-decorations.ts';

describe('git status explorer decorations', () => {
  it('classifies rifty-git porcelain codes into honest M/U/A/D decorations', () => {
    expect(gitDecorationKind(' M')).toBe('modified');
    expect(gitDecorationKind('M ')).toBe('staged');
    expect(gitDecorationKind('A ')).toBe('staged');
    expect(gitDecorationKind('??')).toBe('untracked');
    expect(gitDecorationKind(' D')).toBe('deleted');
    expect(gitDecorationKind('D ')).toBe('deleted');
    expect(gitDecorationKind('R ')).toBeNull();
  });

  it('propagates changed descendants to ancestor folders without inventing badges', () => {
    const status = new Map([
      ['/workspace/src/main.ts', ' M'],
      ['/workspace/src/new.ts', '??'],
      ['/workspace/README.md', 'A '],
    ]);

    const maps = gitStatusDecorationMaps(status);

    expect(decorationForPath(maps, '/workspace/src/main.ts')).toEqual({
      badge: 'M',
      kind: 'modified',
      title: 'rifty-git status: M modified',
    });
    expect(decorationForPath(maps, '/workspace/src/new.ts')).toMatchObject({
      badge: 'U',
      kind: 'untracked',
    });
    expect(decorationForPath(maps, '/workspace/README.md')).toMatchObject({
      badge: 'A',
      kind: 'staged',
    });
    expect(decorationForPath(maps, '/workspace/src')).toEqual({
      badge: undefined,
      kind: 'modified',
      title: 'rifty-git status: descendant modified',
    });
    expect(decorationForPath(maps, '/workspace')).toMatchObject({
      badge: undefined,
      kind: 'modified',
    });
    expect(decorationForPath(maps, '/workspace/clean.ts')).toBeNull();
  });
});
