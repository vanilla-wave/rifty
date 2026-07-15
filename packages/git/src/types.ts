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
  committer: GitIdentity;
  tree: string;
  parents: string[];
}

/** Options for `log()` history traversal. */
export interface LogOptions {
  ref?: string;
  depth?: number;
  filepath?: string;
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
 *  - `assertPortablePaths` — synchronous host policy over a complete worktree
 *    mutation plan. It must throw before Git writes the first worktree byte.
 */
export interface MakeGitOptions {
  fs: import('./fs-adapter.ts').GitFs;
  dir: string;
  http?: import('./http-plugin.ts').GitHttp;
  corsProxy?: string;
  onAuth?: GitAuthProvider;
  assertPortablePaths?: (absolutePaths: readonly string[]) => void;
}

/** Args for `clone()` — smart-HTTP only (transport guarded). */
export interface CloneArgs {
  url: string;
  ref?: string;
  singleBranch?: boolean;
  depth?: number;
  noTags?: boolean;
  noCheckout?: boolean;
}

/** Args for `fetch()` — `url`/`remote` optional (fall back to the remote's config). */
export interface FetchArgs {
  url?: string;
  remote?: string;
  ref?: string;
  remoteRef?: string;
  singleBranch?: boolean;
  depth?: number;
  tags?: boolean;
  prune?: boolean;
  pruneTags?: boolean;
}

/** Args for `pull()` — `url`/`remote` optional (fall back to the remote's config). */
export interface PullArgs {
  url?: string;
  remote?: string;
  ref?: string;
  remoteRef?: string;
  singleBranch?: boolean;
  prune?: boolean;
  pruneTags?: boolean;
}

/** Args for `push()` — `url`/`remote` optional (config fallback). */
export interface PushArgs {
  url?: string;
  remote?: string;
  ref?: string;
  remoteRef?: string;
  force?: boolean;
  delete?: boolean;
}

/** Discriminated input for {@link Git.checkout}. `restore.source` undefined = from INDEX. */
export type CheckoutInput =
  | { op: 'switch'; ref: string; create?: boolean; startPoint?: string; force?: boolean }
  | { op: 'restore'; pathspecs: string[]; source?: string };

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
  /** Binary content — rendered as git's `Binary files … differ` (no text hunks). */
  binary?: boolean;
}

/** Which trees `diff()` compares. */
export type DiffInput =
  | { kind: 'unstaged'; pathspecs?: string[] }
  | { kind: 'staged'; ref?: string; pathspecs?: string[] }
  | { kind: 'head-workdir'; pathspecs?: string[] }
  | { kind: 'ref-workdir'; ref: string; pathspecs?: string[] }
  | { kind: 'refs'; oldRef: string; newRef: string; pathspecs?: string[] };

/** Reset modes with real git's index/worktree semantics. */
export type ResetMode = 'soft' | 'mixed' | 'hard';

export interface ResetInput {
  target: string;
  mode: ResetMode;
}

/** Object data returned by `show()`-style reads. */
export type ShowObject =
  | { type: 'blob'; oid: string; content: Uint8Array }
  | { type: 'commit'; oid: string; commit: LogEntry; diff: DiffEntry[] }
  | {
      type: 'tree';
      oid: string;
      entries: { mode: string; path: string; oid: string; type: string }[];
    }
  | {
      type: 'tag';
      oid: string;
      tag: { object: string; type: string; tag: string; message: string };
    };

export interface TagInput {
  name: string;
  object?: string;
  annotated?: boolean;
  message?: string;
  tagger?: GitIdentity;
  force?: boolean;
}

export interface RemoteEntry {
  remote: string;
  url: string;
}

export interface MergeInput {
  theirs: string;
  author: GitIdentity;
  committer?: GitIdentity;
  message?: string;
  fastForwardOnly?: boolean;
}

export interface MergeSummary {
  oid?: string;
  alreadyMerged: boolean;
  fastForward: boolean;
  mergeCommit: boolean;
}

export interface CherryPickInput {
  oid: string;
  committer?: GitIdentity;
}

export type StashOp = 'push' | 'pop' | 'apply' | 'drop' | 'list' | 'clear' | 'create';

export interface StashEntry {
  index: number;
  message: string;
}
