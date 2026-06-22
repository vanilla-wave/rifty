export { type GitFs, type GitStat, vfsToGitFs } from './fs-adapter.ts';
export { makeGit } from './git.ts';
export type {
  DiffChange,
  DiffEntry,
  DiffHunk,
  GitIdentity,
  LogEntry,
  MakeGitOptions,
  StatusEntry,
} from './types.ts';
