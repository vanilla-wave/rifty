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

/**
 * Resolve git credentials for a smart-HTTP `url` (basic auth). Returns
 * `undefined` to decline (anonymous / let the server 401). Mirrors
 * isomorphic-git's `onAuth`, narrowed to the fields rifty drives.
 */
export type GitAuthProvider = (url: string) => { username: string; password?: string } | undefined;

/**
 * What {@link makeGit} binds to: the VFS-backed fs + the repo working dir, plus
 * the network transport knobs the verbs (clone/fetch/pull/push) use.
 *  - `http`     — isomorphic-git http plugin; defaults to `riftyGitHttp()`.
 *  - `corsProxy`— CORS proxy base URL; defaults to `getGitCorsProxyUrl()` (D-004).
 *  - `onAuth`   — credential provider for smart-HTTP basic auth.
 */
export interface MakeGitOptions {
  fs: import('./fs-adapter.ts').GitFs;
  dir: string;
  http?: import('./http-plugin.ts').GitHttp;
  corsProxy?: string;
  onAuth?: GitAuthProvider;
}

/** Args for `clone()` — smart-HTTP only (transport guarded). */
export interface CloneArgs {
  url: string;
  ref?: string;
  singleBranch?: boolean;
  depth?: number;
  noCheckout?: boolean;
}

/** Args for `fetch()` — `url` optional (falls back to the remote's config). */
export interface FetchArgs {
  url?: string;
  ref?: string;
  singleBranch?: boolean;
  depth?: number;
}

/** Args for `pull()` — `url` optional (falls back to the remote's config). */
export interface PullArgs {
  url?: string;
  ref?: string;
  singleBranch?: boolean;
}

/** Args for `push()` — `url`/`remote` optional (config fallback). */
export interface PushArgs {
  url?: string;
  remote?: string;
  ref?: string;
  force?: boolean;
}

/** Discriminated input for {@link Git.checkout}. `restore.source` undefined = from INDEX. */
export type CheckoutInput =
  | { op: 'switch'; ref: string; create?: boolean; startPoint?: string; force?: boolean }
  | { op: 'restore'; pathspecs: string[]; source?: string; force?: boolean };

/** Structured result of {@link Git.checkout} — the shell renders byte-exact git text from this. */
export type CheckoutResult =
  | {
      op: 'switch';
      target: string | undefined;
      oid: string;
      detached: boolean;
      created: boolean;
      alreadyOn: boolean;
      previousRef: string | undefined;
      headSubject: string;
    }
  | { op: 'restore'; restored: string[] };

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
