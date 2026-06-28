import { type StatusEntry, porcelainXY } from '@riftydev/git';

export { porcelainXY };

export interface GitStatusDeltaEntry {
  readonly path: string;
  /** rifty-git porcelain XY code (`??`, ` M`, `A `, ...). */
  readonly code: string;
}

export function statusEntriesToDelta(
  entries: readonly StatusEntry[],
): readonly GitStatusDeltaEntry[] {
  const delta: GitStatusDeltaEntry[] = [];
  for (const entry of entries) {
    const code = porcelainXY(entry.status);
    if (code !== null) delta.push({ path: entry.filepath, code });
  }
  return delta;
}
