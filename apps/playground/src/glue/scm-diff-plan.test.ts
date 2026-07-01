import { describe, expect, it } from 'vitest';
import { scmDiffPlan } from './scm-diff-plan.ts';
import { type ScmResourceRow, scmRowsFromStatusMap } from './scm-status.ts';

const ROOT = '/ws';

function row(code: string, side: 'index' | 'worktree'): ScmResourceRow {
  const groups = scmRowsFromStatusMap(new Map([[`${ROOT}/f`, code]]), ROOT);
  const r = (side === 'index' ? groups.staged : groups.changes)[0];
  if (!r) throw new Error(`no ${side} row for ${code}`);
  return r;
}

describe('scm diff blob plan (byte-honest blob-vs-blob)', () => {
  it('staged rows diff HEAD ↔ Index, with empty sides for pure add/delete', () => {
    expect(scmDiffPlan(row('M ', 'index'))).toMatchObject({
      original: 'head',
      modified: 'index',
      originalTitle: 'HEAD',
      modifiedTitle: 'Index',
    });
    expect(scmDiffPlan(row('A ', 'index'))).toMatchObject({ original: 'empty', modified: 'index' });
    expect(scmDiffPlan(row('D ', 'index'))).toMatchObject({ original: 'head', modified: 'empty' });
    expect(scmDiffPlan(row('AM', 'index'))).toMatchObject({ original: 'empty', modified: 'index' });
    expect(scmDiffPlan(row('MD', 'index'))).toMatchObject({ original: 'head', modified: 'index' });
  });

  it('worktree rows diff the staged-or-HEAD baseline ↔ Working Tree', () => {
    expect(scmDiffPlan(row(' M', 'worktree'))).toMatchObject({
      original: 'head',
      modified: 'working',
      originalTitle: 'HEAD',
      modifiedTitle: 'Working Tree',
    });
    expect(scmDiffPlan(row('MM', 'worktree'))).toMatchObject({
      original: 'index',
      modified: 'working',
      originalTitle: 'Index',
    });
    expect(scmDiffPlan(row('??', 'worktree'))).toMatchObject({
      original: 'empty',
      modified: 'working',
    });
    expect(scmDiffPlan(row(' D', 'worktree'))).toMatchObject({
      original: 'head',
      modified: 'empty',
    });
    // Added-then-edited (AM): the further edits diff against the staged blob.
    expect(scmDiffPlan(row('AM', 'worktree'))).toMatchObject({
      original: 'index',
      modified: 'working',
    });
    // Staged-modified-then-deleted (MD): index ↔ empty (file gone from disk).
    expect(scmDiffPlan(row('MD', 'worktree'))).toMatchObject({
      original: 'index',
      modified: 'empty',
    });
  });
});
