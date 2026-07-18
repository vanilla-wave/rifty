import {
  EMPTY_COMMIT_MESSAGE_ERROR,
  type GitIdentity,
  type GitPorcelainXY,
  type LogEntry,
  commitRefusal,
  type makeGit,
  porcelainStatusLines,
} from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import type { Vfs } from '@riftydev/vfs';
import { scmDiffPlan } from '../../glue/scm-diff-plan.ts';
import type { ScmResourceRow } from '../../glue/scm-status.ts';
import { assertProjectPath, toOwnerProjectPath } from '../project-file-boundary.ts';

export interface PlaygroundScmSupportedChange {
  readonly path: string;
  readonly code: GitPorcelainXY;
  readonly area: 'staged' | 'working';
}

export interface PlaygroundScmStatusGap {
  readonly path: string;
  readonly rawStatusMatrixCode: string;
}

export type PlaygroundScmChange = PlaygroundScmSupportedChange | PlaygroundScmStatusGap;

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
  code: GitPorcelainXY,
  area: PlaygroundScmSupportedChange['area'],
): PlaygroundScmSupportedChange {
  return Object.freeze({ path, code, area });
}

function frozenStatusGap(path: string, rawStatusMatrixCode: string): PlaygroundScmStatusGap {
  return Object.freeze({ path, rawStatusMatrixCode });
}

function publicStatusPath(filepath: string): string | null {
  const candidate = `/${filepath}`;
  if (candidate === '/.rifty' || candidate.startsWith('/.rifty/')) return null;
  return assertProjectPath(candidate);
}

function changesFromStatus(
  entries: Awaited<ReturnType<ReturnType<typeof makeGit>['status']>>,
): readonly PlaygroundScmChange[] {
  const staged: PlaygroundScmSupportedChange[] = [];
  const working: PlaygroundScmChange[] = [];
  for (const entry of entries) {
    const path = publicStatusPath(entry.filepath);
    if (path === null) continue;
    if (entry.kind === 'unsupported') {
      working.push(frozenStatusGap(path, entry.rawStatusMatrixCode));
      continue;
    }
    for (const code of porcelainStatusLines(entry.status)) {
      const index = code[0];
      const worktree = code[1];
      if (index !== ' ' && index !== '?') staged.push(frozenChange(path, code, 'staged'));
      if (code === '??' || worktree !== ' ') working.push(frozenChange(path, code, 'working'));
    }
  }
  const byPath = (left: PlaygroundScmChange, right: PlaygroundScmChange): number =>
    left.path.localeCompare(right.path);
  staged.sort(byPath);
  working.sort(byPath);
  return Object.freeze([...staged, ...working]);
}

function badgeFor(change: PlaygroundScmSupportedChange): ScmResourceRow['badge'] {
  if (change.code === '??') return 'U';
  const status = change.area === 'staged' ? change.code[0] : change.code[1];
  if (status === 'A') return 'A';
  if (status === 'D') return 'D';
  return 'M';
}

function diffRow(change: PlaygroundScmSupportedChange): ScmResourceRow {
  return {
    path: change.path,
    relativePath: change.path.slice(1),
    code: change.code,
    side: change.area === 'staged' ? 'index' : 'worktree',
    badge: badgeFor(change),
  };
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

  const statusLines = async (relative: string): Promise<readonly GitPorcelainXY[]> => {
    const entry = (await git.status()).find((candidate) => candidate.filepath === relative);
    if (entry === undefined) return [];
    if (entry.kind === 'unsupported') {
      throw new NotImplementedError(`git.status-matrix.${entry.rawStatusMatrixCode}`);
    }
    return porcelainStatusLines(entry.status);
  };

  const currentStatusGap = (publicPath: string): PlaygroundScmStatusGap | undefined =>
    current.changes.find(
      (change): change is PlaygroundScmStatusGap =>
        change.path === publicPath && 'rawStatusMatrixCode' in change,
    );

  const assertSupportedPath = (publicPath: string): void => {
    const gap = currentStatusGap(publicPath);
    if (gap !== undefined) {
      throw new NotImplementedError(`git.status-matrix.${gap.rawStatusMatrixCode}`);
    }
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
      if ('rawStatusMatrixCode' in change) {
        const gap = currentStatusGap(publicPath);
        if (gap?.rawStatusMatrixCode !== change.rawStatusMatrixCode) {
          throw new TypeError('SCM change is not from the current snapshot');
        }
        throw new NotImplementedError(`git.status-matrix.${gap.rawStatusMatrixCode}`);
      }
      if (
        (change.area !== 'staged' && change.area !== 'working') ||
        !current.changes.some(
          (candidate) =>
            'code' in candidate &&
            candidate.path === publicPath &&
            candidate.code === change.code &&
            candidate.area === change.area,
        )
      ) {
        throw new TypeError('SCM change is not from the current snapshot');
      }
      const plan = scmDiffPlan(diffRow(change));
      const [original, modified] = await Promise.all([
        readBlob(plan.original, publicPath, relative),
        readBlob(plan.modified, publicPath, relative),
      ]);
      return Object.freeze({ original, modified });
    },

    async stage(path) {
      const { publicPath, relative } = checkedPath(path);
      assertSupportedPath(publicPath);
      const lines = await statusLines(relative);
      if (lines.length > 0 && lines.every((code) => code !== '??' && code[1] === 'D')) {
        await git.remove(relative);
      } else await git.add(relative);
      await refresh();
    },

    async unstage(path) {
      const { publicPath, relative } = checkedPath(path);
      assertSupportedPath(publicPath);
      await statusLines(relative);
      await git.unstage(relative);
      await refresh();
    },

    async discard(path) {
      const { publicPath, relative } = checkedPath(path);
      assertSupportedPath(publicPath);
      if ((await statusLines(relative)).includes('??')) {
        throw new Error(`Cannot discard untracked path ${path}`);
      }
      await git.checkout({ op: 'restore', pathspecs: [relative] });
      await refresh();
    },

    async commit(message) {
      if (message === '') throw new Error(EMPTY_COMMIT_MESSAGE_ERROR);
      const refusal = await commitRefusal(git);
      if (refusal !== null) throw new Error(refusal);
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
