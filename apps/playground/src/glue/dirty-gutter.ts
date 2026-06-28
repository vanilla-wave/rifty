export type DirtyGutterKind = 'added' | 'modified' | 'deleted';

export interface DirtyGutterChange {
  readonly lineNumber: number;
  readonly kind: DirtyGutterKind;
}

type LineOp = { readonly kind: 'eq' | 'del' | 'add'; readonly text: string };

function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = lcs[i];
    const next = lcs[i + 1];
    if (!row || !next) continue;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return lcs;
}

function lineOps(original: readonly string[], modified: readonly string[]): LineOp[] {
  const lcs = lcsTable(original, modified);
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < modified.length) {
    const a = original[i] ?? '';
    const b = modified[j] ?? '';
    if (a === b) {
      ops.push({ kind: 'eq', text: a });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: 'del', text: a });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: b });
      j += 1;
    }
  }
  for (; i < original.length; i += 1) ops.push({ kind: 'del', text: original[i] ?? '' });
  for (; j < modified.length; j += 1) ops.push({ kind: 'add', text: modified[j] ?? '' });
  return ops;
}

function changesForRun(run: readonly LineOp[], newLineAtRunStart: number): DirtyGutterChange[] {
  const additions = run.filter((op) => op.kind === 'add');
  const deletions = run.filter((op) => op.kind === 'del');
  if (additions.length === 0 && deletions.length === 0) return [];
  if (deletions.length === 0) {
    return additions.map((_, idx) => ({ kind: 'added', lineNumber: newLineAtRunStart + idx }));
  }
  if (additions.length === 0) {
    return [{ kind: 'deleted', lineNumber: Math.max(1, newLineAtRunStart) }];
  }
  const marks: DirtyGutterChange[] = additions.map((_, idx) => ({
    kind: 'modified',
    lineNumber: newLineAtRunStart + idx,
  }));
  if (deletions.length > additions.length) {
    marks.push({ kind: 'deleted', lineNumber: Math.max(1, newLineAtRunStart + additions.length) });
  }
  return marks;
}

export function dirtyGutterChanges(
  originalText: string,
  modifiedText: string,
): DirtyGutterChange[] {
  const ops = lineOps(splitLines(originalText), splitLines(modifiedText));
  const changes: DirtyGutterChange[] = [];
  let newLine = 1;
  let run: LineOp[] = [];
  let runNewStart = 1;
  const flush = (): void => {
    changes.push(...changesForRun(run, runNewStart));
    run = [];
  };
  for (const op of ops) {
    if (op.kind === 'eq') {
      flush();
      newLine += 1;
      continue;
    }
    if (run.length === 0) runNewStart = newLine;
    run.push(op);
    if (op.kind === 'add') newLine += 1;
  }
  flush();
  return changes;
}
