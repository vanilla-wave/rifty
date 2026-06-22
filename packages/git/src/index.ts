export { getGitCorsProxyUrl } from './cors-proxy.ts';
export {
  AmbiguousArgError,
  assertCorsReachable,
  assertSupportedTransport,
  BranchExistsError,
  CheckoutConflictError,
  mapGitNetworkError,
  PathspecError,
} from './errors.ts';
export { type GitFs, type GitStat, vfsToGitFs } from './fs-adapter.ts';
export { makeGit } from './git.ts';
export {
  type GitHttp,
  type GitHttpRequest,
  type GitHttpResponse,
  riftyGitHttp,
} from './http-plugin.ts';
export type {
  CheckoutInput,
  CheckoutResult,
  CloneArgs,
  DiffChange,
  DiffEntry,
  DiffHunk,
  FetchArgs,
  GitAuthProvider,
  GitIdentity,
  LogEntry,
  MakeGitOptions,
  PullArgs,
  PushArgs,
  StatusEntry,
} from './types.ts';
