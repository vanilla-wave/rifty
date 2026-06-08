/**
 * Shared recursive tree-walker backing `grep -r` and `find` (Q-2026-06-06-401).
 *
 * Adapts the FIELD-form {@link VfsDirent} (`.isDirectory` is a boolean, never a
 * method) — distinct from runtime-js's METHOD-form Dirent. Imports `@riftydev/vfs`
 * only; pulling the legacy runtime-js walker here would be a reverse-import.
 */

import { joinPath, syncMirror } from '@riftydev/vfs';

/** One visited node. `root` itself is never yielded; direct children are depth 1. */
export interface WalkEntry {
  /** Absolute VFS path. */
  path: string;
  /** Final path segment. */
  name: string;
  isDirectory: boolean;
  /** 1-based distance from `root`. */
  depth: number;
}

/**
 * Depth-first walk of `root`, excluding `root` itself. Within each directory,
 * `readdirSync` entries are sorted by name ascending for determinism, then
 * recursed depth-first. Files are always yielded; directories only when
 * `includeDirs`. `maxDepth` bounds how deep the walk descends (entries at
 * `maxDepth` are yielded but their children are not visited).
 *
 * A {@link VfsError} from a missing/invalid `root` propagates — callers map it
 * to the command's stderr + exit code.
 *
 * @param root Absolute VFS directory to walk.
 * @param opts `maxDepth` descent cap; `includeDirs` to also yield directories.
 */
export function* walk(
  root: string,
  opts: { maxDepth?: number; includeDirs?: boolean } = {},
): Generator<WalkEntry> {
  const fs = syncMirror();
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const includeDirs = opts.includeDirs ?? false;

  function* descend(dir: string, depth: number): Generator<WalkEntry> {
    const entries = [...fs.readdirSync(dir)].sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const path = joinPath(dir, entry.name);
      if (entry.isDirectory) {
        if (includeDirs) yield { path, name: entry.name, isDirectory: true, depth };
        if (depth < maxDepth) yield* descend(path, depth + 1);
      } else {
        yield { path, name: entry.name, isDirectory: false, depth };
      }
    }
  }

  yield* descend(root, 1);
}
