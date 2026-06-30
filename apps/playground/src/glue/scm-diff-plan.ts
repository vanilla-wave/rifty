/**
 * Byte-honest SCM diff blob selection (epic acceptance #3/#6).
 *
 * "Open Changes" is two FULL blobs in a Monaco diff, never a unified-diff text
 * stub. WHICH two blobs depends on the row's porcelain code + side (Staged vs
 * Changes). This is the load-bearing honesty decision, so it lives here as pure,
 * unit-tested logic instead of inline in the App component.
 */
import type { ScmResourceRow } from './scm-status.ts';

/** Tracked file with a HEAD blob to diff against (i.e. not a freshly-added file). */
export function statusCodeHasHeadBlob(code: string | undefined): boolean {
  if (code === undefined) return true;
  if (/^[0-3]{3}$/.test(code)) return code[0] !== '0'; // defensive: a raw matrix code
  return code !== '??' && code[0] !== 'A';
}

/** The index/staged column carries a change (X is not space/untracked). */
export function scmRowHasIndexChange(code: string): boolean {
  const index = code[0] ?? ' ';
  return index !== ' ' && index !== '?';
}

/** The index has a readable blob (changed AND not a staged deletion). */
export function scmRowHasIndexBlob(code: string): boolean {
  return scmRowHasIndexChange(code) && (code[0] ?? ' ') !== 'D';
}

export type ScmDiffBlobSource = 'head' | 'index' | 'working' | 'empty';

export interface ScmDiffPlan {
  /** Left pane blob. */
  readonly original: 'head' | 'index' | 'empty';
  /** Right pane blob. */
  readonly modified: 'index' | 'working' | 'empty';
  readonly originalTitle: 'HEAD' | 'Index';
  readonly modifiedTitle: 'Index' | 'Working Tree';
}

/**
 * For a Staged row: HEAD ↔ Index. For a Changes (worktree) row: whichever side
 * is the committed-or-staged baseline ↔ Working Tree (empty when the worktree
 * deletes the file). An added file has no HEAD blob → empty original.
 */
export function scmDiffPlan(row: ScmResourceRow): ScmDiffPlan {
  const code = row.code;
  if (row.side === 'index') {
    return {
      original: statusCodeHasHeadBlob(code) ? 'head' : 'empty',
      modified: scmRowHasIndexBlob(code) ? 'index' : 'empty',
      originalTitle: 'HEAD',
      modifiedTitle: 'Index',
    };
  }
  const indexChange = scmRowHasIndexChange(code);
  const original: ScmDiffPlan['original'] = indexChange
    ? scmRowHasIndexBlob(code)
      ? 'index'
      : 'empty'
    : statusCodeHasHeadBlob(code)
      ? 'head'
      : 'empty';
  return {
    original,
    modified: row.badge === 'D' ? 'empty' : 'working',
    originalTitle: indexChange ? 'Index' : 'HEAD',
    modifiedTitle: 'Working Tree',
  };
}
