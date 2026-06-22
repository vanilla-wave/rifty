/**
 * Pure line-level diff: two texts → unified {@link DiffHunk}s (3 lines of
 * context, git's default). LCS via the classic O(n·m) DP table, then a
 * backtrack into ' '/'-'/'+' edit ops, then grouped into hunks. No git-diff
 * byte-exactness intended — structured data for a later formatting pass.
 */
import type { DiffHunk } from './types.ts';

const CONTEXT = 3;

/** One backtracked edit op against the old/new line arrays. */
type Op =
  | { kind: 'eq'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'add'; text: string };

/**
 * Split into lines, dropping a single trailing empty segment so a final
 * newline does not synthesise a phantom blank line (`'a\nb\n'` → `['a','b']`).
 * Empty input → no lines.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** LCS DP table: lcs[i][j] = longest common subsequence length of a[i..], b[j..]. */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  // (n+1)×(m+1), zero-filled; row n / col m are the base cases (empty suffix).
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[i];
    const row = lcs[i];
    const next = lcs[i + 1];
    if (row === undefined || next === undefined) continue;
    for (let j = m - 1; j >= 0; j--) {
      const bj = b[j];
      const diag = next[j + 1] ?? 0;
      const down = next[j] ?? 0;
      const right = row[j + 1] ?? 0;
      row[j] = ai === bj ? diag + 1 : Math.max(down, right);
    }
  }
  return lcs;
}

/** Backtrack the LCS table into a flat op stream (eq/del/add), in order. */
function backtrack(a: string[], b: string[], lcs: number[][]): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  const n = a.length;
  const m = b.length;
  while (i < n && j < m) {
    const ai = a[i];
    const bj = b[j];
    if (ai === bj && ai !== undefined) {
      ops.push({ kind: 'eq', text: ai });
      i++;
      j++;
      continue;
    }
    const down = lcs[i + 1]?.[j] ?? 0;
    const right = lcs[i]?.[j + 1] ?? 0;
    if (down >= right) {
      ops.push({ kind: 'del', text: ai ?? '' });
      i++;
    } else {
      ops.push({ kind: 'add', text: bj ?? '' });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: 'del', text: a[i] ?? '' });
  for (; j < m; j++) ops.push({ kind: 'add', text: b[j] ?? '' });
  return ops;
}

/** A prefixed unified-diff line for a given op. */
function prefixed(op: Op): string {
  if (op.kind === 'eq') return ` ${op.text}`;
  if (op.kind === 'del') return `-${op.text}`;
  return `+${op.text}`;
}

/**
 * Group the op stream into hunks: changed runs plus ≤CONTEXT equal lines on
 * each side, merged when their context windows touch. Tracks 1-based old/new
 * start lines and per-side line counts (git's `@@ -s,c +s,c @@` numbers).
 */
function toHunks(ops: Op[]): DiffHunk[] {
  // Indices of ops that are actual changes (del/add).
  const changeIdx: number[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op && op.kind !== 'eq') changeIdx.push(k);
  }
  if (changeIdx.length === 0) return [];

  // Merge change indices into windows [start,end] of op positions, padded by
  // CONTEXT and coalesced when overlapping/adjacent.
  const windows: Array<{ start: number; end: number }> = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(ops.length - 1, idx + CONTEXT);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }

  const hunks: DiffHunk[] = [];
  for (const { start, end } of windows) {
    // 1-based start lines: count non-add ops before `start` (old) and non-del
    // ops before `start` (new).
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k++) {
      const op = ops[k];
      if (!op) continue;
      if (op.kind !== 'add') oldStart++;
      if (op.kind !== 'del') newStart++;
    }
    const lines: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    for (let k = start; k <= end; k++) {
      const op = ops[k];
      if (!op) continue;
      lines.push(prefixed(op));
      if (op.kind !== 'add') oldLines++;
      if (op.kind !== 'del') newLines++;
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
  }
  return hunks;
}

/** Two texts → unified hunks (3-line context). Empty array when identical. */
export function lineDiff(oldText: string, newText: string): DiffHunk[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const lcs = lcsTable(a, b);
  const ops = backtrack(a, b, lcs);
  return toHunks(ops);
}
