/** Public types for the {@link makeGit} facade. */

/** Author/committer identity — timestamp in seconds, offset in minutes (git canon). */
export interface GitIdentity {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
}

/** One row of `status()` — `status` is the 3-char head/workdir/stage code. */
export interface StatusEntry {
  filepath: string;
  status: string;
}

/** One commit from `log()` (newest-first). */
export interface LogEntry {
  oid: string;
  message: string;
  author: GitIdentity;
}

/** What {@link makeGit} binds to: the VFS-backed fs + the repo working dir. */
export interface MakeGitOptions {
  fs: import('./fs-adapter.ts').GitFs;
  dir: string;
}

/** Per-file change class reported by `diff()` (HEAD tree vs working dir). */
export type DiffChange = 'add' | 'modify' | 'delete';

/** One unified-diff hunk: `@@ -oldStart,oldLines +newStart,newLines @@`. */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines prefixed `' '` (context) | `'-'` (removed) | `'+'` (added). */
  lines: string[];
}

/** One file's diff: structured data, not byte-exact `git diff` text. */
export interface DiffEntry {
  filepath: string;
  change: DiffChange;
  hunks: DiffHunk[];
}
