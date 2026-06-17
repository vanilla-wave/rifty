/**
 * Resolve a restored terminal cwd against the tree that actually holds it
 * (single-store-owner model: exactly one authoritative store owner, and the page
 * reads through ports rather than holding its own authoritative fs). The owner
 * realm validates a persisted/seeded cwd against
 * its OWN `syncMirror()` and falls back to the workspace root when the path is
 * gone (deleted since the last session) — this replaced the PAGE-side check that
 * read a now-removed page authoritative store.
 */

export interface CwdStatFs {
  statSyncOrNull(path: string): { isDirectory: boolean } | null;
}

/** `cwd` if it is an existing directory in `fs`, else `fallback`. */
export function reachableCwd(fs: CwdStatFs, cwd: string | undefined, fallback: string): string {
  if (cwd && fs.statSyncOrNull(cwd)?.isDirectory === true) return cwd;
  return fallback;
}
