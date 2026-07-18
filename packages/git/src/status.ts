import { NotImplementedError } from '@riftydev/io';
import type { StatusEntry, SupportedStatusEntry } from './types.ts';

/** Reachable isomorphic-git `${head}${workdir}${stage}` statusMatrix states. */
export type GitStatusMatrixCode =
  | '000'
  | '003'
  | '020'
  | '022'
  | '023'
  | '100'
  | '101'
  | '103'
  | '110'
  | '111'
  | '113'
  | '120'
  | '121'
  | '122'
  | '123';

/** One real Git porcelain-v1 `XY` status row. */
export type GitPorcelainXY = '??' | 'A ' | 'AD' | 'AM' | 'D ' | ' D' | 'M ' | ' M' | 'MD' | 'MM';

const CLEAN = Object.freeze([]) as readonly GitPorcelainXY[];
const AD = Object.freeze(['AD']) as readonly GitPorcelainXY[];
const UNTRACKED = Object.freeze(['??']) as readonly GitPorcelainXY[];
const ADDED = Object.freeze(['A ']) as readonly GitPorcelainXY[];
const AM = Object.freeze(['AM']) as readonly GitPorcelainXY[];
const DELETED = Object.freeze(['D ']) as readonly GitPorcelainXY[];
const WORKTREE_DELETED = Object.freeze([' D']) as readonly GitPorcelainXY[];
const MD = Object.freeze(['MD']) as readonly GitPorcelainXY[];
const DELETED_AND_RECREATED = Object.freeze(['D ', '??']) as readonly GitPorcelainXY[];
const MODIFIED = Object.freeze(['MM']) as readonly GitPorcelainXY[];
const WORKTREE_MODIFIED = Object.freeze([' M']) as readonly GitPorcelainXY[];
const INDEX_MODIFIED = Object.freeze(['M ']) as readonly GitPorcelainXY[];

/** Narrow an untyped transport value to one real porcelain-v1 XY row. */
export function isGitPorcelainXY(code: string): code is GitPorcelainXY {
  switch (code) {
    case '??':
    case 'A ':
    case 'AD':
    case 'AM':
    case 'D ':
    case ' D':
    case 'M ':
    case ' M':
    case 'MD':
    case 'MM':
      return true;
    default:
      return false;
  }
}

/** Narrow one untyped statusMatrix result without erasing its path. */
export function isGitStatusMatrixCode(code: string): code is GitStatusMatrixCode {
  switch (code) {
    case '000':
    case '003':
    case '020':
    case '022':
    case '023':
    case '100':
    case '101':
    case '103':
    case '110':
    case '111':
    case '113':
    case '120':
    case '121':
    case '122':
    case '123':
      return true;
    default:
      return false;
  }
}

/** Validate one statusMatrix result for a strict classifier caller. */
export function inspectGitStatusMatrixCode(code: string): GitStatusMatrixCode {
  if (isGitStatusMatrixCode(code)) return code;
  throw new NotImplementedError(`git.status-matrix.${code}`);
}

/**
 * Admit a complete status result to a strict consumer before it acts.
 * Interactive callers instead handle the discriminated entries directly.
 */
export function requireSupportedStatusEntries(
  entries: readonly StatusEntry[],
): readonly SupportedStatusEntry[] {
  const supported: SupportedStatusEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'unsupported') {
      throw new NotImplementedError(`git.status-matrix.${entry.rawStatusMatrixCode}`);
    }
    supported.push(entry);
  }
  return supported;
}

/**
 * Map one statusMatrix state to its ordered real-Git porcelain rows.
 *
 * `110`/`120` deliberately return two same-path rows: staged deletion followed
 * by the independently untracked worktree recreation (ADR-0284).
 */
export function porcelainStatusLines(code: GitStatusMatrixCode): readonly GitPorcelainXY[] {
  switch (inspectGitStatusMatrixCode(code)) {
    case '000':
    case '111':
      return CLEAN;
    case '003':
      return AD;
    case '020':
      return UNTRACKED;
    case '022':
      return ADDED;
    case '023':
      return AM;
    case '100':
      return DELETED;
    case '101':
      return WORKTREE_DELETED;
    case '103':
      return MD;
    case '110':
    case '120':
      return DELETED_AND_RECREATED;
    case '113':
    case '123':
      return MODIFIED;
    case '121':
      return WORKTREE_MODIFIED;
    case '122':
      return INDEX_MODIFIED;
  }
}
