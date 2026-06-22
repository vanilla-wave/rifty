/**
 * `makeGit` — typed facade over isomorphic-git, bound to one VFS-backed repo
 * (`{ fs, dir }`). LOCAL porcelain + the NETWORK verbs (clone/fetch/pull/push)
 * over smart-HTTP via `@riftydev/net`. Non-smart-HTTP transports (ssh/git/…) and
 * the browser cross-origin-without-proxy wall loud-throw {@link NotImplementedError}
 * (see {@link assertSupportedTransport} / {@link assertCorsReachable}) — never a
 * silent stub. Underlying isomorphic-git network errors surface via
 * {@link mapGitNetworkError} (rethrown, never swallowed).
 */
import git, { type FsClient, type HttpClient, type WalkerEntry } from 'isomorphic-git';
import { getGitCorsProxyUrl } from './cors-proxy.ts';
import {
  BranchExistsError,
  CheckoutConflictError,
  PathspecError,
  assertCorsReachable,
  assertSupportedTransport,
  mapGitNetworkError,
} from './errors.ts';
import { riftyGitHttp } from './http-plugin.ts';
import { lineDiff } from './line-diff.ts';
import type {
  CheckoutInput,
  CheckoutResult,
  CloneArgs,
  DiffEntry,
  FetchArgs,
  GitIdentity,
  LogEntry,
  MakeGitOptions,
  PullArgs,
  PushArgs,
  StatusEntry,
} from './types.ts';

/** Args for {@link Git.commit} — committer defaults to author; `amend` replaces HEAD. */
export interface CommitArgs {
  message: string;
  author: GitIdentity;
  committer?: GitIdentity;
  /** Replace HEAD instead of adding a child (parent preserved). For `commit --amend`. */
  amend?: boolean;
}

/** A pathspec `spec` matches `path` exactly or as a directory prefix (`<spec>/…`). */
export const pathspecMatch = (path: string, spec: string): boolean =>
  path === spec || path.startsWith(`${spec}/`);

/** First pathspec matching no path in `files` (for the PathspecError message). */
function firstUnmatched(specs: string[], files: string[]): string {
  return specs.find((s) => !files.some((p) => pathspecMatch(p, s))) ?? specs[0] ?? '';
}

/** The facade surface returned by {@link makeGit}. */
export interface Git {
  init(): Promise<void>;
  add(filepath: string): Promise<void>;
  remove(filepath: string): Promise<void>;
  status(): Promise<StatusEntry[]>;
  commit(args: CommitArgs): Promise<string>;
  log(): Promise<LogEntry[]>;
  /** Read a local git config value (`getConfig`), undefined if unset. */
  getConfig(path: string): Promise<string | undefined>;
  /** Write a local git config value into `.git/config`. */
  setConfig(path: string, value: string): Promise<void>;
  /** Unstage one file (index stage 2→0), HEAD untouched. For `restore --staged`/`reset <file>`. */
  unstage(filepath: string): Promise<void>;
  currentBranch(): Promise<string | undefined>;
  listBranches(): Promise<string[]>;
  resolveRef(ref: string): Promise<string>;
  hashBlob(object: Uint8Array | string): Promise<string>;
  /** Paths tracked in the index (or in `ref`'s tree, unused here). */
  listFiles(): Promise<string[]>;
  /** Switch branch / detach HEAD, or restore worktree paths. See {@link CheckoutInput}. */
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  diff(): Promise<DiffEntry[]>;
  /** Clone a smart-HTTP remote into `dir`. ssh/git/… → NotImplementedError. */
  clone(args: CloneArgs): Promise<void>;
  /** Fetch from a remote (`url` optional → remote config). */
  fetch(args?: FetchArgs): Promise<void>;
  /** Fetch + merge into the current branch (`url` optional → remote config). */
  pull(args: PullArgs & { author: GitIdentity }): Promise<void>;
  /** Push refs to a remote (`url`/`remote` optional → remote config). */
  push(args?: PushArgs): Promise<void>;
}

export function makeGit(opts: MakeGitOptions): Git {
  // GitFs is a structural PromiseFsClient; isomorphic-git's FsClient is a union
  // of callback/promise shapes its public types don't narrow on. Cast once here
  // (internal), keeping `opts.fs: GitFs` type-safe at the package boundary.
  const fs = opts.fs as unknown as FsClient;
  const dir = opts.dir;
  // Resolve the network transport once: http plugin, CORS proxy (D-004), and an
  // onAuth bridge from our narrowed GitAuthProvider to isomorphic-git's callback.
  // The plugin's `request.signal` is typed `AbortSignal` (narrower + more correct
  // than isomorphic-git's `signal?: object`); param-contravariance rejects the
  // narrowing, so cast once here at the boundary (same pattern as `fs` above).
  const http = (opts.http ?? riftyGitHttp()) as unknown as HttpClient;
  const corsProxy = opts.corsProxy ?? getGitCorsProxyUrl();
  const onAuth = opts.onAuth
    ? (url: string): { username: string; password?: string } | undefined => opts.onAuth?.(url)
    : undefined;

  const curBranch = (): Promise<string | undefined> =>
    git.currentBranch({ fs, dir }).then((b) => b || undefined);

  /** Worktree absolute path for a repo-relative `path` (single-slash join). */
  const abs = (path: string): string => `${dir}/${path}`.replace(/\/+/g, '/');

  /** `path` matches any of `specs` (exact or directory-prefix). */
  const specMatches = (path: string, specs: string[]): boolean =>
    specs.some((s) => pathspecMatch(path, s));

  async function switchRef(
    input: Extract<CheckoutInput, { op: 'switch' }>,
  ): Promise<CheckoutResult> {
    const { ref, create, startPoint, force } = input;
    // previousRef: branch name, else the detached oid (best-effort; undefined if no HEAD yet).
    const prevBranch = await curBranch();
    const previousRef =
      prevBranch ?? (await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => undefined));

    let created = false;
    let alreadyOn = false;
    if (create) {
      if ((await git.listBranches({ fs, dir })).includes(ref)) throw new BranchExistsError(ref);
      await git.branch({
        fs,
        dir,
        ref,
        checkout: true,
        ...(startPoint ? { object: startPoint } : {}),
      });
      created = true;
    } else {
      alreadyOn = ref === (await curBranch());
      try {
        await git.checkout({ fs, dir, ref, force });
      } catch (e) {
        if (e instanceof git.Errors.CheckoutConflictError) {
          throw new CheckoutConflictError(e.data.filepaths);
        }
        throw e;
      }
    }

    const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const after = await curBranch();
    const detached = after === undefined;
    const target = detached ? undefined : created ? ref : after;
    const headSubject =
      (await git.log({ fs, dir, depth: 1 }))[0]?.commit.message.split('\n', 1)[0] ?? '';
    return { op: 'switch', target, oid, detached, created, alreadyOn, previousRef, headSubject };
  }

  /** Every pathspec must match ≥1 file, else PathspecError (all-or-nothing, real git). */
  const assertAllMatched = (specs: string[], files: string[]): void => {
    if (specs.some((s) => !files.some((p) => pathspecMatch(p, s)))) {
      throw new PathspecError(firstUnmatched(specs, files));
    }
  };

  async function restore(
    input: Extract<CheckoutInput, { op: 'restore' }>,
  ): Promise<CheckoutResult> {
    const { pathspecs, source } = input;
    if (source !== undefined) {
      // From a tree-ish: resolve the SYMBOLIC source (branch/tag/HEAD) to an oid —
      // readBlob doesn't resolve refs, only resolveRef does. Validate every
      // pathspec matched (all-or-nothing) BEFORE writing, then write + sync index.
      const oid = await git.resolveRef({ fs, dir, ref: source });
      const treeFiles = await git.listFiles({ fs, dir, ref: source });
      assertAllMatched(pathspecs, treeFiles);
      const restored = treeFiles.filter((p) => specMatches(p, pathspecs));
      for (const filepath of restored) {
        const { blob } = await git.readBlob({ fs, dir, oid, filepath });
        await opts.fs.promises.writeFile(abs(filepath), blob);
        await git.add({ fs, dir, filepath });
      }
      return { op: 'restore', restored };
    }
    // From the INDEX (no iso-git primitive): walk STAGE for matched BLOBs (a dir
    // pathspec descends into the tree, restoring each child). Two passes —
    // collect+validate (all-or-nothing) BEFORE writing. HEAD + index untouched.
    const staged: { filepath: string; oid: string }[] = [];
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (filepath, [entry]): Promise<void> => {
        // Non-blob (tree) → return undefined to DESCEND; blob children match via
        // the `<spec>/` dir-prefix rule. Only blobs carry an oid to restore.
        if (!entry || (await entry.type()) !== 'blob' || !specMatches(filepath, pathspecs)) return;
        staged.push({ filepath, oid: await entry.oid() });
      },
    });
    assertAllMatched(
      pathspecs,
      staged.map((s) => s.filepath),
    );
    for (const { filepath, oid } of staged) {
      const { blob } = await git.readBlob({ fs, dir, oid });
      await opts.fs.promises.writeFile(abs(filepath), blob);
    }
    return { op: 'restore', restored: staged.map((s) => s.filepath) };
  }

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
    async commit({ message, author, committer, amend }) {
      return git.commit({
        fs,
        dir,
        message,
        author,
        committer: committer ?? author,
        ...(amend ? { amend } : {}),
      });
    },
    getConfig(path) {
      return git.getConfig({ fs, dir, path });
    },
    async setConfig(path, value) {
      await git.setConfig({ fs, dir, path, value });
    },
    async unstage(filepath) {
      await git.resetIndex({ fs, dir, filepath });
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
      return curBranch();
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
    listFiles() {
      return git.listFiles({ fs, dir });
    },
    async checkout(input): Promise<CheckoutResult> {
      if (input.op === 'switch') return switchRef(input);
      return restore(input);
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
    async clone(args) {
      assertSupportedTransport(args.url);
      assertCorsReachable(args.url, corsProxy);
      try {
        await git.clone({
          fs,
          http,
          dir,
          url: args.url,
          corsProxy,
          ref: args.ref,
          singleBranch: args.singleBranch,
          depth: args.depth,
          noCheckout: args.noCheckout,
          onAuth,
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
    async fetch(args = {}) {
      if (args.url !== undefined) {
        assertSupportedTransport(args.url);
        assertCorsReachable(args.url, corsProxy);
      }
      try {
        await git.fetch({
          fs,
          http,
          dir,
          url: args.url,
          corsProxy,
          ref: args.ref,
          singleBranch: args.singleBranch,
          depth: args.depth,
          onAuth,
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
    async pull(args) {
      if (args.url !== undefined) {
        assertSupportedTransport(args.url);
        assertCorsReachable(args.url, corsProxy);
      }
      try {
        await git.pull({
          fs,
          http,
          dir,
          url: args.url,
          corsProxy,
          ref: args.ref,
          singleBranch: args.singleBranch,
          author: args.author,
          onAuth,
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
    async push(args = {}) {
      if (args.url !== undefined) {
        assertSupportedTransport(args.url);
        assertCorsReachable(args.url, corsProxy);
      }
      try {
        await git.push({
          fs,
          http,
          dir,
          url: args.url,
          corsProxy,
          remote: args.remote,
          ref: args.ref,
          force: args.force,
          onAuth,
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
  };
}
