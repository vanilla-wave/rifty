/**
 * Owner-backed SCM orchestration — headless core extracted from App.tsx
 * (ADR-0197, epic playground-testable-core, slice 4; ADR-0185 owner-backed SCM
 * bridges). Owns the page mirror of the owner git-status feed + branch/history
 * reads, and every GIT action/diff flow: stage/unstage/discard/commit, the
 * side-aware blob-vs-blob diffs (HEAD/index/worktree), explorer compares and
 * the git-original read the editor's working diff uses.
 *
 * No UI imports; every side effect goes through the injected ports below —
 * the behavioral-test seam (ADR-0197 §4). The git RPC port is the structural
 * subset of the REAL package-owned GitOwnerClient.
 */
import { type LogEntry, porcelainXY } from '@riftydev/git';
import { basename } from '@riftydev/vfs';
import {
  type FileReadOwnerLike,
  type GitOwnerClient,
  type OwnerFileReader,
  looksBinary,
} from '@riftydev/workbench';
import { createSignal, untrack } from 'solid-js';
import { scmDiffPlan, statusCodeHasHeadBlob } from '../glue/scm-diff-plan.ts';
import type { ScmResourceRow } from '../glue/scm-status.ts';

const fatalDec = new TextDecoder('utf-8', { fatal: true });

/** Structural subset of the real GitOwnerClient the SCM core drives. */
export type ScmGitPort = Pick<
  GitOwnerClient,
  | 'show'
  | 'status'
  | 'log'
  | 'currentBranch'
  | 'add'
  | 'remove'
  | 'unstage'
  | 'restore'
  | 'commitResolvedIdentity'
  | 'dispose'
>;

export interface ScmTextDiffSpec {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly originalTitle: string;
  readonly modifiedTitle: string;
  readonly original: string;
  readonly modified: string;
}

export interface ScmWorkingDiffSpec {
  readonly path: string;
  readonly ref: 'HEAD';
  readonly hasOriginal: boolean;
  readonly modified: string;
}

export interface GitScmReads {
  readonly root: string;
  readonly branch?: string;
  readonly history: readonly LogEntry[];
}

export interface ScmStatusFrame {
  readonly entries: readonly { readonly path: string; readonly code: string }[];
}

export interface ScmDeps<O extends FileReadOwnerLike> {
  currentOwner(): O;
  ownerUnavailable(owner: O): boolean;
  /** Guarded owner byte reads (shared with the workspace-files core). */
  reader: OwnerFileReader<O>;
  bridgeGit(owner: O): ScmGitPort;
  /** Owner git-status push feed (glue/git-status-feed). */
  subscribeStatus(owner: O, cb: (frame: ScmStatusFrame) => void): () => void;
  requestStatus(owner: O): void;
  requestVfsSnapshot(owner: O): void;
  /** Join a status-relative path onto the owner root (vfs joinPath). */
  joinRootPath(root: string, path: string): string;
  editor: {
    openTextDiff(spec: ScmTextDiffSpec): void;
    openWorkingDiff(spec: ScmWorkingDiffSpec): void;
    /** Drop a discarded file's model so its buffer can't be re-flushed. */
    closePath(path: string): void;
  };
  flushEditorWrites(): Promise<void>;
  confirmDiscard(message: string): boolean;
  showError(message: string): void;
  showSuccess(message: string): void;
  activeRoot(): string;
}

export interface Scm<O extends FileReadOwnerLike> {
  /** (Re)bind the status feed + branch/history reads to the CURRENT owner. */
  attachOwner(owner: O): void;
  dispose(): void;
  /** abs path → porcelain code, from the owner status feed. */
  gitStatus(): ReadonlyMap<string, string>;
  /** Branch/history for the ACTIVE root only (a stale root reads as empty). */
  activeScm(): GitScmReads;
  requestActiveGitStatus(): void;
  readGitOriginalText(input: { readonly path: string; readonly ref: string }): Promise<string>;
  openWorkingFileCompare(leftPath: string, rightPath: string): Promise<void>;
  openWorkingHeadCompare(path: string): Promise<void>;
  openScmResourceDiff(row: ScmResourceRow): Promise<void>;
  stageRow(row: ScmResourceRow): Promise<void>;
  unstageRow(row: ScmResourceRow): Promise<void>;
  discardRow(row: ScmResourceRow): Promise<void>;
  commit(message: string): Promise<void>;
}

export function decodeTextBlob(label: string, bytes: Uint8Array): string {
  if (looksBinary(bytes)) throw new Error(`${label} is binary; text diff is unavailable`);
  try {
    return fatalDec.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8; text diff is unavailable`);
  }
}

function compareDiffId(kind: string, left: string, right: string): string {
  return `diff:${kind}:${encodeURIComponent(left)}:${encodeURIComponent(right)}`;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createScm<O extends FileReadOwnerLike>(deps: ScmDeps<O>): Scm<O> {
  const { reader } = deps;
  const [gitStatus, setGitStatus] = createSignal<ReadonlyMap<string, string>>(new Map());
  const emptyReads = (root = deps.activeRoot()): GitScmReads => ({ root, history: [] });
  const [scmReads, setScmReads] = createSignal<GitScmReads>(untrack(() => emptyReads()));
  // Branch/history follow the OWNER root; a switch mid-flight publishes reads for
  // a root that is no longer active — surface empty instead of stale data.
  const activeScm = (): GitScmReads =>
    scmReads().root === deps.activeRoot() ? scmReads() : emptyReads();

  let detach: (() => void) | null = null;

  // The ONE owner-currency gate for the SCM core (delegates to the reader's
  // chokepoint predicate). `readBytes` self-guards its own reads; this asserts
  // after an unguarded git RPC (show/status) and as the final check before a
  // diff is exposed — never open a diff computed against a dead/respawned owner.
  function assertOwnerCurrent(owner: O, changedMessage: string): void {
    const fault = reader.currencyFault(owner);
    if (fault === 'unavailable') throw new Error('workspace owner is unavailable');
    if (fault === 'changed') throw new Error(changedMessage);
  }

  function attachOwner(owner: O): void {
    // untrack: a caller's effect must key on the OWNER signal alone (the
    // attachOwner resubscribe-storm trap; reads activeRoot/status signals here).
    untrack(() => {
      detach?.();
      const root = owner.root;
      if (deps.ownerUnavailable(owner)) {
        setGitStatus(new Map());
        setScmReads(emptyReads(root));
        return;
      }
      const git = deps.bridgeGit(owner);
      let disposed = false;
      async function refreshScmReads(): Promise<void> {
        try {
          const [branch, history] = await Promise.all([
            git.currentBranch(),
            git.log({ depth: 20 }),
          ]);
          if (disposed) return;
          setScmReads({ root, branch, history });
        } catch (err) {
          if (disposed) return;
          setScmReads(emptyReads(root));
          console.warn('[scm] read failed', (err as Error).message);
        }
      }
      void refreshScmReads();
      const unsubscribe = deps.subscribeStatus(owner, (frame) => {
        const next = new Map<string, string>();
        for (const entry of frame.entries)
          next.set(deps.joinRootPath(root, entry.path), entry.code);
        setGitStatus(next);
        void refreshScmReads();
      });
      setGitStatus(new Map());
      detach = (): void => {
        disposed = true;
        unsubscribe();
        git.dispose();
        setGitStatus(new Map());
        setScmReads(emptyReads());
        detach = null;
      };
    });
  }

  function requestActiveGitStatus(): void {
    const owner = deps.currentOwner();
    if (deps.ownerUnavailable(owner)) return;
    deps.requestStatus(owner);
  }

  async function readGitOriginalText(input: {
    readonly path: string;
    readonly ref: string;
  }): Promise<string> {
    const owner = deps.currentOwner();
    const root = owner.root;
    const relative = input.path.startsWith(`${root}/`) ? input.path.slice(root.length + 1) : '';
    if (!relative) throw new Error(`Cannot read git original outside ${root}`);
    if (deps.ownerUnavailable(owner)) {
      throw new Error('git original read failed: workspace owner is unavailable');
    }
    reader.assertOwnerAlive(owner, input.path, 'read git original');
    const git = deps.bridgeGit(owner);
    try {
      const original = await git.show(`${input.ref}:${relative}`);
      assertOwnerCurrent(owner, `workspace owner changed while reading ${input.ref}:${relative}`);
      if (original.type !== 'blob') throw new Error(`${input.ref}:${relative} is not a blob`);
      return decodeTextBlob(`${input.ref}:${relative}`, original.content);
    } finally {
      git.dispose();
    }
  }

  async function openWorkingFileCompare(leftPath: string, rightPath: string): Promise<void> {
    try {
      await deps.flushEditorWrites();
      const owner = deps.currentOwner();
      const [leftBytes, rightBytes] = await Promise.all([
        reader.readBytes(owner, leftPath, 'compare'),
        reader.readBytes(owner, rightPath, 'compare'),
      ]);
      assertOwnerCurrent(
        owner,
        `workspace owner changed while comparing ${basename(leftPath)} and ${basename(rightPath)}`,
      );
      deps.editor.openTextDiff({
        id: compareDiffId('working', leftPath, rightPath),
        path: rightPath,
        title: `${basename(leftPath)} ↔ ${basename(rightPath)}`,
        originalTitle: basename(leftPath),
        modifiedTitle: basename(rightPath),
        original: decodeTextBlob(leftPath, leftBytes),
        modified: decodeTextBlob(rightPath, rightBytes),
      });
    } catch (err) {
      deps.showError(`Compare failed: ${(err as Error).message}`);
    }
  }

  async function headBlobExistsForCurrentStatus(
    owner: O,
    path: string,
    relative: string,
  ): Promise<boolean> {
    reader.assertOwnerAlive(owner, path, 'compare');
    const git = deps.bridgeGit(owner);
    try {
      const status = await git.status();
      assertOwnerCurrent(owner, `workspace owner changed while comparing ${relative} with HEAD`);
      const entry = status.find((candidate) => candidate.filepath === relative);
      return statusCodeHasHeadBlob(entry ? (porcelainXY(entry.status) ?? undefined) : undefined);
    } finally {
      git.dispose();
    }
  }

  async function openWorkingHeadCompare(path: string): Promise<void> {
    try {
      await deps.flushEditorWrites();
      const owner = deps.currentOwner();
      const root = owner.root;
      const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : '';
      if (!relative) {
        deps.showError(`Cannot compare outside ${root}`);
        return;
      }
      if (deps.ownerUnavailable(owner)) {
        deps.showError('Compare failed: workspace owner is unavailable');
        return;
      }
      reader.assertOwnerAlive(owner, path, 'compare');
      const working = await reader.readBytes(owner, path, 'compare');
      assertOwnerCurrent(owner, `workspace owner changed while comparing ${relative} with HEAD`);
      const hasOriginal = await headBlobExistsForCurrentStatus(owner, path, relative);
      assertOwnerCurrent(owner, `workspace owner changed while comparing ${relative} with HEAD`);
      deps.editor.openWorkingDiff({
        path,
        ref: 'HEAD',
        hasOriginal,
        modified: decodeTextBlob(relative, working),
      });
    } catch (err) {
      deps.showError(`Compare failed: ${(err as Error).message}`);
    }
  }

  async function readGitIndexText(git: ScmGitPort, relative: string): Promise<string> {
    const index = await git.show(`:${relative}`);
    if (index.type !== 'blob') throw new Error(`:${relative} is not a blob`);
    return decodeTextBlob(`:${relative}`, index.content);
  }

  async function readGitHeadText(git: ScmGitPort, relative: string): Promise<string> {
    const original = await git.show(`HEAD:${relative}`);
    if (original.type !== 'blob') throw new Error(`HEAD:${relative} is not a blob`);
    return decodeTextBlob(`HEAD:${relative}`, original.content);
  }

  async function openScmResourceDiff(row: ScmResourceRow): Promise<void> {
    await deps.flushEditorWrites();
    const path = row.path;
    const owner = deps.currentOwner();
    const root = owner.root;
    const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : '';
    if (!relative) {
      deps.showError(`Cannot open git diff outside ${root}`);
      return;
    }
    if (deps.ownerUnavailable(owner)) {
      deps.showError('Open changes failed: workspace owner is unavailable');
      return;
    }
    reader.assertOwnerAlive(owner, path, 'open Git changes');
    const git = deps.bridgeGit(owner);
    try {
      // Blob selection is delegated to the tested scm-diff-plan planner, not
      // re-derived inline (covered behaviorally by scm-diff-plan.test.ts).
      const plan = scmDiffPlan(row);
      const original =
        plan.original === 'head'
          ? await readGitHeadText(git, relative)
          : plan.original === 'index'
            ? await readGitIndexText(git, relative)
            : '';
      const modified =
        plan.modified === 'index'
          ? await readGitIndexText(git, relative)
          : plan.modified === 'working'
            ? decodeTextBlob(relative, await reader.readBytes(owner, path, 'open Git changes'))
            : '';
      assertOwnerCurrent(owner, `workspace owner changed while opening ${relative}`);
      const idScope = row.side === 'index' ? `scm-index-${row.code}` : `scm-worktree-${row.code}`;
      deps.editor.openTextDiff({
        id: compareDiffId(idScope, row.side === 'index' ? 'HEAD' : row.relativePath, path),
        path,
        title: `${basename(path)} ↔ ${plan.modifiedTitle}`,
        originalTitle: plan.originalTitle,
        modifiedTitle: plan.modifiedTitle,
        original,
        modified,
      });
    } catch (err) {
      deps.showError(`Open changes failed: ${(err as Error).message}`);
    } finally {
      git.dispose();
    }
  }

  function assertScmOwner(owner: O): void {
    assertOwnerCurrent(owner, 'workspace owner changed while applying Git action');
  }

  async function runScmOwnerAction(
    label: string,
    action: (git: ScmGitPort) => Promise<void>,
    opts: { readonly refreshVfs?: boolean } = {},
  ): Promise<void> {
    await deps.flushEditorWrites();
    const owner = deps.currentOwner();
    assertScmOwner(owner);
    const git = deps.bridgeGit(owner);
    try {
      await action(git);
      assertScmOwner(owner);
      deps.requestStatus(owner);
      if (opts.refreshVfs) deps.requestVfsSnapshot(owner);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      deps.showError(`${label} failed: ${error.message}`);
      throw error;
    } finally {
      git.dispose();
    }
  }

  function stageDeletesWorkingBlob(row: ScmResourceRow): boolean {
    return row.badge === 'D';
  }

  async function stageRow(row: ScmResourceRow): Promise<void> {
    await runScmOwnerAction(`Stage ${row.relativePath}`, async (git) => {
      if (stageDeletesWorkingBlob(row)) await git.remove(row.relativePath);
      else await git.add(row.relativePath);
    });
  }

  async function unstageRow(row: ScmResourceRow): Promise<void> {
    await runScmOwnerAction(`Unstage ${row.relativePath}`, (git) => git.unstage(row.relativePath));
  }

  async function discardRow(row: ScmResourceRow): Promise<void> {
    if (row.badge === 'U') {
      const error = new Error('untracked files are not discardable through git restore');
      deps.showError(`Discard ${row.relativePath} failed: ${error.message}`);
      throw error;
    }
    const confirmed = deps.confirmDiscard(
      `Discard changes in ${row.relativePath}? This cannot be undone.`,
    );
    if (!confirmed) return;
    await runScmOwnerAction(
      `Discard ${row.relativePath}`,
      async (git) => {
        await git.restore([row.relativePath]);
      },
      { refreshVfs: true },
    );
    // The owner working file is now back at HEAD. Drop any open editor model so
    // its (discarded) buffer cannot be re-flushed to the owner on the next edit,
    // silently resurrecting the change. Re-open reads the restored owner bytes.
    deps.editor.closePath(row.path);
  }

  async function commit(message: string): Promise<void> {
    await runScmOwnerAction('Commit', async (git) => {
      const oid = await git.commitResolvedIdentity({ message });
      deps.showSuccess(`Committed ${oid.slice(0, 7)}`);
    });
  }

  return {
    attachOwner,
    dispose: () => detach?.(),
    gitStatus,
    activeScm,
    requestActiveGitStatus,
    readGitOriginalText,
    openWorkingFileCompare,
    openWorkingHeadCompare,
    openScmResourceDiff,
    stageRow,
    unstageRow,
    discardRow,
    commit,
  };
}
