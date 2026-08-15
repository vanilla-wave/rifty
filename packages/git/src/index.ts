export { getGitCorsProxyUrl } from './cors-proxy.ts';
export {
  assertCorsReachable,
  assertSupportedTransport,
  BranchExistsError,
  CheckoutConflictError,
  isGitNotFound,
  mapGitNetworkError,
  PathspecError,
} from './errors.ts';
export { EMPTY_COMMIT_MESSAGE_ERROR, commitRefusal } from './commit-refusal.ts';
export { type GitFs, type GitStat, vfsToGitFs } from './fs-adapter.ts';
export { makeGit } from './git.ts';
export { pathspecMatch } from './pathspec.ts';
export {
  isGitStatusMatrixCode,
  isGitPorcelainXY,
  porcelainStatusLines,
  requireSupportedStatusEntries,
} from './status.ts';
export type { GitPorcelainXY, GitStatusMatrixCode } from './status.ts';
export {
  type GitHttp,
  type GitHttpRequest,
  type GitHttpResponse,
  riftyGitHttp,
} from './http-plugin.ts';
export type {
  CheckoutInput,
  CheckoutResult,
  CherryPickInput,
  CloneArgs,
  DiffChange,
  DiffEntry,
  DiffHunk,
  DiffInput,
  FetchArgs,
  GitAuthProvider,
  GitIdentity,
  LogEntry,
  LogOptions,
  MakeGitOptions,
  MergeInput,
  MergeSummary,
  PullArgs,
  PushArgs,
  RemoteEntry,
  ResetInput,
  ResetMode,
  ShowObject,
  StashEntry,
  StashOp,
  StatusEntry,
  SupportedStatusEntry,
  TagInput,
  UnsupportedStatusEntry,
} from './types.ts';
