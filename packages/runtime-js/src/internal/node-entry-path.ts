import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

/** Resolve a Node file entry against the child cwd before loader/process use. */
export function resolveNodeEntryPath(cwd: string, entryPath: string): string {
  return normalizePath(isAbsolute(entryPath) ? entryPath : joinPath(cwd, entryPath));
}
