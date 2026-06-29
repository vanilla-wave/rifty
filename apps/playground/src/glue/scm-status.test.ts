import { describe, expect, it } from 'vitest';
import { scmRowsFromStatusMap } from './scm-status.ts';

describe('SCM status projection', () => {
  it('splits porcelain XY entries into staged and changes groups', () => {
    const rows = scmRowsFromStatusMap(
      new Map([
        ['/workspace/src/main.ts', ' M'],
        ['/workspace/src/new.ts', '??'],
        ['/workspace/src/staged.ts', 'A '],
        ['/workspace/src/both.ts', 'MM'],
        ['/workspace/src/add-delete.ts', 'AD'],
        ['/workspace/src/deleted.ts', ' D'],
      ]),
      '/workspace',
    );

    expect(rows.staged).toEqual([
      {
        path: '/workspace/src/staged.ts',
        relativePath: 'src/staged.ts',
        code: 'A ',
        side: 'index',
        badge: 'A',
      },
      {
        path: '/workspace/src/both.ts',
        relativePath: 'src/both.ts',
        code: 'MM',
        side: 'index',
        badge: 'M',
      },
      {
        path: '/workspace/src/add-delete.ts',
        relativePath: 'src/add-delete.ts',
        code: 'AD',
        side: 'index',
        badge: 'A',
      },
    ]);
    expect(rows.changes).toEqual([
      {
        path: '/workspace/src/main.ts',
        relativePath: 'src/main.ts',
        code: ' M',
        side: 'worktree',
        badge: 'M',
      },
      {
        path: '/workspace/src/new.ts',
        relativePath: 'src/new.ts',
        code: '??',
        side: 'worktree',
        badge: 'U',
      },
      {
        path: '/workspace/src/both.ts',
        relativePath: 'src/both.ts',
        code: 'MM',
        side: 'worktree',
        badge: 'M',
      },
      {
        path: '/workspace/src/add-delete.ts',
        relativePath: 'src/add-delete.ts',
        code: 'AD',
        side: 'worktree',
        badge: 'D',
      },
      {
        path: '/workspace/src/deleted.ts',
        relativePath: 'src/deleted.ts',
        code: ' D',
        side: 'worktree',
        badge: 'D',
      },
    ]);
  });

  it('suppresses status rows outside the currently rendered root', () => {
    const rows = scmRowsFromStatusMap(
      new Map([
        ['/scratch/src/old.ts', ' M'],
        ['/projects/p1/src/current.ts', ' M'],
      ]),
      '/projects/p1',
    );

    expect(rows.changes).toEqual([
      {
        path: '/projects/p1/src/current.ts',
        relativePath: 'src/current.ts',
        code: ' M',
        side: 'worktree',
        badge: 'M',
      },
    ]);
  });
});
