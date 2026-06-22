/**
 * `makeGit` — typed facade over isomorphic-git, bound to one VFS-backed repo
 * (`{ fs, dir }`). Exposes LOCAL porcelain only; the NETWORK verbs
 * (clone/fetch/pull/push) loud-throw {@link NotImplementedError} — real
 * smart-HTTP transport lands in a later phase, never a silent stub.
 */
import { NotImplementedError } from '@riftydev/io';
import git, { type FsClient, type WalkerEntry } from 'isomorphic-git';
import { lineDiff } from './line-diff.ts';
import type { DiffEntry, GitIdentity, LogEntry, MakeGitOptions, StatusEntry } from './types.ts';

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
  diff(): Promise<DiffEntry[]>;
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
    async diff() {
      // No `git.diff` exists — walk HEAD tree (left) vs WORKDIR (right) and
      // classify each path. walk() semantics: returning `null` from map PRUNES
      // the subtree (children unwalked); returning `undefined` skips just this
      // path but still descends. So trees / unchanged blobs → `undefined`
      // (descend, contribute nothing); `.git` → `null` (prune, never recurse).
      const decoder = new TextDecoder();
      const decode = async (entry: WalkerEntry | null): Promise<string> => {
        if (!entry) return '';
        if ((await entry.type()) !== 'blob') return '';
        const content = await entry.content();
        return content ? decoder.decode(content) : '';
      };

      const entries = await git.walk({
        fs,
        dir,
        trees: [git.TREE({ ref: 'HEAD' }), git.WORKDIR()],
        map: async (filepath, walkEntries): Promise<DiffEntry | undefined | null> => {
          if (filepath === '.') return undefined; // root — descend, emit nothing
          if (filepath === '.git') return null; // prune the repo metadata subtree
          const head = walkEntries[0] ?? null;
          const work = walkEntries[1] ?? null;
          const headBlob = head && (await head.type()) === 'blob';
          const workBlob = work && (await work.type()) === 'blob';

          // Both blobs: compare oids; equal → unchanged (descend nothing).
          if (headBlob && workBlob) {
            const [headOid, workOid] = await Promise.all([head.oid(), work.oid()]);
            if (headOid === workOid) return undefined;
            const [oldText, newText] = await Promise.all([decode(head), decode(work)]);
            return { filepath, change: 'modify', hunks: lineDiff(oldText, newText) };
          }
          // HEAD-only blob → deleted from workdir (all old lines removed).
          if (headBlob && !workBlob) {
            const oldText = await decode(head);
            return { filepath, change: 'delete', hunks: lineDiff(oldText, '') };
          }
          // WORKDIR-only blob → added (all new lines added).
          if (!headBlob && workBlob) {
            const newText = await decode(work);
            return { filepath, change: 'add', hunks: lineDiff('', newText) };
          }
          // Trees (descend into children) or non-blob specials — emit nothing.
          return undefined;
        },
      });
      return entries as DiffEntry[];
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
