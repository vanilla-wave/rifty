import type { GitIdentity, makeGit } from '@riftydev/git';
import type { SpawnWorkerSpec } from '@riftydev/kernel';
import type { Vfs } from '@riftydev/vfs';
import { serializeWorkbenchOwnerError } from '../workbench/errors.ts';
import { ClosedHandleError } from '../workbench/errors.ts';
import {
  type PlaygroundScm,
  createPlaygroundScmAdapter,
} from '../workbench/internal/playground-scm.ts';
import {
  type OwnerPlaygroundSessionToolsFrame,
  PLAYGROUND_PERSISTENCE_FAILURE_NAME,
  type PagePlaygroundSessionToolsFrame,
  type PlaygroundSessionToolOperation,
  type PlaygroundSessionToolResult,
  type PlaygroundSessionToolsOperationalHealth,
  assertSessionToolsTsRequestScope,
  inspectOwnerPlaygroundSessionToolsFrame,
  inspectPagePlaygroundSessionToolsFrame,
  inspectPlaygroundScmSnapshot,
  operationalHealthForScmSnapshot,
} from '../workbench/internal/playground-session-tools-transport.ts';
import { formatProjectPersistenceFailure } from '../workbench/project-file-boundary.ts';
import type { OwnerPackageState } from './owner-package-state.ts';
import {
  type OwnerVfsAuthorityComposition,
  ownerVfsScopeHasFailure,
} from './owner-vfs-authority.ts';
import {
  createOwnerPlaygroundArchive,
  recoverOwnerPlaygroundArchiveTransaction,
  runPlaygroundArchivePublicOperation,
} from './playground-archive-integration.ts';
import { type TsLspChildHandle, createTsLspOwnerRelay } from './ts-lsp-owner-relay.ts';
import type { WorkbenchProjectVfs } from './workbench-project-vfs.ts';

export interface CreateOwnerPlaygroundSessionToolsOptions {
  readonly projectRoot: string;
  readonly owner: OwnerVfsAuthorityComposition;
  readonly packages: OwnerPackageState;
  readonly projectVfs: WorkbenchProjectVfs;
  readonly vfs: Vfs;
  readonly git: ReturnType<typeof makeGit>;
  readonly commitIdentity: GitIdentity;
  readonly tsWorkerUrl: string;
  readonly nodeWorkerRuntimeEnv: Readonly<Record<string, string>>;
  readonly send: (frame: OwnerPlaygroundSessionToolsFrame) => boolean | undefined;
  /** Invariant failure sink; operational SCM failures use the health stream. */
  readonly fatal: (error: Error) => void;
  /** Exact companion catalog reflection; absent for non-companion fixtures. */
  readonly recordMutation?: (kind: 'scm' | 'archive', treeRevision: number) => Promise<void>;
  readonly log: (line: string) => void;
  /** Test seam at the real kernel worker-spawn boundary. */
  readonly spawnTsWorker?: (spec: SpawnWorkerSpec) => TsLspChildHandle;
}

export interface OwnerPlaygroundSessionTools {
  readonly initialScmSnapshot: ReturnType<typeof inspectPlaygroundScmSnapshot>;
  handle(frame: PagePlaygroundSessionToolsFrame): Promise<void>;
  close(): Promise<void>;
}

function persistenceFailure(
  report: Awaited<ReturnType<OwnerVfsAuthorityComposition['authority']['flush']>>,
  operation: 'SCM' | 'save',
  projectRoot: string,
): Error | null {
  if (report === undefined) return null;
  const inProject = (path: string): boolean =>
    path === projectRoot || path.startsWith(`${projectRoot}/`);
  if (!ownerVfsScopeHasFailure(report, inProject)) return null;
  const sample = report.failures
    .filter((failure) => inProject(failure.path))
    .map((failure) => formatProjectPersistenceFailure(projectRoot, failure))
    .join('; ');
  const error = new Error(
    `Playground ${operation} persistence has an unhealed project failure${sample.length > 0 ? `: ${sample}` : ''}`,
  );
  error.name = PLAYGROUND_PERSISTENCE_FAILURE_NAME;
  return error;
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function scmSnapshotSignature(snapshot: ReturnType<typeof inspectPlaygroundScmSnapshot>): string {
  return JSON.stringify([
    snapshot.branch ?? null,
    snapshot.history.map((entry) => entry.oid),
    snapshot.changes.map((change) =>
      'rawStatusMatrixCode' in change
        ? [change.path, 'unsupported', change.rawStatusMatrixCode]
        : [change.path, change.code, change.area],
    ),
  ]);
}

/** One owner-side authority for the finite TS/SCM/archive session companion. */
export async function createOwnerPlaygroundSessionTools(
  options: CreateOwnerPlaygroundSessionToolsOptions,
): Promise<OwnerPlaygroundSessionTools> {
  await recoverOwnerPlaygroundArchiveTransaction({
    projectRoot: options.projectRoot,
    owner: options.owner,
    packages: options.packages,
  });
  const scm: PlaygroundScm = await createPlaygroundScmAdapter({
    projectRoot: options.projectRoot,
    vfs: options.vfs,
    git: options.git,
    commitIdentity: options.commitIdentity,
  });
  const archive = await createOwnerPlaygroundArchive({
    projectRoot: options.projectRoot,
    owner: options.owner,
    packages: options.packages,
    projectVfs: options.projectVfs,
  });

  const emit = (frame: OwnerPlaygroundSessionToolsFrame): void => {
    const inspected = inspectOwnerPlaygroundSessionToolsFrame(frame);
    if (options.send(inspected) === false) {
      throw new Error('Playground session tools owner transport refused a frame');
    }
  };

  const ts = createTsLspOwnerRelay({
    projectRoot: options.projectRoot,
    workerUrl: options.tsWorkerUrl,
    nodeWorkerRuntimeEnv: options.nodeWorkerRuntimeEnv,
    packages: options.packages,
    send: (message) =>
      options.send(
        inspectOwnerPlaygroundSessionToolsFrame({
          type: 'workbench:playground-session-tools-ts-response',
          message,
        }),
      ),
    log: options.log,
    ...(options.spawnTsWorker === undefined ? {} : { spawnWorker: options.spawnTsWorker }),
  });

  let latestScmSnapshot = inspectPlaygroundScmSnapshot(scm.snapshot());
  let replay = true;
  const unsubscribeScm = scm.subscribe((snapshot) => {
    latestScmSnapshot = inspectPlaygroundScmSnapshot(snapshot);
    if (replay) replay = false;
  });
  const initialScmSnapshot = latestScmSnapshot;
  const seenRequestIds = new Set<string>();
  let accepting = true;
  let tail: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | null = null;
  let requestedScmRevision = options.owner.authority.treeRevision;
  let reflectedScmRevision = requestedScmRevision;
  let automaticRefreshAttemptedRevision = reflectedScmRevision;
  let publishedScmSignature = scmSnapshotSignature(initialScmSnapshot);
  let automaticRefreshQueued = false;
  let invariantFailure: Error | null = null;

  const revision = () =>
    Object.freeze({
      ownerEpoch: options.owner.authority.ownerEpoch,
      treeRevision: options.owner.authority.treeRevision,
    });

  const publishScm = (force = true): void => {
    const signature = scmSnapshotSignature(latestScmSnapshot);
    if (!force && signature === publishedScmSignature) return;
    emit({
      type: 'workbench:playground-session-tools-scm-snapshot',
      snapshot: latestScmSnapshot,
    });
    publishedScmSignature = signature;
  };

  const publishOperationalHealth = (health: PlaygroundSessionToolsOperationalHealth): void => {
    emit({
      type: 'workbench:playground-session-tools-operational-health',
      health,
    });
  };

  const publishScmClassificationHealth = (): void => {
    publishOperationalHealth(operationalHealthForScmSnapshot(latestScmSnapshot));
  };

  const publishDegradedScm = (error: Error): void => {
    publishOperationalHealth(
      Object.freeze({
        scope: 'scm',
        status: 'degraded',
        error: serializeWorkbenchOwnerError(error),
      }),
    );
  };

  const settleScmMutation = async (): Promise<void> => {
    const failed = persistenceFailure(
      await options.owner.authority.flush(),
      'SCM',
      options.projectRoot,
    );
    if (failed !== null) throw failed;
    await options.projectVfs.publicationBarrier();
  };

  const flushDurability = async (): Promise<void> => {
    await options.projectVfs.publicationBarrier();
    const failed = persistenceFailure(
      await options.owner.authority.flush(),
      'save',
      options.projectRoot,
    );
    if (failed !== null) throw failed;
  };

  const readScm = async (): Promise<{
    readonly targetRevision: number;
    readonly failure: Error | null;
  }> => {
    let targetRevision = requestedScmRevision;
    let failure: Error | null = null;
    await options.projectVfs.readConsistent(async () => {
      targetRevision = requestedScmRevision;
      try {
        await scm.refresh();
      } catch (error) {
        failure = errorFrom(error);
      }
    });
    return Object.freeze({ targetRevision, failure });
  };

  const settleSuccessfulRefresh = (
    targetRevision: number,
    force: boolean,
  ): ReturnType<typeof inspectPlaygroundScmSnapshot> => {
    reflectedScmRevision = Math.max(reflectedScmRevision, targetRevision);
    publishScm(force);
    publishScmClassificationHealth();
    return latestScmSnapshot;
  };

  const refreshScm = async (
    force = true,
  ): Promise<ReturnType<typeof inspectPlaygroundScmSnapshot>> => {
    const read = await readScm();
    if (read.failure !== null) {
      publishDegradedScm(read.failure);
      throw read.failure;
    }
    return settleSuccessfulRefresh(read.targetRevision, force);
  };

  const failInvariant = (error: unknown): void => {
    if (invariantFailure !== null) return;
    invariantFailure = errorFrom(error);
    accepting = false;
    try {
      options.fatal(invariantFailure);
    } catch {
      // Owner termination already received the exact invariant failure.
    }
  };

  const refreshPublishedRevisions = async (): Promise<void> => {
    if (!accepting || automaticRefreshAttemptedRevision >= requestedScmRevision) return;
    automaticRefreshAttemptedRevision = requestedScmRevision;
    const read = await readScm();
    automaticRefreshAttemptedRevision = Math.max(
      automaticRefreshAttemptedRevision,
      read.targetRevision,
    );
    if (read.failure !== null) {
      publishDegradedScm(read.failure);
      return;
    }
    settleSuccessfulRefresh(read.targetRevision, false);
  };

  const queueAutomaticRefresh = (): void => {
    if (!accepting || automaticRefreshQueued) return;
    automaticRefreshQueued = true;
    const operation = tail.then(refreshPublishedRevisions);
    tail = operation.then(
      () => {
        automaticRefreshQueued = false;
        if (accepting && automaticRefreshAttemptedRevision < requestedScmRevision) {
          queueAutomaticRefresh();
        }
      },
      (error: unknown) => {
        automaticRefreshQueued = false;
        failInvariant(error);
      },
    );
  };

  const noteProjectPublication = (treeRevision: number): void => {
    if (!accepting || treeRevision <= requestedScmRevision) return;
    requestedScmRevision = treeRevision;
    queueAutomaticRefresh();
  };

  const unsubscribeProjectPublications =
    options.projectVfs.subscribePublications(noteProjectPublication);

  const mutateScm = async <T>(operation: () => Promise<T>): Promise<T> => {
    const priorTreeRevision = options.owner.authority.treeRevision;
    const result = await operation();
    if (options.owner.authority.treeRevision > priorTreeRevision) {
      await options.recordMutation?.('scm', options.owner.authority.treeRevision);
    }
    await settleScmMutation();
    publishScm();
    publishScmClassificationHealth();
    return result;
  };

  const execute = async (
    operation: Exclude<PlaygroundSessionToolOperation, { readonly type: 'close' }>,
  ): Promise<PlaygroundSessionToolResult> => {
    switch (operation.type) {
      case 'scm:refresh':
        return Object.freeze({ type: 'scm:snapshot', snapshot: await refreshScm() });
      case 'scm:diff':
        return Object.freeze({ type: 'scm:diff', diff: await scm.diff(operation.change) });
      case 'scm:stage':
        await mutateScm(() => scm.stage(operation.path));
        return Object.freeze({ type: 'scm:void' });
      case 'scm:unstage':
        await mutateScm(() => scm.unstage(operation.path));
        return Object.freeze({ type: 'scm:void' });
      case 'scm:discard':
        await mutateScm(() => scm.discard(operation.path));
        return Object.freeze({ type: 'scm:revision', revision: revision() });
      case 'scm:commit': {
        const oid = await mutateScm(() => scm.commit(operation.message));
        return Object.freeze({ type: 'scm:commit', oid });
      }
      case 'archive:export':
        return Object.freeze({ type: 'archive:export', archiveJson: await archive.export() });
      case 'archive:import':
        return runPlaygroundArchivePublicOperation(options.projectRoot, async () => {
          const priorTreeRevision = options.owner.authority.treeRevision;
          await archive.import(operation.archiveJson, () => {});
          if (options.owner.authority.treeRevision > priorTreeRevision) {
            await options.recordMutation?.('archive', options.owner.authority.treeRevision);
          }
          await options.projectVfs.publicationBarrier();
          await refreshScm();
          return Object.freeze({ type: 'archive:import', revision: revision() });
        });
      case 'durability:flush':
        await flushDurability();
        return Object.freeze({ type: 'durability:void' });
    }
  };

  const respond = async (
    requestId: string,
    operation: Exclude<PlaygroundSessionToolOperation, { readonly type: 'close' }>,
  ): Promise<void> => {
    try {
      emit({
        type: 'workbench:playground-session-tools-response',
        requestId,
        response: { ok: true, result: await execute(operation) },
      });
    } catch (error) {
      emit({
        type: 'workbench:playground-session-tools-response',
        requestId,
        response: { ok: false, error: serializeWorkbenchOwnerError(error) },
      });
    }
  };

  const beginClose = (prior: Promise<void>): Promise<void> => {
    if (closePromise !== null) return closePromise;
    accepting = false;
    closePromise = (async () => {
      const failures: unknown[] = [];
      if (invariantFailure !== null) failures.push(invariantFailure);
      try {
        unsubscribeProjectPublications();
      } catch (error) {
        failures.push(error);
      }
      try {
        await prior;
      } catch (error) {
        failures.push(error);
      }
      try {
        unsubscribeScm();
      } catch (error) {
        failures.push(error);
      }
      try {
        await ts.close();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Playground session tools owner close failed');
      }
    })();
    return closePromise;
  };

  const handle = (candidate: PagePlaygroundSessionToolsFrame): Promise<void> => {
    let frame: PagePlaygroundSessionToolsFrame;
    try {
      frame = inspectPagePlaygroundSessionToolsFrame(candidate);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!accepting) return Promise.reject(new ClosedHandleError('Playground session tools owner'));
    if (frame.type === 'workbench:playground-session-tools-ts-request') {
      try {
        assertSessionToolsTsRequestScope(frame.message, options.projectRoot);
      } catch (error) {
        return Promise.reject(error);
      }
      return ts.handle(frame.message);
    }
    if (seenRequestIds.has(frame.requestId)) {
      return Promise.reject(
        new TypeError(`Playground session tools duplicate request id ${frame.requestId}`),
      );
    }
    seenRequestIds.add(frame.requestId);
    const requestedOperation = frame.operation;
    if (requestedOperation.type === 'close') {
      const closing = beginClose(tail);
      const response = closing.then(
        () =>
          emit({
            type: 'workbench:playground-session-tools-response',
            requestId: frame.requestId,
            response: { ok: true, result: { type: 'closed' } },
          }),
        (error: unknown) =>
          emit({
            type: 'workbench:playground-session-tools-response',
            requestId: frame.requestId,
            response: { ok: false, error: serializeWorkbenchOwnerError(error) },
          }),
      );
      tail = response.catch(() => {});
      return response;
    }

    const operation = tail.then(() => respond(frame.requestId, requestedOperation));
    tail = operation.catch(() => {});
    return operation;
  };

  return Object.freeze({
    initialScmSnapshot,
    handle,
    close: () => beginClose(tail),
  });
}
