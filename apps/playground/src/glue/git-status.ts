import { type GitPorcelainXY, type StatusEntry, porcelainStatusLines } from '@riftydev/git';

export { porcelainStatusLines };

export interface GitStatusDeltaSupportedEntry {
  readonly kind: 'supported';
  readonly path: string;
  /** Real Git porcelain XY code (`??`, ` M`, `A `, ...). */
  readonly code: GitPorcelainXY;
}

export interface GitStatusDeltaUnsupportedEntry {
  readonly kind: 'unsupported';
  readonly path: string;
  readonly rawStatusMatrixCode: string;
}

export type GitStatusDeltaEntry = GitStatusDeltaSupportedEntry | GitStatusDeltaUnsupportedEntry;

export function statusEntriesToDelta(
  entries: readonly StatusEntry[],
): readonly GitStatusDeltaEntry[] {
  const delta: GitStatusDeltaEntry[] = [];
  for (const entry of entries) {
    if (entry.filepath === '.rifty' || entry.filepath.startsWith('.rifty/')) continue;
    if (entry.kind === 'unsupported') {
      delta.push({
        kind: 'unsupported',
        path: entry.filepath,
        rawStatusMatrixCode: entry.rawStatusMatrixCode,
      });
      continue;
    }
    for (const code of porcelainStatusLines(entry.status)) {
      delta.push({ kind: 'supported', path: entry.filepath, code });
    }
  }
  return delta;
}
