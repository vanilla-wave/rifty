import type { OwnerVfsClientTimers } from '../glue/owner-vfs-client.ts';
import { createOwnerVfsClient } from '../glue/owner-vfs-client.ts';
import type { HostCommitOperation, OwnerEpoch, TreeRevision } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitProtocolError } from '../glue/owner-vfs-protocol.ts';
import { SnapshotFs } from '../glue/snapshot-fs.ts';
import type {
  VfsCommitCoordinator,
  VfsCommitObservation,
  VfsCommitOwner,
  VfsCommitReceipt,
} from '../glue/vfs-commit-coordinator.ts';
import { createVfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import { ClosedHandleError } from './errors.ts';
import {
  type ProjectContentController,
  createProjectContentController,
} from './project-content.ts';
import type { ProjectDocumentReadEntry } from './project-documents.ts';
import type { ProjectDocumentsMutation } from './project-documents.ts';
import { type OwnerProjectFileEntry, toProjectPath } from './project-file-boundary.ts';
import type {
  OwnerProjectVfsFrame,
  PageProjectVfsFrame,
  ProjectVfsAppliedMutation,
  ProjectVfsReadDirectoryResult,
  ProjectVfsReadFileResult,
  ProjectVfsStateMessage,
} from './project-vfs-protocol.ts';
import { inspectOwnerProjectVfsFrame } from './project-vfs-protocol.ts';

export interface ProjectContentTransportOptions {
  readonly projectRoot: string;
  /** `false` proves the frame was not admitted by the owner transport. */
  readonly send: (frame: PageProjectVfsFrame) => boolean;
  readonly isAlive: () => boolean;
  readonly generateRequestId: () => string;
  readonly commitTimeoutMs: number;
  readonly timers?: OwnerVfsClientTimers;
  readonly reportProtocolError?: (error: VfsCommitProtocolError) => void;
}

export interface ProjectContentTransport {
  /** Resolves only after the exact owner's first complete project snapshot. */
  readonly ready: Promise<ProjectContentController>;
  accept(frame: OwnerProjectVfsFrame): void;
  /** Certified owner exit: reject all admitted work and empty the page mirror. */
  disconnect(error?: Error): void;
}

interface AtomicDirectoryRead {
  readonly entries: readonly OwnerProjectFileEntry[];
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
}

interface PendingFileRead {
  readonly kind: 'file';
  readonly path: string;
  readonly ownerEpoch: OwnerEpoch;
  resolve(value: ProjectDocumentReadEntry): void;
  reject(error: Error): void;
}

interface PendingDirectoryRead {
  readonly kind: 'directory';
  readonly path: string;
  readonly ownerEpoch: OwnerEpoch;
  resolve(value: AtomicDirectoryRead): void;
  reject(error: Error): void;
}

type PendingRead = PendingFileRead | PendingDirectoryRead;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function ownerReadError(error: { readonly name: string; readonly message: string }): Error {
  const decoded = new Error(error.message);
  decoded.name = error.name;
  return decoded;
}

function assertReadRevision(
  ownerEpoch: OwnerEpoch,
  treeRevision: TreeRevision,
  expectedOwnerEpoch: OwnerEpoch,
  label: string,
): void {
  if (
    ownerEpoch !== expectedOwnerEpoch ||
    !Number.isSafeInteger(treeRevision) ||
    treeRevision < 0
  ) {
    throw new VfsCommitProtocolError(`Project VFS ${label} result did not match its request`);
  }
}

function cloneFileRead(
  frame: Extract<ProjectVfsReadFileResult, { readonly ok: true }>,
): ProjectDocumentReadEntry {
  return Object.freeze({
    ...frame.entry,
    content: frame.entry.content.slice(),
    ownerEpoch: frame.ownerEpoch,
    treeRevision: frame.treeRevision,
  });
}

function cloneDirectoryRead(
  frame: Extract<ProjectVfsReadDirectoryResult, { readonly ok: true }>,
): AtomicDirectoryRead {
  return Object.freeze({
    entries: Object.freeze(frame.entries.map((entry) => Object.freeze({ ...entry }))),
    ownerEpoch: frame.ownerEpoch,
    treeRevision: frame.treeRevision,
  });
}

function documentMutation(
  projectRoot: string,
  mutation: ProjectVfsAppliedMutation,
): ProjectDocumentsMutation {
  switch (mutation.kind) {
    case 'rename':
      return Object.freeze({
        kind: mutation.kind,
        sourcePath: toProjectPath(projectRoot, mutation.sourcePath),
        targetPath: toProjectPath(projectRoot, mutation.targetPath),
      });
    case 'remove':
      return Object.freeze({
        kind: mutation.kind,
        path: toProjectPath(projectRoot, mutation.path),
        recursive: mutation.recursive,
      });
    case 'reset':
      return Object.freeze({
        kind: mutation.kind,
        rootPath: toProjectPath(projectRoot, mutation.rootPath),
      });
  }
}

/**
 * Session-local Project VFS composition. Owner identity, request correlation,
 * mirror reflection, commit replay, and durability stay behind one transport.
 */
export function createProjectContentTransport(
  options: ProjectContentTransportOptions,
): ProjectContentTransport {
  const mirror = new SnapshotFs(options.projectRoot);
  const reads = new Map<string, PendingRead>();
  const pendingCommits = new Set<Promise<unknown>>();
  let ownerEpoch: OwnerEpoch | null = null;
  let lastAcceptedRevision: TreeRevision | null = null;
  let content: ProjectContentController | null = null;
  let closedError: Error | null = null;
  let ownerClosed = false;
  let resolveOwnerClosed: (reason: unknown) => void = () => {};
  const closed = new Promise<unknown>((resolve) => {
    resolveOwnerClosed = resolve;
  });
  let resolveReady: (content: ProjectContentController) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  let readySettled = false;
  const ready = new Promise<ProjectContentController>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});

  const reportProtocolError = (error: VfsCommitProtocolError): void => {
    options.reportProtocolError?.(error);
  };

  const client = createOwnerVfsClient({
    send: options.send,
    currentOwnerEpoch: () => ownerEpoch,
    isAlive: () => closedError === null && options.isAlive(),
    generateBarrierId: options.generateRequestId,
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    reportProtocolError,
  });

  const capturedOwner: VfsCommitOwner = Object.freeze({
    get ownerEpoch() {
      if (ownerEpoch === null) throw new Error('Project VFS owner is not ready');
      return ownerEpoch;
    },
    isAlive: () => closedError === null && options.isAlive(),
    closed,
    applyHostCommit: client.applyHostCommit,
    durabilityBarrier: client.durabilityBarrier,
  });

  const committer = createVfsCommitCoordinator({
    captureOwner() {
      if (ownerEpoch === null || closedError !== null) {
        throw closedError ?? new Error('Project VFS owner is not ready');
      }
      return capturedOwner;
    },
    subscribeSnapshots: (listener) => mirror.subscribeRevisions(listener),
    timeoutMs: options.commitTimeoutMs,
  });
  const trackedCommitter: VfsCommitCoordinator = Object.freeze({
    commit(
      operation: HostCommitOperation,
      observation?: VfsCommitObservation,
    ): Promise<VfsCommitReceipt> {
      const pending = committer.commit(operation, observation);
      pendingCommits.add(pending);
      void pending.then(
        () => pendingCommits.delete(pending),
        () => pendingCommits.delete(pending),
      );
      return pending;
    },
    close: (error?: Error) => committer.close(error),
  });

  const awaitAdmittedCommits = async (): Promise<void> => {
    while (pendingCommits.size > 0) {
      await Promise.all(
        [...pendingCommits].map((pending) =>
          pending.then(
            () => {},
            () => {},
          ),
        ),
      );
    }
  };

  const rejectProtocol = (pending: PendingRead, message: string): never => {
    const error = new VfsCommitProtocolError(message);
    pending.reject(error);
    reportProtocolError(error);
    throw error;
  };

  const claimRead = (pending: PendingRead): string => {
    const requestId = options.generateRequestId();
    if (typeof requestId !== 'string' || requestId.length === 0 || reads.has(requestId)) {
      throw new Error('Project VFS generated a duplicate or empty read request id');
    }
    reads.set(requestId, pending);
    return requestId;
  };

  const readVersionedFile = (path: string): Promise<ProjectDocumentReadEntry> => {
    if (closedError !== null || !options.isAlive()) {
      return Promise.reject(closedError ?? new ClosedHandleError('Project content transport'));
    }
    const boundOwner = ownerEpoch;
    if (boundOwner === null) return Promise.reject(new Error('Project VFS owner is not ready'));

    return new Promise<ProjectDocumentReadEntry>((resolve, reject) => {
      const pending: PendingFileRead = {
        kind: 'file',
        path,
        ownerEpoch: boundOwner,
        resolve,
        reject,
      };
      let requestId: string | null = null;
      try {
        requestId = claimRead(pending);
        if (!options.send({ type: 'workbench:project-vfs-read-file', requestId, path })) {
          reads.delete(requestId);
          reject(new Error(`Project VFS read-file send failed (${requestId})`));
        }
      } catch (error) {
        if (requestId !== null) reads.delete(requestId);
        reject(toError(error));
      }
    });
  };

  const readVersionedDirectory = (path: string): Promise<AtomicDirectoryRead> => {
    if (closedError !== null || !options.isAlive()) {
      return Promise.reject(closedError ?? new ClosedHandleError('Project content transport'));
    }
    const boundOwner = ownerEpoch;
    if (boundOwner === null) return Promise.reject(new Error('Project VFS owner is not ready'));

    return new Promise<AtomicDirectoryRead>((resolve, reject) => {
      const pending: PendingDirectoryRead = {
        kind: 'directory',
        path,
        ownerEpoch: boundOwner,
        resolve,
        reject,
      };
      let requestId: string | null = null;
      try {
        requestId = claimRead(pending);
        if (!options.send({ type: 'workbench:project-vfs-read-directory', requestId, path })) {
          reads.delete(requestId);
          reject(new Error(`Project VFS read-directory send failed (${requestId})`));
        }
      } catch (error) {
        if (requestId !== null) reads.delete(requestId);
        reject(toError(error));
      }
    });
  };

  const acceptFileResult = (frame: ProjectVfsReadFileResult): void => {
    const pending = reads.get(frame.requestId);
    if (pending === undefined) {
      throw new VfsCommitProtocolError('Project VFS read-file result has no matching request');
    }
    reads.delete(frame.requestId);
    if (pending.kind !== 'file') {
      rejectProtocol(pending, 'Project VFS read-file result did not match its request');
      return;
    }
    if (!frame.ok) {
      pending.reject(ownerReadError(frame.error));
      return;
    }
    try {
      assertReadRevision(frame.ownerEpoch, frame.treeRevision, pending.ownerEpoch, 'read-file');
      if (frame.entry.path !== pending.path) {
        throw new VfsCommitProtocolError('Project VFS read-file result did not match its request');
      }
      pending.resolve(cloneFileRead(frame));
    } catch (error) {
      rejectProtocol(
        pending,
        error instanceof VfsCommitProtocolError
          ? error.message
          : 'Project VFS read-file result did not match its request',
      );
    }
  };

  const acceptDirectoryResult = (frame: ProjectVfsReadDirectoryResult): void => {
    const pending = reads.get(frame.requestId);
    if (pending === undefined) {
      throw new VfsCommitProtocolError('Project VFS read-directory result has no matching request');
    }
    reads.delete(frame.requestId);
    if (pending.kind !== 'directory') {
      rejectProtocol(pending, 'Project VFS read-directory result did not match its request');
      return;
    }
    if (!frame.ok) {
      pending.reject(ownerReadError(frame.error));
      return;
    }
    try {
      assertReadRevision(
        frame.ownerEpoch,
        frame.treeRevision,
        pending.ownerEpoch,
        'read-directory',
      );
      pending.resolve(cloneDirectoryRead(frame));
    } catch (error) {
      rejectProtocol(
        pending,
        error instanceof VfsCommitProtocolError
          ? error.message
          : 'Project VFS read-directory result did not match its request',
      );
    }
  };

  const acceptSnapshot = (
    frame: Extract<OwnerProjectVfsFrame, { readonly type: 'workbench:project-vfs-snapshot' }>,
  ): void => {
    if (ownerEpoch !== null) {
      throw new VfsCommitProtocolError(
        frame.frame.ownerEpoch === ownerEpoch
          ? 'Project VFS received a duplicate initial snapshot'
          : 'Project VFS initial snapshot owner mismatch',
      );
    }
    if (frame.frame.root !== options.projectRoot) {
      throw new VfsCommitProtocolError('Project VFS snapshot root mismatch');
    }
    ownerEpoch = frame.frame.ownerEpoch;
    mirror.bindOwner(ownerEpoch, options.projectRoot);
    mirror.update(frame.frame);
    lastAcceptedRevision = frame.frame.treeRevision;
    const controller = createProjectContentController({
      projectRoot: options.projectRoot,
      snapshots: mirror,
      committer: trackedCommitter,
      readVersionedFile,
      readVersionedDirectory: async (path) => (await readVersionedDirectory(path)).entries,
    });
    content = Object.freeze({
      files: controller.files,
      documents: controller.documents,
      invalidate: controller.invalidate,
      invalidateAll: controller.invalidateAll,
      preflightClose: controller.preflightClose,
      async close() {
        await controller.close();
        await awaitAdmittedCommits();
      },
    });
    readySettled = true;
    resolveReady(content);
  };

  const stateFailure = (error: unknown): never => {
    const failure =
      error instanceof VfsCommitProtocolError
        ? error
        : new VfsCommitProtocolError(`Project VFS state rejected: ${toError(error).message}`);
    disconnect(failure);
    throw failure;
  };

  const acceptState = (state: ProjectVfsStateMessage): void => {
    try {
      if (ownerEpoch === null || content === null || lastAcceptedRevision === null) {
        throw new VfsCommitProtocolError('Project VFS state arrived before its initial snapshot');
      }
      if (state.frame.ownerEpoch !== ownerEpoch) {
        throw new VfsCommitProtocolError('Project VFS state owner mismatch');
      }
      if (state.frame.root !== options.projectRoot) {
        throw new VfsCommitProtocolError('Project VFS state root mismatch');
      }
      if (state.fromTreeRevision !== lastAcceptedRevision) {
        throw new VfsCommitProtocolError(
          `Project VFS state started at revision ${String(state.fromTreeRevision)}; expected ${String(lastAcceptedRevision)}`,
        );
      }

      const mutations = state.mutations.map((mutation) => ({
        mutation: documentMutation(options.projectRoot, mutation),
        revision: mutation.treeRevision,
      }));
      for (const applied of mutations) {
        content.invalidate(applied.mutation, {
          ownerEpoch,
          treeRevision: applied.revision,
        });
      }
      mirror.update(state.frame);
      lastAcceptedRevision = state.frame.treeRevision;
    } catch (error) {
      stateFailure(error);
    }
  };

  const accept = (candidate: OwnerProjectVfsFrame): void => {
    if (closedError !== null) return;
    let frame = candidate;
    if (
      candidate.type === 'workbench:project-vfs-state' ||
      candidate.type === 'workbench:project-vfs-fatal'
    ) {
      try {
        frame = inspectOwnerProjectVfsFrame(candidate);
      } catch (error) {
        stateFailure(error);
      }
    }
    if (frame.type === 'workbench:project-vfs-fatal') {
      disconnect(ownerReadError(frame.error));
      return;
    }
    if (client.accept(frame)) return;
    switch (frame.type) {
      case 'workbench:project-vfs-snapshot': {
        try {
          acceptSnapshot(frame);
        } catch (error) {
          stateFailure(error);
        }
        return;
      }
      case 'workbench:project-vfs-state':
        acceptState(frame);
        return;
      case 'workbench:project-vfs-read-file-result':
        acceptFileResult(frame);
        return;
      case 'workbench:project-vfs-read-directory-result':
        acceptDirectoryResult(frame);
        return;
      default:
        throw new VfsCommitProtocolError(`Project VFS client rejected owner frame ${frame.type}`);
    }
  };

  const disconnect = (error: Error = new ClosedHandleError('Project content transport')): void => {
    if (closedError !== null) return;
    closedError = error;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    for (const [requestId, pending] of reads) {
      reads.delete(requestId);
      pending.reject(error);
    }
    content?.invalidateAll('reset');
    client.disconnect();
    if (!ownerClosed) {
      ownerClosed = true;
      resolveOwnerClosed(error);
    }
    committer.close(error);
    mirror.clear();
  };

  const transport = Object.freeze({ ready, accept, disconnect });
  try {
    if (!options.send({ type: 'workbench:project-vfs-snapshot-request' })) {
      disconnect(new Error('Project VFS snapshot request send failed'));
    }
  } catch (error) {
    disconnect(toError(error));
  }
  return transport;
}
