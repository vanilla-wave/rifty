import { describe, expect, it } from 'vitest';
import {
  decorationForPath,
  gitDecorationKind,
  gitStatusDecorationMaps,
} from './git-decorations.ts';

describe('git status explorer decorations', () => {
  it('classifies rifty-git porcelain codes into honest M/U/A/D decorations', () => {
    expect(gitDecorationKind(' M')).toBe('modified');
    expect(gitDecorationKind('M ')).toBe('modified');
    expect(gitDecorationKind('A ')).toBe('added');
    expect(gitDecorationKind('??')).toBe('untracked');
    expect(gitDecorationKind(' D')).toBe('deleted');
    expect(gitDecorationKind('D ')).toBe('deleted');
    expect(gitDecorationKind('R ')).toBeNull();
  });

  it('does not hide the worktree side of staged+worktree combos (VS Code parity)', () => {
    // Added-then-edited reads as added (green), not blue "staged".
    expect(gitDecorationKind('AM')).toBe('added');
    // Staged-then-re-edited stays modified (orange), not blue "staged".
    expect(gitDecorationKind('MM')).toBe('modified');
    // Staged-modified-then-deleted-on-disk is deleted (red), never clean/null.
    expect(gitDecorationKind('MD')).toBe('deleted');
    expect(gitDecorationKind('AD')).toBe('deleted');
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
      kind: 'added',
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
