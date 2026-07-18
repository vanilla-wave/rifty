import {
  type VfsMutationGuard,
  type VfsMutationIntent,
  basename,
  dirname,
  isAbsolute,
  normalizePath,
} from '@riftydev/vfs';
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
import { VfsCommitProtocolError } from '../glue/owner-vfs-protocol.ts';
import {
  type PackageMutationExecutor,
  applyPackageAwareHostCommit,
} from '../glue/package-mutation-executor.ts';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
  ProjectVfsAppliedMutation,
  ProjectVfsDirectoryEntry,
} from '../workbench/project-vfs-protocol.ts';
import type {
  OwnerVfsAppliedMutation,
  OwnerVfsAppliedMutations,
  OwnerVfsAppliedRevision,
} from './owner-vfs-applied-journal.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

export interface WorkbenchProjectVfsOptions {
  readonly projectRoot: string;
  readonly authority: OwnerVfsAuthority;
  readonly appliedMutations: OwnerVfsAppliedMutations;
  readonly packageMutations: PackageMutationExecutor;
  readonly durability: OwnerVfsDurabilityReceipt['durability'];
  readonly emit: (frame: OwnerProjectVfsFrame) => void;
  /** Companion metadata reflection, awaited before the originating mutation settles. */
  readonly recordMutation?: (kind: 'guest' | 'file', treeRevision: number) => Promise<void>;
  /** Delivery failure must end the owner lifetime; stale project state cannot continue. */
  readonly fatal: (error: Error) => void;
}

export interface WorkbenchProjectVfs {
  handleFrame(frame: PageProjectVfsFrame): void | Promise<void>;
  publishSnapshot(): void;
  /** Observe the one state-publication chokepoint; no private journal cursor escapes. */
  subscribePublications(listener: (treeRevision: number) => void): () => void;
  /** Package FIFO + applied semantic evidence + publication before settlement. */
  readonly mutationGuard: VfsMutationGuard;
  /** Owner-private transaction: an explicitly recoverable failure advances no page state. */
  recoverableMutation<T>(
    intents: readonly VfsMutationIntent[],
    apply: () =>
      | WorkbenchRecoverableMutationResult<T>
      | Promise<WorkbenchRecoverableMutationResult<T>>,
  ): Promise<T>;
  /** FIFO-head prepare, package-authority reset, then recoverable whole-project replace. */
  recoverableProjectReplace<T>(
    prepare: () => void | Promise<void>,
    apply: () =>
      | WorkbenchRecoverableMutationResult<T>
      | Promise<WorkbenchRecoverableMutationResult<T>>,
  ): Promise<T>;
  /** Join publication of every owner revision already applied at call time. */
  publicationBarrier(): Promise<void>;
  /** Join admitted writes, then hold the owner writer FIFO for one consistent read. */
  readConsistent<T>(read: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type WorkbenchRecoverableMutationResult<T> =
  | { readonly status: 'committed'; readonly value: T }
  | { readonly status: 'recoverable-failure'; readonly error: Error };

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

function containsPath(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function intersectsPath(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left);
}

function projectMutation(
  projectRoot: string,
  treeRevision: number,
  mutation: OwnerVfsAppliedMutation,
): ProjectVfsAppliedMutation | null {
  switch (mutation.kind) {
    case 'rename':
      if (
        containsPath(projectRoot, mutation.sourcePath) &&
        containsPath(projectRoot, mutation.targetPath)
      ) {
        return Object.freeze({ treeRevision, ...mutation });
      }
      return intersectsPath(projectRoot, mutation.sourcePath) ||
        intersectsPath(projectRoot, mutation.targetPath)
        ? Object.freeze({ kind: 'reset', treeRevision, rootPath: projectRoot })
        : null;
    case 'remove':
      if (containsPath(projectRoot, mutation.path)) {
        return Object.freeze({ treeRevision, ...mutation });
      }
      return containsPath(mutation.path, projectRoot)
        ? Object.freeze({ kind: 'reset', treeRevision, rootPath: projectRoot })
        : null;
    case 'reset':
      if (containsPath(projectRoot, mutation.rootPath)) {
        return Object.freeze({ treeRevision, ...mutation });
      }
      return containsPath(mutation.rootPath, projectRoot)
        ? Object.freeze({ kind: 'reset', treeRevision, rootPath: projectRoot })
        : null;
  }
}

function projectMutations(
  projectRoot: string,
  records: readonly OwnerVfsAppliedRevision[],
): readonly ProjectVfsAppliedMutation[] {
  const mutations: ProjectVfsAppliedMutation[] = [];
  for (const record of records) {
    for (const mutation of record.mutations) {
      const mapped = projectMutation(projectRoot, record.treeRevision, mutation);
      if (mapped !== null) mutations.push(mapped);
    }
  }
  return Object.freeze(mutations);
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
  const cursor = options.appliedMutations.openCursor();
  const pending = new Set<Promise<void>>();
  let accepting = true;
  let closePromise: Promise<void> | null = null;
  let publishedRevision: number | null = null;
  let publicationAdmissions = 0;
  let resolvePublicationIdle: (() => void) | null = null;
  let fatalError: Error | null = null;
  let pump: Promise<void> | null = null;
  const publicationListeners = new Set<(treeRevision: number) => void>();

  const assertAccepting = (): void => {
    if (!accepting) throw new ClosedHandleError('Workbench Project VFS');
  };

  const notifyPublication = (treeRevision: number): void => {
    const failures: unknown[] = [];
    for (const listener of [...publicationListeners]) {
      try {
        listener(treeRevision);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Workbench Project VFS publication listeners failed');
    }
  };

  const emitInitialSnapshot = (): void => {
    const frame = collectSnapshot(options.authority, projectRoot);
    options.emit({ type: 'workbench:project-vfs-snapshot', frame });
    cursor.acknowledge(frame.treeRevision);
    publishedRevision = frame.treeRevision;
  };

  const rawPublishCurrent = (): void => {
    if (publishedRevision === null) throw new Error('Project VFS page baseline is not ready');
    const fromTreeRevision = publishedRevision;
    const records = cursor.peek();
    if (records.some((record) => record.treeRevision <= fromTreeRevision)) {
      throw new VfsCommitProtocolError('Project VFS journal replayed an acknowledged revision');
    }
    const frame = collectSnapshot(options.authority, projectRoot);
    const finalJournalRevision = records.at(-1)?.treeRevision ?? fromTreeRevision;
    if (frame.treeRevision !== finalJournalRevision) {
      throw new VfsCommitProtocolError(
        `Project VFS journal ended at ${String(finalJournalRevision)} for owner revision ${String(frame.treeRevision)}`,
      );
    }
    options.emit({
      type: 'workbench:project-vfs-state',
      fromTreeRevision,
      mutations: projectMutations(projectRoot, records),
      frame,
    });
    cursor.acknowledge(frame.treeRevision);
    publishedRevision = frame.treeRevision;
    notifyPublication(frame.treeRevision);
  };

  const failOwner = (error: Error): void => {
    if (fatalError !== null) return;
    fatalError = error;
    accepting = false;
    try {
      options.emit({ type: 'workbench:project-vfs-fatal', error: readError(error) });
    } finally {
      options.fatal(error);
    }
  };

  const failOwnerPreserving = (error: unknown): Error => {
    const failure = errorFrom(error);
    try {
      failOwner(failure);
    } catch {
      // Owner termination already received the source failure.
    }
    return failure;
  };

  const publishSnapshot = (): void => {
    assertAccepting();
    try {
      if (publishedRevision === null) emitInitialSnapshot();
      else rawPublishCurrent();
    } catch (error) {
      throw failOwnerPreserving(error);
    }
  };

  const publishThroughCurrent = async (admitted: boolean): Promise<void> => {
    if (admitted) {
      if (fatalError !== null) throw fatalError;
    } else {
      assertAccepting();
    }
    const targetRevision = options.authority.treeRevision;
    if (publishedRevision !== null && publishedRevision >= targetRevision) return;
    try {
      rawPublishCurrent();
    } catch (error) {
      throw failOwnerPreserving(error);
    }
    if (publishedRevision === null || publishedRevision < targetRevision) {
      const error = new VfsCommitProtocolError(
        `Project VFS publication stopped before revision ${String(targetRevision)}`,
      );
      throw failOwnerPreserving(error);
    }
  };

  const publicationBarrier = async (): Promise<void> => {
    assertAccepting();
    while (publicationAdmissions > 0) {
      await awaitPublicationIdle();
      assertAccepting();
    }
    await publishThroughCurrent(false);
  };

  const readConsistent = async <T>(read: () => T | Promise<T>): Promise<T> => {
    assertAccepting();
    if (typeof read !== 'function')
      throw new TypeError('Project VFS consistent read must be a function');
    await publicationBarrier();
    return activePackageMutations.guardedMutation([], async () => {
      assertAccepting();
      return read();
    });
  };

  const startPublicationAdmission = (): void => {
    assertAccepting();
    publicationAdmissions += 1;
  };

  const awaitPublicationIdle = (): Promise<void> => {
    if (publicationAdmissions === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const prior = resolvePublicationIdle;
      resolvePublicationIdle = () => {
        prior?.();
        resolve();
      };
    });
  };

  const finishPublicationAdmission = (): void => {
    publicationAdmissions -= 1;
    if (publicationAdmissions !== 0) return;
    const resolve = resolvePublicationIdle;
    resolvePublicationIdle = null;
    resolve?.();
  };

  const track = (task: Promise<void>): Promise<void> => {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };

  const activePackageMutations: PackageMutationExecutor = {
    ...options.packageMutations,
    guardedMutation(intents, mutate, preflight) {
      return options.packageMutations.guardedMutation(intents, mutate, async () => {
        if (fatalError !== null) throw fatalError;
        return preflight ? await preflight() : { status: 'ready' };
      });
    },
    reset(target, prepare) {
      return options.packageMutations.reset(target, async () => {
        if (fatalError !== null) throw fatalError;
        const plan = await prepare();
        if (fatalError !== null) throw fatalError;
        if (plan.status === 'noop') return plan;
        if (plan.resetDependencyTree) {
          return {
            ...plan,
            mutate: async (resetDependencyTree) => {
              if (fatalError !== null) throw fatalError;
              await plan.mutate(resetDependencyTree);
            },
          };
        }
        return {
          ...plan,
          mutate: async () => {
            if (fatalError !== null) throw fatalError;
            await plan.mutate();
          },
        };
      });
    },
  };

  type MutationOutcome<T> =
    | { readonly kind: 'publish-success'; readonly value: T }
    | { readonly kind: 'publish-failure'; readonly error: unknown }
    | { readonly kind: 'suppress-failure'; readonly error: Error };

  const settleMutationOutcome = <T>(outcome: MutationOutcome<T>): T => {
    if (outcome.kind === 'publish-success') return outcome.value;
    throw outcome.error;
  };

  const applyMutation = async <T>(
    intents: readonly VfsMutationIntent[],
    mutationKind: 'guest' | null,
    apply: () => MutationOutcome<T> | Promise<MutationOutcome<T>>,
  ): Promise<MutationOutcome<T>> => {
    const priorTreeRevision = options.authority.treeRevision;
    const scoped = await options.appliedMutations.withSemanticReplacements(intents, apply);
    if (scoped.kind === 'suppress-failure') {
      // The caller has retained enough private durable state for startup
      // recovery. No tentative/recovered revision crosses to the page.
      cursor.acknowledge(options.authority.treeRevision);
    } else {
      if (mutationKind !== null) {
        await recordAppliedMutation(mutationKind, priorTreeRevision);
      }
      await publishThroughCurrent(true);
    }
    return scoped;
  };

  const recordAppliedMutation = async (
    kind: 'guest' | 'file',
    priorTreeRevision: number,
  ): Promise<void> => {
    const treeRevision = options.authority.treeRevision;
    if (treeRevision <= priorTreeRevision) return;
    await options.recordMutation?.(kind, treeRevision);
  };

  const admitMutation = <T>(
    intents: readonly VfsMutationIntent[],
    mutationKind: 'guest' | null,
    apply: () => MutationOutcome<T> | Promise<MutationOutcome<T>>,
  ): Promise<T> => {
    startPublicationAdmission();
    const operation = (async () => {
      try {
        const outcome = await activePackageMutations.guardedMutation(intents, () =>
          applyMutation(intents, mutationKind, apply),
        );
        return settleMutationOutcome(outcome);
      } finally {
        finishPublicationAdmission();
      }
    })();
    track(operation.then(() => undefined));
    return operation;
  };

  const mutationGuard: VfsMutationGuard = (intents, apply) => {
    return admitMutation(intents, 'guest', async () => {
      try {
        return { kind: 'publish-success', value: await apply() };
      } catch (error) {
        return { kind: 'publish-failure', error };
      }
    });
  };

  const recoverableMutation = async <T>(
    intents: readonly VfsMutationIntent[],
    apply: () =>
      | WorkbenchRecoverableMutationResult<T>
      | Promise<WorkbenchRecoverableMutationResult<T>>,
  ): Promise<T> => {
    await publicationBarrier();
    return admitMutation(intents, null, async () => {
      const result = await apply();
      return result.status === 'committed'
        ? { kind: 'publish-success', value: result.value }
        : { kind: 'suppress-failure', error: result.error };
    });
  };

  const recoverableProjectReplace = async <T>(
    prepare: () => void | Promise<void>,
    apply: () =>
      | WorkbenchRecoverableMutationResult<T>
      | Promise<WorkbenchRecoverableMutationResult<T>>,
  ): Promise<T> => {
    await publicationBarrier();
    const intents = Object.freeze([{ kind: 'replace' as const, path: projectRoot }]);
    startPublicationAdmission();
    const operation = (async () => {
      let outcome: MutationOutcome<T> | undefined;
      try {
        await activePackageMutations.reset({ root: projectRoot }, async () => {
          await prepare();
          return {
            status: 'ready',
            resetDependencyTree: true,
            mutate: async (resetDependencyTree) => {
              outcome = await applyMutation(intents, null, async () => {
                try {
                  if (resetDependencyTree === undefined) {
                    throw new Error('recoverable project replacement package reset is missing');
                  }
                  await resetDependencyTree();
                  const result = await apply();
                  return result.status === 'committed'
                    ? { kind: 'publish-success', value: result.value }
                    : { kind: 'suppress-failure', error: result.error };
                } catch (error) {
                  return { kind: 'suppress-failure', error: errorFrom(error) };
                }
              });
            },
          };
        });
        if (outcome === undefined) {
          throw new Error('recoverable project replacement did not apply');
        }
        return settleMutationOutcome(outcome);
      } catch (error) {
        if (outcome === undefined) cursor.acknowledge(options.authority.treeRevision);
        throw error;
      } finally {
        finishPublicationAdmission();
      }
    })();
    track(operation.then(() => undefined));
    return operation;
  };

  const startPump = (): void => {
    if (pump !== null) return;
    pump = (async () => {
      while (accepting) {
        try {
          await cursor.wait();
        } catch (error) {
          if (!accepting) return;
          throw error;
        }
        while (publicationAdmissions > 0) await awaitPublicationIdle();
        if (!accepting) return;
        if (cursor.peek().length === 0) continue;
        try {
          rawPublishCurrent();
        } catch (error) {
          throw failOwnerPreserving(error);
        }
      }
    })();
    void pump.catch((error: unknown) => {
      failOwnerPreserving(error);
    });
  };

  const handleCommit = (
    frame: Extract<PageProjectVfsFrame, { readonly type: 'rifty:owner-vfs-commit' }>,
  ): Promise<void> => {
    startPublicationAdmission();
    let publicationFailure: Error | null = null;
    const completed = deferredCompletion();
    const task = track(completed.promise);
    try {
      handleOwnerVfsCommitRequest({
        message: frame,
        admit: (request) =>
          options.authority.admitHostCommit(
            request,
            async (candidate) => {
              const priorTreeRevision = options.authority.treeRevision;
              const ack = await applyPackageAwareHostCommit(
                options.authority,
                activePackageMutations,
                projectRoot,
                candidate,
              );
              await recordAppliedMutation('file', priorTreeRevision);
              return ack;
            },
            () => {
              try {
                rawPublishCurrent();
              } catch (error) {
                publicationFailure = errorFrom(error);
                throw error;
              }
            },
          ),
        send: (terminal) => {
          try {
            if (fatalError !== null) throw fatalError;
            options.emit(terminal);
            if (publicationFailure !== null) failOwner(publicationFailure);
            completed.resolve();
          } catch (error) {
            try {
              failOwner(errorFrom(error));
            } catch {
              // The fatal callback owns owner termination after transport failure.
            }
            completed.reject(errorFrom(error));
          } finally {
            finishPublicationAdmission();
          }
        },
        reportError: (error) => {
          finishPublicationAdmission();
          completed.reject(error);
        },
      });
    } catch (error) {
      finishPublicationAdmission();
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
              failureScope: (path) => path === projectRoot || path.startsWith(`${projectRoot}/`),
              send: options.emit,
            }),
          );
        case 'workbench:project-vfs-snapshot-request':
          publishSnapshot();
          startPump();
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
    publishSnapshot() {
      publishSnapshot();
      startPump();
    },
    subscribePublications(listener: (treeRevision: number) => void) {
      assertAccepting();
      if (typeof listener !== 'function') {
        throw new TypeError('Project VFS publication listener must be a function');
      }
      publicationListeners.add(listener);
      return () => publicationListeners.delete(listener);
    },
    mutationGuard,
    recoverableMutation,
    recoverableProjectReplace,
    publicationBarrier,
    readConsistent,
    close() {
      if (closePromise !== null) return closePromise;
      accepting = false;
      publicationListeners.clear();
      const admitted = [...pending, awaitPublicationIdle()];
      closePromise = Promise.allSettled(admitted).then(async (results) => {
        cursor.close();
        const pumpResults = pump === null ? [] : await Promise.allSettled([pump]);
        const failures: Error[] = [];
        for (const result of [...results, ...pumpResults]) {
          if (result.status !== 'rejected') continue;
          const failure = errorFrom(result.reason);
          if (!failures.includes(failure)) failures.push(failure);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'Workbench Project VFS close failed');
        }
      });
      return closePromise;
    },
  });
}
