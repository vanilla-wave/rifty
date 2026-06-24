/**
 * `makeGit` — typed facade over isomorphic-git, bound to one VFS-backed repo
 * (`{ fs, dir }`). LOCAL porcelain + the NETWORK verbs (clone/fetch/pull/push)
 * over smart-HTTP via `@riftydev/net`. Non-smart-HTTP transports (ssh/git/…) and
 * the browser cross-origin-without-proxy wall loud-throw {@link NotImplementedError}
 * (see {@link assertSupportedTransport} / {@link assertCorsReachable}) — never a
 * silent stub. Underlying isomorphic-git network errors surface via
 * {@link mapGitNetworkError} (rethrown, never swallowed).
 */
import { NotImplementedError } from '@riftydev/io';
import git, {
  type FsClient,
  type HttpClient,
  type MergeResult,
  type ServerRef,
  type TreeEntry,
  type Walker,
  type WalkerEntry,
} from 'isomorphic-git';
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
  CherryPickInput,
  CloneArgs,
  DiffEntry,
  DiffInput,
  FetchArgs,
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
  ShowObject,
  StashEntry,
  StashOp,
  StatusEntry,
  TagInput,
} from './types.ts';

/** Args for {@link Git.commit} — committer defaults to author; `amend` replaces HEAD. */
export interface CommitArgs {
  message: string;
  author: GitIdentity;
  committer?: GitIdentity;
  parents?: string[];
  /** Replace HEAD instead of adding a child (parent preserved). For `commit --amend`. */
  amend?: boolean;
}

/** A pathspec `spec` matches `path` exactly or as a directory prefix (`<spec>/…`). */
export const pathspecMatch = (path: string, spec: string): boolean => {
  const normalized = spec.replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') return true;
  return path === normalized || path.startsWith(`${normalized}/`);
};

interface BlobRef {
  filepath: string;
  oid: string;
}

/** git's binary heuristic: a NUL byte in the first 8000 bytes ⇒ binary. */
function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** First pathspec matching no path in `files` (for the PathspecError message). */
function firstUnmatched(specs: string[], files: string[]): string {
  return specs.find((s) => !files.some((p) => pathspecMatch(p, s))) ?? specs[0] ?? '';
}

/** The facade surface returned by {@link makeGit}. */
export interface Git {
  init(): Promise<void>;
  add(filepath: string, opts?: { force?: boolean }): Promise<void>;
  remove(filepath: string): Promise<void>;
  status(): Promise<StatusEntry[]>;
  commit(args: CommitArgs): Promise<string>;
  log(args?: LogOptions): Promise<LogEntry[]>;
  /** Read a local git config value (`getConfig`), undefined if unset. */
  getConfig(path: string): Promise<string | undefined>;
  /** Write a local git config value into `.git/config`. */
  setConfig(path: string, value: string): Promise<void>;
  /** Unstage one file (index stage 2→0), HEAD untouched. For `restore --staged`/`reset <file>`. */
  unstage(filepath: string): Promise<void>;
  currentBranch(): Promise<string | undefined>;
  listBranches(): Promise<string[]>;
  resolveRef(ref: string): Promise<string>;
  resolveRevision(rev: string): Promise<string>;
  hashBlob(object: Uint8Array | string): Promise<string>;
  /** Paths tracked in the index (or in `ref`'s tree, unused here). */
  listFiles(): Promise<string[]>;
  /** Switch branch / detach HEAD, or restore worktree paths. See {@link CheckoutInput}. */
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  diff(input?: DiffInput): Promise<DiffEntry[]>;
  reset(input: ResetInput): Promise<void>;
  show(rev: string): Promise<ShowObject>;
  listTags(): Promise<string[]>;
  createTag(input: TagInput): Promise<void>;
  deleteTag(name: string): Promise<void>;
  listRemotes(): Promise<RemoteEntry[]>;
  addRemote(remote: string, url: string): Promise<void>;
  deleteRemote(remote: string): Promise<void>;
  lsRemote(args: { url: string; prefix?: string; forPush?: boolean }): Promise<ServerRef[]>;
  merge(input: MergeInput): Promise<MergeSummary>;
  cherryPick(input: CherryPickInput): Promise<string>;
  stash(op: StashOp, message?: string, refIdx?: number): Promise<string | StashEntry[] | undefined>;
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

  const toLogEntry = ({
    oid,
    commit,
  }: {
    oid: string;
    commit: {
      message: string;
      author: GitIdentity;
      committer: GitIdentity;
      tree: string;
      parent: string[];
    };
  }): LogEntry => ({
    oid,
    message: commit.message,
    author: commit.author,
    committer: commit.committer,
    tree: commit.tree,
    parents: commit.parent,
  });

  const readCommit = async (oid: string): Promise<LogEntry> =>
    toLogEntry(await git.readCommit({ fs, dir, oid: await peelTagToCommit(oid) }));

  const resolvePlain = async (ref: string): Promise<string> => {
    if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
    if (/^[0-9a-f]{4,39}$/i.test(ref)) {
      return git.expandOid({ fs, dir, oid: ref });
    }
    return git.resolveRef({ fs, dir, ref });
  };

  const peelTag = async (oid: string): Promise<{ oid: string; type: string }> => {
    let current = oid;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(current)) throw new Error(`tag cycle while peeling ${oid}`);
      seen.add(current);
      const obj = await git.readObject({ fs, dir, oid: current, format: 'parsed' });
      if (obj.type !== 'tag') return { oid: current, type: obj.type };
      const tag = obj.object as { object: string };
      current = tag.object;
    }
  };

  const peelTagToCommit = async (oid: string): Promise<string> => {
    const peeled = await peelTag(oid);
    if (peeled.type !== 'commit') {
      throw new Error(`object ${peeled.oid} is a ${peeled.type}, not a commit`);
    }
    return peeled.oid;
  };

  const resolveRevision = async (rev: string): Promise<string> => {
    if (rev.includes('@{')) {
      throw new NotImplementedError('git.revspec.reflog', `unsupported reflog revspec: ${rev}`);
    }
    if (/\^\{/.test(rev)) {
      throw new NotImplementedError('git.revspec.peel', `unsupported peel revspec: ${rev}`);
    }
    const firstMarker = rev.search(/[~^]/);
    if (firstMarker === -1) return peelTagToCommit(await resolvePlain(rev));
    let oid = await peelTagToCommit(await resolvePlain(rev.slice(0, firstMarker)));
    let i = firstMarker;
    while (i < rev.length) {
      const op = rev[i];
      i += 1;
      let digits = '';
      while (i < rev.length && /\d/.test(rev[i] as string)) {
        digits += rev[i] as string;
        i += 1;
      }
      if (digits === '' && i < rev.length && /[{}:A-Za-z_/-]/.test(rev[i] as string)) {
        throw new NotImplementedError('git.revspec.syntax', `unsupported revspec: ${rev}`);
      }
      const commit = await readCommit(oid);
      if (op === '~') {
        const n = digits === '' ? 1 : Number(digits);
        for (let step = 0; step < n; step++) {
          const c = step === 0 ? commit : await readCommit(oid);
          const parent = c.parents[0];
          if (parent === undefined) throw new Error(`revision ${rev} has no parent`);
          oid = parent;
        }
      } else if (op === '^') {
        if (digits !== '' && Number(digits) === 0) continue;
        const parentIndex = digits === '' ? 0 : Number(digits) - 1;
        const parent = commit.parents[parentIndex];
        if (parent === undefined)
          throw new Error(`revision ${rev} has no parent ${parentIndex + 1}`);
        oid = parent;
      } else {
        throw new NotImplementedError('git.revspec.syntax', `unsupported revspec: ${rev}`);
      }
    }
    return oid;
  };

  const resolveObjectRevision = async (rev: string): Promise<string> => {
    if (rev.includes('@{')) {
      throw new NotImplementedError('git.revspec.reflog', `unsupported reflog revspec: ${rev}`);
    }
    if (/\^\{/.test(rev)) {
      throw new NotImplementedError('git.revspec.peel', `unsupported peel revspec: ${rev}`);
    }
    return rev.search(/[~^]/) === -1 ? resolvePlain(rev) : resolveRevision(rev);
  };

  const allTreeBlobs = async (ref: string): Promise<BlobRef[]> => {
    const blobs: BlobRef[] = [];
    await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref })],
      map: async (filepath, [entry]): Promise<void> => {
        if (filepath === '.' || !entry || (await entry.type()) !== 'blob') return;
        blobs.push({ filepath, oid: await entry.oid() });
      },
    });
    return blobs;
  };

  const allStageBlobs = async (): Promise<BlobRef[]> => {
    const blobs: BlobRef[] = [];
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (filepath, [entry]): Promise<void> => {
        if (filepath === '.' || !entry || (await entry.type()) !== 'blob') return;
        blobs.push({ filepath, oid: await entry.oid() });
      },
    });
    return blobs;
  };

  const treeBlobsOrEmpty = async (ref: string): Promise<BlobRef[]> => {
    try {
      return await allTreeBlobs(await resolveRevision(ref));
    } catch (e) {
      if (
        ref === 'HEAD' &&
        e instanceof Error &&
        /Could not find|NotFound|resolve/.test(e.message)
      ) {
        return [];
      }
      throw e;
    }
  };

  const blobMapDiff = async (
    oldBlobs: BlobRef[],
    newBlobs: BlobRef[],
    pathspecs: string[] = [],
  ): Promise<DiffEntry[]> => {
    const decoder = new TextDecoder();
    const oldMap = new Map(oldBlobs.map((b) => [b.filepath, b.oid]));
    const newMap = new Map(newBlobs.map((b) => [b.filepath, b.oid]));
    const allPaths = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
    const entries: DiffEntry[] = [];
    for (const filepath of allPaths) {
      if (pathspecs.length > 0 && !specMatches(filepath, pathspecs)) continue;
      const oldOid = oldMap.get(filepath);
      const newOid = newMap.get(filepath);
      if (oldOid === newOid) continue;
      const [oldBytes, newBytes] = await Promise.all([
        oldOid === undefined
          ? Promise.resolve(undefined)
          : git.readBlob({ fs, dir, oid: oldOid }).then((r) => r.blob),
        newOid === undefined
          ? Promise.resolve(undefined)
          : git.readBlob({ fs, dir, oid: newOid }).then((r) => r.blob),
      ]);
      if (oldBytes === undefined && newBytes !== undefined) {
        entries.push(
          isBinary(newBytes)
            ? { filepath, change: 'add', hunks: [], binary: true }
            : { filepath, change: 'add', hunks: lineDiff('', decoder.decode(newBytes)) },
        );
      } else if (oldBytes !== undefined && newBytes === undefined) {
        entries.push(
          isBinary(oldBytes)
            ? { filepath, change: 'delete', hunks: [], binary: true }
            : { filepath, change: 'delete', hunks: lineDiff(decoder.decode(oldBytes), '') },
        );
      } else if (oldBytes !== undefined && newBytes !== undefined) {
        entries.push(
          isBinary(oldBytes) || isBinary(newBytes)
            ? { filepath, change: 'modify', hunks: [], binary: true }
            : {
                filepath,
                change: 'modify',
                hunks: lineDiff(decoder.decode(oldBytes), decoder.decode(newBytes)),
              },
        );
      }
    }
    return entries;
  };

  const ensureParentDirs = async (filepath: string): Promise<void> => {
    const full = abs(filepath);
    const parts = full.split('/').filter((p) => p.length > 0);
    let cur = '';
    for (const part of parts.slice(0, -1)) {
      cur = `${cur}/${part}`;
      await opts.fs.promises.mkdir(cur).catch(() => undefined);
    }
  };

  const entryBytes = async (entry: WalkerEntry): Promise<Uint8Array> => {
    const content = await entry.content();
    if (content !== undefined) return content;
    const { blob } = await git.readBlob({ fs, dir, oid: await entry.oid() });
    return blob;
  };

  const diffWalk = async (
    oldTree: Walker,
    newTree: Walker,
    pathspecs: string[] = [],
    workdirAddPaths?: Set<string>,
    workdirMode: 'suppress-adds' | 'tracked-only' = 'suppress-adds',
  ): Promise<DiffEntry[]> => {
    const decoder = new TextDecoder();
    const entries = await git.walk({
      fs,
      dir,
      trees: [oldTree, newTree],
      map: async (filepath, walkEntries): Promise<DiffEntry | undefined | null> => {
        if (filepath === '.') return undefined;
        if (filepath === '.git') return null;
        const oldEntry = walkEntries[0] ?? null;
        let newEntry = walkEntries[1] ?? null;
        const oldBlob = oldEntry && (await oldEntry.type()) === 'blob';
        let newBlob = newEntry && (await newEntry.type()) === 'blob';
        if (
          newBlob &&
          workdirAddPaths !== undefined &&
          workdirMode === 'tracked-only' &&
          !workdirAddPaths.has(filepath)
        ) {
          newEntry = null;
          newBlob = false;
        }
        if (pathspecs.length > 0 && !specMatches(filepath, pathspecs)) return undefined;

        if (oldBlob && newBlob && newEntry !== null) {
          const [oldOid, newOid] = await Promise.all([oldEntry.oid(), newEntry.oid()]);
          if (oldOid === newOid) return undefined;
          const [oldBytes, newBytes] = await Promise.all([
            entryBytes(oldEntry),
            entryBytes(newEntry),
          ]);
          if (isBinary(oldBytes) || isBinary(newBytes)) {
            return { filepath, change: 'modify', hunks: [], binary: true };
          }
          return {
            filepath,
            change: 'modify',
            hunks: lineDiff(decoder.decode(oldBytes), decoder.decode(newBytes)),
          };
        }
        if (oldBlob && !newBlob) {
          const oldBytes = await entryBytes(oldEntry);
          if (isBinary(oldBytes)) return { filepath, change: 'delete', hunks: [], binary: true };
          return { filepath, change: 'delete', hunks: lineDiff(decoder.decode(oldBytes), '') };
        }
        if (!oldBlob && newBlob && newEntry !== null) {
          if (workdirAddPaths !== undefined && !workdirAddPaths.has(filepath)) return undefined;
          const newBytes = await entryBytes(newEntry);
          if (isBinary(newBytes)) return { filepath, change: 'add', hunks: [], binary: true };
          return { filepath, change: 'add', hunks: lineDiff('', decoder.decode(newBytes)) };
        }
        if (newEntry && (await newEntry.type()) === 'tree') {
          const ignored = await git.isIgnored({ fs, dir, filepath }).catch(() => false);
          return ignored ? null : undefined;
        }
        return undefined;
      },
    });
    return entries as DiffEntry[];
  };

  const resetIndexTo = async (ref: string): Promise<void> => {
    const [current, target] = await Promise.all([git.listFiles({ fs, dir }), allTreeBlobs(ref)]);
    const targetPaths = new Set(target.map((b) => b.filepath));
    for (const filepath of current) {
      if (!targetPaths.has(filepath))
        await git.remove({ fs, dir, filepath }).catch(() => undefined);
    }
    for (const { filepath } of target) {
      await git.resetIndex({ fs, dir, filepath, ref });
    }
  };

  const resetWorkdirTo = async (ref: string): Promise<void> => {
    const [current, target] = await Promise.all([git.listFiles({ fs, dir }), allTreeBlobs(ref)]);
    const targetPaths = new Set(target.map((b) => b.filepath));
    for (const filepath of current) {
      if (!targetPaths.has(filepath)) {
        await opts.fs.promises.unlink(abs(filepath)).catch(() => undefined);
      }
    }
    for (const { filepath, oid } of target) {
      const { blob } = await git.readBlob({ fs, dir, oid });
      await ensureParentDirs(filepath);
      await opts.fs.promises.writeFile(abs(filepath), blob);
    }
  };

  const moveHeadTo = async (oid: string): Promise<void> => {
    const branch = await curBranch();
    await git.writeRef({
      fs,
      dir,
      ref: branch ? `refs/heads/${branch}` : 'HEAD',
      value: await peelTagToCommit(oid),
      force: true,
    });
  };

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
        ...(startPoint ? { object: await resolveRevision(startPoint) } : {}),
      });
      created = true;
    } else {
      alreadyOn = ref === (await curBranch());
      try {
        const branches = await git.listBranches({ fs, dir });
        const checkoutRef = branches.includes(ref)
          ? ref
          : await resolveRevision(ref).catch(() => ref);
        await git.checkout({ fs, dir, ref: checkoutRef, force });
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
      const oid = await resolveRevision(source);
      const treeFiles = await git.listFiles({ fs, dir, ref: oid });
      assertAllMatched(pathspecs, treeFiles);
      const restored = treeFiles.filter((p) => specMatches(p, pathspecs));
      for (const filepath of restored) {
        const { blob } = await git.readBlob({ fs, dir, oid, filepath });
        await ensureParentDirs(filepath);
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
      await ensureParentDirs(filepath);
      await opts.fs.promises.writeFile(abs(filepath), blob);
    }
    return { op: 'restore', restored: staged.map((s) => s.filepath) };
  }

  return {
    async init() {
      await git.init({ fs, dir, defaultBranch: 'main' });
    },
    async add(filepath, addOpts = {}) {
      await git.add({ fs, dir, filepath, ...(addOpts.force ? { force: true } : {}) });
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
    async commit({ message, author, committer, parents, amend }) {
      return git.commit({
        fs,
        dir,
        message,
        author,
        committer: committer ?? author,
        ...(parents ? { parent: parents } : {}),
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
    async log(args = {}) {
      if (args.depth === 0) return [];
      const ref = args.ref ? await resolveRevision(args.ref) : undefined;
      const entries = await git.log({
        fs,
        dir,
        ...(ref ? { ref } : {}),
        ...(args.depth !== undefined ? { depth: args.depth } : {}),
        ...(args.filepath !== undefined ? { filepath: args.filepath } : {}),
      });
      return entries.map(toLogEntry);
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
    resolveRevision,
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
    async diff(input = { kind: 'unstaged' }) {
      switch (input.kind) {
        case 'unstaged':
          return diffWalk(git.STAGE(), git.WORKDIR(), input.pathspecs, new Set());
        case 'staged':
          return blobMapDiff(
            await treeBlobsOrEmpty(input.ref ?? 'HEAD'),
            await allStageBlobs(),
            input.pathspecs,
          );
        case 'head-workdir': {
          const indexPaths = new Set(await git.listFiles({ fs, dir }));
          return diffWalk(
            git.TREE({ ref: 'HEAD' }),
            git.WORKDIR(),
            input.pathspecs,
            indexPaths,
            'tracked-only',
          );
        }
        case 'ref-workdir': {
          const indexPaths = new Set(await git.listFiles({ fs, dir }));
          return diffWalk(
            git.TREE({ ref: await resolveRevision(input.ref) }),
            git.WORKDIR(),
            input.pathspecs,
            indexPaths,
            'tracked-only',
          );
        }
        case 'refs':
          return blobMapDiff(
            await allTreeBlobs(await resolveRevision(input.oldRef)),
            await allTreeBlobs(await resolveRevision(input.newRef)),
            input.pathspecs,
          );
      }
    },
    async reset(input) {
      const oid = await resolveRevision(input.target);
      if (input.mode === 'hard') await resetWorkdirTo(oid);
      if (input.mode !== 'soft') await resetIndexTo(oid);
      await moveHeadTo(oid);
    },
    async show(rev) {
      const colon = rev.indexOf(':');
      if (colon > 0) {
        const oid = await resolveRevision(rev.slice(0, colon));
        const filepath = rev.slice(colon + 1);
        const { blob } = await git.readBlob({ fs, dir, oid, filepath });
        const { oid: blobOid } = await git.hashBlob({ object: blob });
        return { type: 'blob', oid: blobOid, content: blob };
      }
      const oid = await resolveObjectRevision(rev);
      const obj = await git.readObject({ fs, dir, oid, format: 'parsed' });
      if (obj.type === 'commit') {
        const commit = await readCommit(oid);
        const parent = commit.parents[0];
        return {
          type: 'commit',
          oid,
          commit,
          diff: await blobMapDiff(
            parent === undefined ? [] : await allTreeBlobs(parent),
            await allTreeBlobs(oid),
          ),
        };
      }
      if (obj.type === 'blob') {
        const { blob } = await git.readBlob({ fs, dir, oid });
        return { type: 'blob', oid, content: blob };
      }
      if (obj.type === 'tree') {
        const { tree } = await git.readTree({ fs, dir, oid });
        return {
          type: 'tree',
          oid,
          entries: tree.map((e: TreeEntry) => ({
            mode: e.mode,
            path: e.path,
            oid: e.oid,
            type: e.type,
          })),
        };
      }
      if (obj.type === 'tag') {
        const tag = obj.object as { object: string; type: string; tag: string; message: string };
        return {
          type: 'tag',
          oid,
          tag: { object: tag.object, type: tag.type, tag: tag.tag, message: tag.message },
        };
      }
      const { blob } = await git.readBlob({ fs, dir, oid });
      return { type: 'blob', oid, content: blob };
    },
    listTags() {
      return git.listTags({ fs, dir });
    },
    async createTag(input) {
      if (input.annotated) {
        if (input.message === undefined) {
          throw new NotImplementedError('git.tag.editor', 'annotated tag message requires editor');
        }
        await git.annotatedTag({
          fs,
          dir,
          ref: input.name,
          message: input.message,
          ...(input.object ? { object: input.object } : {}),
          ...(input.tagger ? { tagger: input.tagger } : {}),
          ...(input.force ? { force: true } : {}),
        });
        return;
      }
      await git.tag({
        fs,
        dir,
        ref: input.name,
        ...(input.object ? { object: input.object } : {}),
        ...(input.force ? { force: true } : {}),
      });
    },
    deleteTag(name) {
      return git.deleteTag({ fs, dir, ref: name });
    },
    listRemotes() {
      return git.listRemotes({ fs, dir });
    },
    addRemote(remote, url) {
      return git.addRemote({ fs, dir, remote, url });
    },
    deleteRemote(remote) {
      return git.deleteRemote({ fs, dir, remote });
    },
    async lsRemote(args) {
      assertSupportedTransport(args.url);
      assertCorsReachable(args.url, corsProxy);
      try {
        return await git.listServerRefs({
          http,
          url: args.url,
          corsProxy,
          onAuth,
          ...(args.prefix ? { prefix: args.prefix } : {}),
          ...(args.forPush ? { forPush: true } : {}),
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
    async merge(input) {
      const res: MergeResult = await git.merge({
        fs,
        dir,
        theirs: input.theirs,
        author: input.author,
        committer: input.committer ?? input.author,
        ...(input.message ? { message: input.message } : {}),
        ...(input.fastForwardOnly ? { fastForwardOnly: true } : {}),
      });
      if (res.oid !== undefined) {
        await resetIndexTo(res.oid);
        await resetWorkdirTo(res.oid);
      }
      return {
        oid: res.oid,
        alreadyMerged: res.alreadyMerged === true,
        fastForward: res.fastForward === true,
        mergeCommit: res.mergeCommit === true,
      };
    },
    cherryPick(input) {
      return git.cherryPick({
        fs,
        dir,
        oid: input.oid,
        ...(input.committer ? { committer: input.committer } : {}),
      });
    },
    async stash(op, message, refIdx) {
      const result: unknown = await git.stash({
        fs,
        dir,
        op,
        ...(message !== undefined ? { message } : {}),
        ...(refIdx !== undefined ? { refIdx } : {}),
      });
      if (op === 'list') {
        const lines =
          typeof result === 'string'
            ? result.split('\n').filter((line) => line.length > 0)
            : Array.isArray(result)
              ? result.filter((line): line is string => typeof line === 'string')
              : [];
        return lines.map((line, fallbackIndex) => {
          const match = /^stash@\{(\d+)\}:\s*(.*)$/.exec(line);
          return {
            index: match?.[1] === undefined ? fallbackIndex : Number(match[1]),
            message: match?.[2] ?? line,
          };
        });
      }
      return typeof result === 'string' ? result : undefined;
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
          noTags: args.noTags,
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
          remote: args.remote,
          corsProxy,
          ref: args.ref,
          remoteRef: args.remoteRef,
          singleBranch: args.singleBranch,
          depth: args.depth,
          tags: args.tags,
          prune: args.prune,
          pruneTags: args.pruneTags,
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
          remote: args.remote,
          corsProxy,
          ref: args.ref,
          remoteRef: args.remoteRef,
          singleBranch: args.singleBranch,
          prune: args.prune,
          pruneTags: args.pruneTags,
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
          remoteRef: args.remoteRef,
          force: args.force,
          delete: args.delete,
          onAuth,
        });
      } catch (e) {
        mapGitNetworkError(e);
      }
    },
  };
}
