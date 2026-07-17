/**
 * PATH-style resolution of installed CLIs (ADR-0137).
 *
 * Mirrors npm/Node semantics: a bare command name resolves to the nearest
 * `node_modules/.bin/<name>` launcher shim, found by walking UP from the cwd to
 * `/` (first hit wins). A name containing `/` is a path, not a PATH lookup —
 * bash never consults PATH for it — so it never resolves here.
 *
 * Pure VFS read against the shell's filesystem; the shell dispatches the
 * resolved shim to its injected `BinExecutor` (a name this layer can't run).
 */

import { type FsSync, joinPath, normalizePath } from '@riftydev/vfs';

/**
 * Absolute path of the nearest `node_modules/.bin/<name>` shim reachable by
 * walking up from `cwd`, or `null` when none exists / `name` is not a bare
 * command (empty or path-like).
 */
export function resolveBin(fs: FsSync, cwd: string, name: string): string | null {
  if (name === '' || name.includes('/')) return null;
  let dir = normalizePath(cwd);
  for (;;) {
    const candidate = joinPath(dir, 'node_modules', '.bin', name);
    if (fs.statSyncOrNull(candidate)?.isFile) return candidate;
    if (dir === '/') return null;
    const slash = dir.lastIndexOf('/');
    dir = slash <= 0 ? '/' : dir.slice(0, slash);
  }
}
