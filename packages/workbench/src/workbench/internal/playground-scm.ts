import { type GitIdentity, type LogEntry, type makeGit, porcelainXY } from '@riftydev/git';
import type { Vfs } from '@riftydev/vfs';
import { assertProjectPath, toOwnerProjectPath } from '../project-file-boundary.ts';

export interface PlaygroundScmChange {
  readonly path: string;
  readonly code: string;
  readonly area: 'staged' | 'working';
}

export interface PlaygroundScmSnapshot {
  readonly branch?: string;
  readonly history: readonly LogEntry[];
  readonly changes: readonly PlaygroundScmChange[];
}

export interface PlaygroundScmBlob {
  readonly source: 'head' | 'index' | 'working' | 'empty';
  readonly bytes: Uint8Array;
}

export interface PlaygroundScmDiff {
  readonly original: PlaygroundScmBlob;
  readonly modified: PlaygroundScmBlob;
}

export interface PlaygroundScmDiffSources {
  readonly original: 'head' | 'index' | 'empty';
  readonly modified: 'index' | 'working' | 'empty';
}

export interface PlaygroundScm {
  snapshot(): PlaygroundScmSnapshot;
  subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void): () => void;
  refresh(): Promise<PlaygroundScmSnapshot>;
  diff(change: PlaygroundScmChange): Promise<PlaygroundScmDiff>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  discard(path: string): Promise<void>;
  commit(message: string): Promise<string>;
}

export interface PlaygroundScmAuthority {
  readonly projectRoot: string;
  readonly vfs: Vfs;
  readonly git: ReturnType<typeof makeGit>;
  readonly commitIdentity: GitIdentity;
}

/** Select exact Git/VFS blobs from the public status code and semantic area. */
export function selectPlaygroundScmDiffSources(
  change: Pick<PlaygroundScmChange, 'code' | 'area'>,
): PlaygroundScmDiffSources {
  const { area, code } = change;
  if (
    (area !== 'staged' && area !== 'working') ||
    typeof code !== 'string' ||
    (code !== '??' && !/^[ MAD]{2}$/.test(code))
  ) {
    throw new TypeError('Invalid SCM diff input');
  }

  const index = code[0] ?? ' ';
  const worktree = code[1] ?? ' ';
  const hasIndexChange = index !== ' ' && index !== '?';
  const hasWorkingChange = code === '??' || worktree !== ' ';
  if ((area === 'staged' && !hasIndexChange) || (area === 'working' && !hasWorkingChange)) {
    throw new TypeError('Invalid SCM diff input');
  }

  const hasHeadBlob = code !== '??' && index !== 'A';
  if (area === 'staged') {
    return Object.freeze({
      original: hasHeadBlob ? 'head' : 'empty',
      modified: index === 'D' ? 'empty' : 'index',
    });
  }

  const original: PlaygroundScmDiffSources['original'] = hasIndexChange
    ? index === 'D'
      ? 'empty'
      : 'index'
    : hasHeadBlob
      ? 'head'
      : 'empty';
  return Object.freeze({
    original,
    modified: worktree === 'D' ? 'empty' : 'working',
  });
}

function cloneIdentity(identity: GitIdentity): GitIdentity {
  return Object.freeze({
    name: identity.name,
    email: identity.email,
    timestamp: identity.timestamp,
    timezoneOffset: identity.timezoneOffset,
  });
}

function cloneLogEntry(entry: LogEntry): LogEntry {
  const parents = [...entry.parents];
  Object.freeze(parents);
  return Object.freeze({
    oid: entry.oid,
    message: entry.message,
    author: cloneIdentity(entry.author),
    committer: cloneIdentity(entry.committer),
    tree: entry.tree,
    parents,
  });
}

function frozenChange(
  path: string,
  code: string,
  area: PlaygroundScmChange['area'],
): PlaygroundScmChange {
  return Object.freeze({ path, code, area });
}

function publicStatusPath(filepath: string): string {
  return assertProjectPath(`/${filepath}`);
}

function changesFromStatus(
  entries: Awaited<ReturnType<ReturnType<typeof makeGit>['status']>>,
): readonly PlaygroundScmChange[] {
  const staged: PlaygroundScmChange[] = [];
  const working: PlaygroundScmChange[] = [];
  for (const entry of entries) {
    const code = porcelainXY(entry.status);
    if (code === null) continue;
    if (code !== '??' && !/^[ MAD]{2}$/.test(code)) {
      throw new Error(`Unsupported Git status ${entry.status} for ${entry.filepath}`);
    }
    const path = publicStatusPath(entry.filepath);
    const index = code[0] ?? ' ';
    const worktree = code[1] ?? ' ';
    if (index !== ' ' && index !== '?') staged.push(frozenChange(path, code, 'staged'));
    if (code === '??' || worktree !== ' ') working.push(frozenChange(path, code, 'working'));
  }
  const byPath = (left: PlaygroundScmChange, right: PlaygroundScmChange): number =>
    left.path.localeCompare(right.path);
  staged.sort(byPath);
  working.sort(byPath);
  return Object.freeze([...staged, ...working]);
}

function frozenBlob(
  source: PlaygroundScmBlob['source'],
  bytes: Uint8Array = new Uint8Array(),
): PlaygroundScmBlob {
  return Object.freeze({ source, bytes: bytes.slice() });
}

/** Real Git + VFS adapter; text decoding never participates in SCM semantics. */
export async function createPlaygroundScmAdapter(
  authority: PlaygroundScmAuthority,
): Promise<PlaygroundScm> {
  const { commitIdentity, git, projectRoot, vfs } = authority;
  const listeners = new Set<(snapshot: PlaygroundScmSnapshot) => void>();
  let current: PlaygroundScmSnapshot;

  const readSnapshot = async (): Promise<PlaygroundScmSnapshot> => {
    const [branch, history, status] = await Promise.all([
      git.currentBranch(),
      git.log(),
      git.status(),
    ]);
    const snapshot: PlaygroundScmSnapshot = Object.freeze({
      ...(branch === undefined ? {} : { branch }),
      history: Object.freeze(history.map(cloneLogEntry)),
      changes: changesFromStatus(status),
    });
    return snapshot;
  };

  const publish = (snapshot: PlaygroundScmSnapshot): void => {
    current = snapshot;
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // One host listener cannot suppress sibling state delivery.
      }
    }
  };

  const refresh = async (): Promise<PlaygroundScmSnapshot> => {
    const next = await readSnapshot();
    publish(next);
    return next;
  };

  const checkedPath = (
    path: string,
  ): { readonly publicPath: string; readonly relative: string } => {
    const publicPath = assertProjectPath(path);
    if (publicPath === '/.git' || publicPath.startsWith('/.git/')) {
      throw new TypeError('Git metadata is outside the project SCM namespace');
    }
    return { publicPath, relative: publicPath.slice(1) };
  };

  const statusCode = async (relative: string): Promise<string | null> => {
    const entry = (await git.status()).find((candidate) => candidate.filepath === relative);
    return entry === undefined ? null : porcelainXY(entry.status);
  };

  const readGitBlob = async (
    source: 'head' | 'index',
    relative: string,
  ): Promise<PlaygroundScmBlob> => {
    const object = await git.show(source === 'head' ? `HEAD:${relative}` : `:${relative}`);
    if (object.type !== 'blob') throw new Error(`${source}:${relative} is not a blob`);
    return frozenBlob(source, object.content);
  };

  const readBlob = async (
    source: PlaygroundScmBlob['source'],
    publicPath: string,
    relative: string,
  ): Promise<PlaygroundScmBlob> => {
    switch (source) {
      case 'empty':
        return frozenBlob('empty');
      case 'head':
      case 'index':
        return readGitBlob(source, relative);
      case 'working':
        return frozenBlob(
          'working',
          await vfs.readFile(toOwnerProjectPath(projectRoot, publicPath)),
        );
    }
  };

  current = await readSnapshot();

  const scm: PlaygroundScm = {
    snapshot() {
      return current;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('SCM listener must be a function');
      listeners.add(listener);
      try {
        listener(current);
      } catch {
        // Initial delivery obeys the same sibling-fault isolation rule.
      }
      return () => listeners.delete(listener);
    },

    refresh,

    async diff(change) {
      const { publicPath, relative } = checkedPath(change.path);
      if (
        (change.area !== 'staged' && change.area !== 'working') ||
        !current.changes.some(
          (candidate) =>
            candidate.path === publicPath &&
            candidate.code === change.code &&
            candidate.area === change.area,
        )
      ) {
        throw new TypeError('SCM change is not from the current snapshot');
      }
      const sources = selectPlaygroundScmDiffSources(change);
      const [original, modified] = await Promise.all([
        readBlob(sources.original, publicPath, relative),
        readBlob(sources.modified, publicPath, relative),
      ]);
      return Object.freeze({ original, modified });
    },

    async stage(path) {
      const { relative } = checkedPath(path);
      const code = await statusCode(relative);
      if (code !== null && code !== '??' && code[1] === 'D') await git.remove(relative);
      else await git.add(relative);
      await refresh();
    },

    async unstage(path) {
      const { relative } = checkedPath(path);
      await git.unstage(relative);
      await refresh();
    },

    async discard(path) {
      const { relative } = checkedPath(path);
      if ((await statusCode(relative)) === '??') {
        throw new Error(`Cannot discard untracked path ${path}`);
      }
      await git.checkout({ op: 'restore', pathspecs: [relative] });
      await refresh();
    },

    async commit(message) {
      const oid = await git.commit({
        message,
        author: commitIdentity,
        committer: commitIdentity,
      });
      await refresh();
      return oid;
    },
  };

  return Object.freeze(scm);
}
