/**
 * `makeGit` — typed facade over isomorphic-git, bound to one VFS-backed repo
 * (`{ fs, dir }`). Exposes LOCAL porcelain only; the NETWORK verbs
 * (clone/fetch/pull/push) loud-throw {@link NotImplementedError} — real
 * smart-HTTP transport lands in a later phase, never a silent stub.
 */
import { NotImplementedError } from '@riftydev/io';
import git, { type FsClient } from 'isomorphic-git';
import type { GitIdentity, LogEntry, MakeGitOptions, StatusEntry } from './types.ts';

const NETWORK_HINT = 'network transport lands in a later phase';

/** Args for {@link Git.commit} — committer defaults to author. */
export interface CommitArgs {
  message: string;
  author: GitIdentity;
  committer?: GitIdentity;
}

/** The facade surface returned by {@link makeGit}. */
export interface Git {
  init(): Promise<void>;
  add(filepath: string): Promise<void>;
  remove(filepath: string): Promise<void>;
  status(): Promise<StatusEntry[]>;
  commit(args: CommitArgs): Promise<string>;
  log(): Promise<LogEntry[]>;
  currentBranch(): Promise<string | undefined>;
  listBranches(): Promise<string[]>;
  resolveRef(ref: string): Promise<string>;
  hashBlob(object: Uint8Array | string): Promise<string>;
  clone(): never;
  fetch(): never;
  pull(): never;
  push(): never;
}

export function makeGit(opts: MakeGitOptions): Git {
  // GitFs is a structural PromiseFsClient; isomorphic-git's FsClient is a union
  // of callback/promise shapes its public types don't narrow on. Cast once here
  // (internal), keeping `opts.fs: GitFs` type-safe at the package boundary.
  const fs = opts.fs as unknown as FsClient;
  const dir = opts.dir;

  return {
    async init() {
      await git.init({ fs, dir, defaultBranch: 'main' });
    },
    async add(filepath) {
      await git.add({ fs, dir, filepath });
    },
    async remove(filepath) {
      await git.remove({ fs, dir, filepath });
    },
    async status() {
      const matrix = await git.statusMatrix({ fs, dir });
      return matrix.map(
        ([filepath, head, workdir, stage]): StatusEntry => ({
          filepath,
          status: `${head}${workdir}${stage}`,
        }),
      );
    },
    async commit({ message, author, committer }) {
      return git.commit({ fs, dir, message, author, committer: committer ?? author });
    },
    async log() {
      const entries = await git.log({ fs, dir });
      return entries.map(
        ({ oid, commit }): LogEntry => ({
          oid,
          message: commit.message,
          author: commit.author,
        }),
      );
    },
    currentBranch() {
      return git.currentBranch({ fs, dir }).then((b) => b || undefined);
    },
    listBranches() {
      return git.listBranches({ fs, dir });
    },
    resolveRef(ref) {
      return git.resolveRef({ fs, dir, ref });
    },
    async hashBlob(object) {
      const blob = typeof object === 'string' ? new TextEncoder().encode(object) : object;
      const { oid } = await git.hashBlob({ object: blob });
      return oid;
    },
    clone(): never {
      throw new NotImplementedError('git.clone', NETWORK_HINT);
    },
    fetch(): never {
      throw new NotImplementedError('git.fetch', NETWORK_HINT);
    },
    pull(): never {
      throw new NotImplementedError('git.pull', NETWORK_HINT);
    },
    push(): never {
      throw new NotImplementedError('git.push', NETWORK_HINT);
    },
  };
}
