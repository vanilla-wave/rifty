import { basename, dirname, isAbsolute, normalizePath } from '@riftydev/vfs';
import {
  type OwnerVfsCommitTerminal,
  handleOwnerVfsCommitCleanup,
  handleOwnerVfsCommitReceipt,
  handleOwnerVfsCommitRequest,
  handleOwnerVfsDurabilityRequest,
} from '../glue/owner-vfs-ipc.ts';
import type {
  HostCommitRequest,
  OwnerVfsDurabilityReceipt,
  OwnerVfsSnapshot,
  OwnerVfsSnapshotEntry,
} from '../glue/owner-vfs-protocol.ts';
import {
  type PackageMutationExecutor,
  applyPackageAwareHostCommit,
} from '../glue/package-mutation-executor.ts';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
  ProjectVfsDirectoryEntry,
} from '../workbench/project-vfs-protocol.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

export interface WorkbenchProjectVfsOptions {
  readonly projectRoot: string;
  readonly authority: OwnerVfsAuthority;
  readonly packageMutations: PackageMutationExecutor;
  readonly durability: OwnerVfsDurabilityReceipt['durability'];
  readonly emit: (frame: OwnerProjectVfsFrame) => void;
}

export interface WorkbenchProjectVfs {
  handleFrame(frame: PageProjectVfsFrame): void | Promise<void>;
  publishSnapshot(): void;
  close(): Promise<void>;
}

interface DeferredCompletion {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferredCompletion(): DeferredCompletion {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertProjectRoot(options: WorkbenchProjectVfsOptions): string {
  const root = options.projectRoot;
  if (
    typeof root !== 'string' ||
    root === '/' ||
    !isAbsolute(root) ||
    root.includes('\0') ||
    normalizePath(root) !== root ||
    options.authority.statSyncOrNull(root)?.isDirectory !== true
  ) {
    throw new TypeError('Workbench Project VFS root must be an existing canonical directory');
  }
  if (options.durability !== 'durable' && options.durability !== 'ephemeral') {
    throw new TypeError('Workbench Project VFS durability is invalid');
  }
  return root;
}

function assertProjectPath(projectRoot: string, path: string, allowRoot: boolean): void {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    path.includes('\0') ||
    normalizePath(path) !== path ||
    (path !== projectRoot && !path.startsWith(`${projectRoot}/`)) ||
    (!allowRoot && path === projectRoot)
  ) {
    throw new TypeError('Project VFS path is outside the active project');
  }
}

function commitPaths(request: HostCommitRequest): readonly string[] {
  return request.kind === 'rename' ? [request.sourcePath, request.targetPath] : [request.path];
}

function terminalPaths(terminal: OwnerVfsCommitTerminal): readonly string[] {
  const paths: string[] = [];
  const applied = terminal.ok ? terminal.ack : terminal.applied;
  if (applied !== undefined) {
    for (const version of applied.versions) paths.push(version.path);
  }
  if (!terminal.ok && terminal.error.kind === 'version-conflict') {
    paths.push(terminal.error.path);
    if (terminal.error.actualEntry !== null) paths.push(terminal.error.actualEntry.path);
  }
  return paths;
}

function readError(error: unknown): { readonly name: string; readonly message: string } {
  const failure = error instanceof Error ? error : new Error(String(error));
  return {
    name: failure.name.length > 0 ? failure.name : 'Error',
    message: failure.message,
  };
}

type AtomicFileEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }>;

function atomicFile(snapshot: OwnerVfsSnapshot, path: string): AtomicFileEntry {
  const entry = snapshot.entries.find((candidate) => candidate.path === path);
  if (entry?.kind !== 'file') throw new Error(`No file exists at ${path}`);
  return {
    ...entry,
    content: entry.content.slice(),
  };
}

function atomicDirectory(
  snapshot: OwnerVfsSnapshot,
  path: string,
): readonly ProjectVfsDirectoryEntry[] {
  const directory = snapshot.entries.find((candidate) => candidate.path === path);
  if (directory?.kind !== 'dir') throw new Error(`No directory exists at ${path}`);
  return snapshot.entries
    .filter((entry) => entry.path !== path && dirname(entry.path) === path)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      const leftName = basename(left.path).toLowerCase();
      const rightName = basename(right.path).toLowerCase();
      return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
    })
    .map((entry) =>
      Object.freeze({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        version: entry.version,
      }),
    );
}

/** Active-project namespace gate over the lifetime owner VFS authorities. */
export function createWorkbenchProjectVfs(
  options: WorkbenchProjectVfsOptions,
): WorkbenchProjectVfs {
  const projectRoot = assertProjectRoot(options);
  const pending = new Set<Promise<void>>();
  let accepting = true;
  let closePromise: Promise<void> | null = null;

  const assertAccepting = (): void => {
    if (!accepting) throw new ClosedHandleError('Workbench Project VFS');
  };

  const emitSnapshot = (): void => {
    options.emit({
      type: 'workbench:project-vfs-snapshot',
      frame: collectSnapshot(options.authority, projectRoot),
    });
  };

  const publishSnapshot = (): void => {
    assertAccepting();
    emitSnapshot();
  };

  const track = (task: Promise<void>): Promise<void> => {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const handleCommit = (
    frame: Extract<PageProjectVfsFrame, { readonly type: 'rifty:owner-vfs-commit' }>,
  ): Promise<void> => {
    const completed = deferredCompletion();
    const task = track(completed.promise);
    try {
      handleOwnerVfsCommitRequest({
        message: frame,
        admit: (request) =>
          options.authority.admitHostCommit(
            request,
            (candidate) =>
              applyPackageAwareHostCommit(
                options.authority,
                options.packageMutations,
                projectRoot,
                candidate,
              ),
            emitSnapshot,
          ),
        send: (terminal) => {
          try {
            options.emit(terminal);
            completed.resolve();
          } catch (error) {
            completed.reject(errorFrom(error));
          }
        },
        reportError: (error) => completed.reject(error),
      });
    } catch (error) {
      completed.reject(errorFrom(error));
    }
    return task;
  };

  const assertTerminalPaths = (terminal: OwnerVfsCommitTerminal): void => {
    for (const path of terminalPaths(terminal)) assertProjectPath(projectRoot, path, false);
  };

  const readFile = (
    frame: Extract<PageProjectVfsFrame, { readonly type: 'workbench:project-vfs-read-file' }>,
  ): void => {
    assertProjectPath(projectRoot, frame.path, true);
    let result: OwnerProjectVfsFrame;
    try {
      const snapshot = options.authority.snapshot();
      result = {
        type: 'workbench:project-vfs-read-file-result',
        requestId: frame.requestId,
        ok: true,
        ownerEpoch: snapshot.ownerEpoch,
        treeRevision: snapshot.treeRevision,
        entry: atomicFile(snapshot, frame.path),
      };
    } catch (error) {
      result = {
        type: 'workbench:project-vfs-read-file-result',
        requestId: frame.requestId,
        ok: false,
        error: readError(error),
      };
    }
    options.emit(result);
  };

  const readDirectory = (
    frame: Extract<PageProjectVfsFrame, { readonly type: 'workbench:project-vfs-read-directory' }>,
  ): void => {
    assertProjectPath(projectRoot, frame.path, true);
    let result: OwnerProjectVfsFrame;
    try {
      const snapshot = options.authority.snapshot();
      result = {
        type: 'workbench:project-vfs-read-directory-result',
        requestId: frame.requestId,
        ok: true,
        ownerEpoch: snapshot.ownerEpoch,
        treeRevision: snapshot.treeRevision,
        entries: Object.freeze(atomicDirectory(snapshot, frame.path)),
      };
    } catch (error) {
      result = {
        type: 'workbench:project-vfs-read-directory-result',
        requestId: frame.requestId,
        ok: false,
        error: readError(error),
      };
    }
    options.emit(result);
  };

  return Object.freeze({
    handleFrame(frame: PageProjectVfsFrame): void | Promise<void> {
      assertAccepting();
      switch (frame.type) {
        case 'rifty:owner-vfs-commit':
          for (const path of commitPaths(frame.request)) {
            assertProjectPath(projectRoot, path, false);
          }
          return handleCommit(frame);
        case 'rifty:owner-vfs-commit-received':
          assertTerminalPaths(frame.terminal);
          handleOwnerVfsCommitReceipt({
            message: frame,
            retained: (operationId) => options.authority.retainedHostCommitTerminal(operationId),
            send: options.emit,
          });
          return;
        case 'rifty:owner-vfs-commit-cleanup':
          assertTerminalPaths(frame.terminal);
          handleOwnerVfsCommitCleanup({
            message: frame,
            cleanup: (terminal) => options.authority.cleanupHostCommitTerminal(terminal),
            send: options.emit,
          });
          return;
        case 'rifty:owner-vfs-durability':
          return track(
            handleOwnerVfsDurabilityRequest({
              message: frame,
              current: () => ({
                ownerEpoch: options.authority.ownerEpoch,
                treeRevision: options.authority.treeRevision,
              }),
              durability: options.durability,
              flush: () => options.authority.flush(),
              send: options.emit,
            }),
          );
        case 'workbench:project-vfs-snapshot-request':
          publishSnapshot();
          return;
        case 'workbench:project-vfs-read-file':
          readFile(frame);
          return;
        case 'workbench:project-vfs-read-directory':
          readDirectory(frame);
          return;
        default: {
          const unsupported: never = frame;
          throw new TypeError(`Unsupported Project VFS frame: ${String(unsupported)}`);
        }
      }
    },
    publishSnapshot,
    close() {
      if (closePromise !== null) return closePromise;
      accepting = false;
      const admitted = [...pending];
      closePromise = Promise.allSettled(admitted).then((results) => {
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [errorFrom(result.reason)] : [],
        );
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Workbench Project VFS close failed');
        }
      });
      return closePromise;
    },
  });
}
