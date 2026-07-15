import type { OwnerVfsSnapshotEntry } from '../glue/owner-vfs-protocol.ts';
import { VfsCommitAppliedError } from '../glue/owner-vfs-protocol.ts';
import {
  DirtyProjectDocumentError as InternalDirtyProjectDocumentError,
  type ProjectDocument as InternalProjectDocument,
  ProjectDocumentSaveInProgressError as InternalProjectDocumentSaveInProgressError,
  StaleProjectDocumentError as InternalStaleProjectDocumentError,
  ProjectDocumentClosedError,
  type ProjectDocumentCommitter,
  openProjectDocument,
} from '../glue/project-document.ts';
import { VfsCommitTimeoutError } from '../glue/vfs-commit-coordinator.ts';
import {
  ClosedHandleError,
  DirtyProjectDocumentError,
  FileConflictError,
  type ProjectDocumentInvalidation,
  ProjectDocumentSaveInProgressError,
  type ProjectFileEntry,
  StaleProjectDocumentError,
} from './errors.ts';
import {
  type ProjectFileVersionBoundary,
  appliedVersionForPath,
  assertProjectPath,
  exactSingletonFileVersion,
  projectFileFailure,
  toOwnerProjectPath,
  toProjectFileEntry,
  toProjectPath,
} from './project-file-boundary.ts';

export interface ProjectDocumentConflict {
  readonly actualVersion: string | null;
  readonly actualEntry: ProjectFileEntry | null;
  readonly actualBytes: Uint8Array | null;
}

export interface ProjectDocumentSnapshot {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly version: string | null;
  readonly dirty: boolean;
  readonly closed: boolean;
  readonly staleReason: ProjectDocumentInvalidation | null;
  readonly conflict: ProjectDocumentConflict | null;
}

export interface ProjectDocumentCloseOptions {
  readonly dirty: 'save' | 'discard';
}

export interface ProjectDocument {
  readonly path: string;
  snapshot(): ProjectDocumentSnapshot;
  replace(data: string | Uint8Array): void;
  save(): Promise<void>;
  close(options?: ProjectDocumentCloseOptions): Promise<void>;
}

export interface ProjectDocuments {
  open(path: string): Promise<ProjectDocument>;
}

export type ProjectDocumentsMutation =
  | {
      readonly kind: 'rename';
      readonly sourcePath: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: 'remove';
      readonly path: string;
      readonly recursive?: boolean;
    }
  | { readonly kind: 'reset'; readonly rootPath: string };

/** Private owner ordering evidence used only by app-local composition. */
export interface ProjectDocumentsRevision {
  readonly ownerEpoch: string;
  readonly treeRevision: number;
}

export type ProjectDocumentReadEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }> &
  ProjectDocumentsRevision;

export interface ProjectDocumentsController {
  readonly documents: ProjectDocuments;
  invalidate(mutation: ProjectDocumentsMutation, revision: ProjectDocumentsRevision): void;
  /** Transport lifecycle fence; does not claim a new owner revision. */
  invalidateAll(reason: ProjectDocumentInvalidation): void;
  /** Pure synchronous admission check; does not fence handles. */
  preflightClose(): void;
  close(): Promise<void>;
}

export interface ProjectDocumentsControllerOptions {
  readonly projectRoot: string;
  readonly versions: ProjectFileVersionBoundary;
  readonly readVersionedFile: (path: string) => Promise<ProjectDocumentReadEntry>;
  readonly committer: ProjectDocumentCommitter;
}

interface PendingDocumentOpen {
  readonly path: string;
  invalidation: {
    readonly reason: ProjectDocumentInvalidation;
    /** `null` is an unconditional transport lifecycle fence. */
    readonly revision: ProjectDocumentsRevision | null;
  } | null;
}

interface TrackedDocument {
  readonly path: string;
  readonly publicDocument: ProjectDocument;
  readonly internalDocument: InternalProjectDocument;
  provenRevision(): ProjectDocumentsRevision;
  isSaving(): boolean;
  closeClean(): Promise<void>;
}

function cloneEntry(entry: ProjectFileEntry | null): ProjectFileEntry | null {
  return entry === null ? null : { ...entry };
}

function cloneConflict(conflict: ProjectDocumentConflict | null): ProjectDocumentConflict | null {
  if (conflict === null) return null;
  return {
    actualVersion: conflict.actualVersion,
    actualEntry: cloneEntry(conflict.actualEntry),
    actualBytes: conflict.actualBytes?.slice() ?? null,
  };
}

function conflictFromError(error: FileConflictError): ProjectDocumentConflict {
  return {
    actualVersion: error.actualVersion,
    actualEntry: cloneEntry(error.actualEntry),
    actualBytes: error.actualBytes?.slice() ?? null,
  };
}

function conflictFromInternal(
  path: string,
  conflict: ReturnType<InternalProjectDocument['snapshot']>['conflict'],
  versions: ProjectFileVersionBoundary,
): ProjectDocumentConflict | null {
  if (conflict === null) return null;
  const actualBytes = conflict.remoteBytes?.slice() ?? null;
  const actualVersion =
    conflict.remoteVersion === null ? null : versions.toPublic(conflict.remoteVersion);
  const actualEntry =
    actualVersion === null
      ? null
      : actualBytes === null
        ? {
            path,
            kind: 'dir' as const,
            size: 0,
            version: actualVersion,
          }
        : {
            path,
            kind: 'file' as const,
            size: actualBytes.byteLength,
            version: actualVersion,
          };
  return {
    actualVersion,
    actualEntry,
    actualBytes,
  };
}

function lifecycleError(error: unknown, path: string): Error | null {
  if (error instanceof ProjectDocumentClosedError) {
    return new ClosedHandleError(`Project document ${path}`);
  }
  if (error instanceof InternalDirtyProjectDocumentError) {
    return new DirtyProjectDocumentError(path);
  }
  if (error instanceof InternalProjectDocumentSaveInProgressError) {
    return new ProjectDocumentSaveInProgressError(path);
  }
  if (error instanceof InternalStaleProjectDocumentError) {
    return new StaleProjectDocumentError(path, error.reason);
  }
  return null;
}

function affectedPath(path: string, root: string, recursive: boolean): boolean {
  return (
    path === root ||
    (recursive && (root === '/' ? path.startsWith('/') : path.startsWith(`${root}/`)))
  );
}

function checkedRevision(revision: ProjectDocumentsRevision): ProjectDocumentsRevision {
  if (
    typeof revision.ownerEpoch !== 'string' ||
    revision.ownerEpoch.length === 0 ||
    !Number.isSafeInteger(revision.treeRevision) ||
    revision.treeRevision < 0
  ) {
    throw new TypeError('Invalid project document revision');
  }
  return {
    ownerEpoch: revision.ownerEpoch,
    treeRevision: revision.treeRevision,
  };
}

function readPrecedesInvalidation(
  read: ProjectDocumentsRevision,
  invalidation: ProjectDocumentsRevision,
): boolean {
  return (
    read.ownerEpoch !== invalidation.ownerEpoch || read.treeRevision < invalidation.treeRevision
  );
}

function appliedFailureRevision(error: unknown): ProjectDocumentsRevision | null {
  const ack =
    error instanceof VfsCommitAppliedError
      ? error.applied
      : error instanceof VfsCommitTimeoutError
        ? error.ack
        : null;
  return ack === null
    ? null
    : checkedRevision({ ownerEpoch: ack.ownerEpoch, treeRevision: ack.treeRevision });
}

function closeChoice(
  options: ProjectDocumentCloseOptions | undefined,
): 'save' | 'discard' | undefined {
  if (options === undefined) return undefined;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('Invalid project document close options');
  }
  const keys = Reflect.ownKeys(options);
  const descriptor = Object.getOwnPropertyDescriptor(options, 'dirty');
  if (
    keys.length !== 1 ||
    keys[0] !== 'dirty' ||
    descriptor === undefined ||
    !('value' in descriptor) ||
    (descriptor.value !== 'save' && descriptor.value !== 'discard')
  ) {
    throw new TypeError('Invalid project document close options');
  }
  return descriptor.value;
}

function closeFailures(results: readonly PromiseSettledResult<void>[]): void {
  const failures = results.flatMap((result) =>
    result.status === 'rejected'
      ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
      : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, failures.map((failure) => failure.message).join('; '));
  }
}

/**
 * Public document seam. Physical paths, owner ordering, conditional-save state,
 * and internal invalidation stay behind the controller.
 */
export function createProjectDocumentsController(
  options: ProjectDocumentsControllerOptions,
): ProjectDocumentsController {
  const tracked = new Set<TrackedDocument>();
  const admittedOpens = new Map<Promise<ProjectDocument>, PendingDocumentOpen>();
  let fenced = false;
  let closePromise: Promise<void> | null = null;

  const assertControllerOpen = (): void => {
    if (fenced) throw new ClosedHandleError('Project documents');
  };

  const preflightClose = (): void => {
    for (const document of tracked) {
      if (!document.internalDocument.snapshot().closed && document.isSaving()) {
        throw new ProjectDocumentSaveInProgressError(document.path);
      }
    }
    for (const document of tracked) {
      const state = document.internalDocument.snapshot();
      if (!state.closed && state.dirty) {
        throw new DirtyProjectDocumentError(document.path);
      }
    }
  };

  const openOne = async (
    path: string,
    ownerPath: string,
    pending: PendingDocumentOpen,
  ): Promise<ProjectDocument> => {
    let baseVersion: string | null = null;
    let publicConflict: ProjectDocumentConflict | null | undefined;
    let internalDocument: InternalProjectDocument;
    let provenRevision: ProjectDocumentsRevision | null = null;
    const proveRevision = (revision: ProjectDocumentsRevision): void => {
      const candidate = checkedRevision(revision);
      if (
        provenRevision === null ||
        provenRevision.ownerEpoch !== candidate.ownerEpoch ||
        candidate.treeRevision >= provenRevision.treeRevision
      ) {
        provenRevision = candidate;
      }
    };

    try {
      internalDocument = await openProjectDocument(
        ownerPath,
        {
          async readVersionedFile(requestedPath) {
            const entry = await options.readVersionedFile(requestedPath);
            const metadata = toProjectFileEntry(options.projectRoot, entry, options.versions);
            if (
              entry.path !== requestedPath ||
              metadata.path !== path ||
              typeof entry.ownerEpoch !== 'string' ||
              entry.ownerEpoch.length === 0 ||
              !Number.isSafeInteger(entry.treeRevision) ||
              entry.treeRevision < 0 ||
              !(entry.content instanceof Uint8Array) ||
              entry.content.byteLength !== entry.size
            ) {
              throw new TypeError('Invalid atomic document read');
            }
            proveRevision({
              ownerEpoch: entry.ownerEpoch,
              treeRevision: entry.treeRevision,
            });
            return entry;
          },
        },
        {
          async commit(operation) {
            if (operation.kind !== 'write' || operation.path !== ownerPath) {
              return options.committer.commit(operation);
            }
            const receipt = await options.committer.commit({
              ...operation,
              expectedVersion: baseVersion,
            });
            if (exactSingletonFileVersion(receipt, ownerPath) === undefined) {
              throw new VfsCommitAppliedError(
                receipt,
                new Error('Invalid project document save receipt'),
              );
            }
            proveRevision(receipt);
            return receipt;
          },
        },
      );
      baseVersion = internalDocument.snapshot().version;
    } catch (error) {
      throw projectFileFailure(options.projectRoot, options.versions, error, {
        operation: 'openDocument',
        path,
      });
    }

    if (fenced) {
      await internalDocument.close();
      throw new ClosedHandleError('Project documents');
    }
    if (
      provenRevision === null ||
      (pending.invalidation !== null &&
        (pending.invalidation.revision === null ||
          readPrecedesInvalidation(provenRevision, pending.invalidation.revision)))
    ) {
      await internalDocument.close();
      if (pending.invalidation !== null) {
        throw new StaleProjectDocumentError(path, pending.invalidation.reason);
      }
      throw projectFileFailure(
        options.projectRoot,
        options.versions,
        new TypeError('Missing atomic read revision'),
        {
          operation: 'openDocument',
          path,
        },
      );
    }

    let pendingSave: Promise<void> | null = null;
    let closeSaving = false;
    let pendingClose: Promise<void> | null = null;

    const mapSaveFailure = (error: unknown): Error => {
      const lifecycle = lifecycleError(error, path);
      if (lifecycle !== null) return lifecycle;

      const appliedVersion = appliedVersionForPath(error, ownerPath);
      if (appliedVersion !== undefined) {
        baseVersion = appliedVersion;
        publicConflict = null;
        const appliedRevision = appliedFailureRevision(error);
        if (appliedRevision !== null) proveRevision(appliedRevision);
      }
      const failure = projectFileFailure(options.projectRoot, options.versions, error, {
        operation: 'saveDocument',
        path,
      });
      if (failure instanceof FileConflictError) publicConflict = conflictFromError(failure);
      return failure;
    };

    const snapshot = (): ProjectDocumentSnapshot => {
      const state = internalDocument.snapshot();
      const logicalPath = toProjectPath(options.projectRoot, state.path);
      const conflict =
        publicConflict === undefined
          ? conflictFromInternal(logicalPath, state.conflict, options.versions)
          : publicConflict;
      return {
        path: logicalPath,
        bytes: state.bytes.slice(),
        version: baseVersion === null ? null : options.versions.toPublic(baseVersion),
        dirty: state.dirty,
        closed: state.closed,
        staleReason: state.staleReason,
        conflict: cloneConflict(conflict),
      };
    };

    const save = (): Promise<void> => {
      const before = internalDocument.snapshot();
      let internalSave: Promise<void>;
      try {
        internalSave = internalDocument.save();
      } catch (error) {
        return Promise.reject(mapSaveFailure(error));
      }

      const saving = internalSave.then(
        () => {
          baseVersion = internalDocument.snapshot().version;
          publicConflict = null;
        },
        (error: unknown) => {
          throw mapSaveFailure(error);
        },
      );
      if (
        pendingSave === null &&
        !closeSaving &&
        !before.closed &&
        before.staleReason === null &&
        before.dirty
      ) {
        pendingSave = saving;
        void saving.then(
          () => {
            if (pendingSave === saving) pendingSave = null;
          },
          () => {
            if (pendingSave === saving) pendingSave = null;
          },
        );
      }
      return saving;
    };

    const publicDocument: ProjectDocument = {
      path,
      snapshot,

      replace(data) {
        try {
          internalDocument.replace(data);
        } catch (error) {
          const mapped = lifecycleError(error, path);
          throw mapped ?? error;
        }
      },

      save,

      close(closeOptions) {
        if (pendingClose !== null) return pendingClose;
        let dirtyChoice: 'save' | 'discard' | undefined;
        try {
          dirtyChoice = closeChoice(closeOptions);
        } catch (error) {
          return Promise.reject(error);
        }
        const state = internalDocument.snapshot();
        closeSaving =
          dirtyChoice === 'save' && !state.closed && (state.dirty || pendingSave !== null);

        const internalClose =
          dirtyChoice === undefined
            ? internalDocument.close()
            : internalDocument.close({ dirty: dirtyChoice });
        const closing = internalClose.then(
          () => {
            baseVersion = internalDocument.snapshot().version;
            if (closeSaving) publicConflict = null;
            tracked.delete(record);
          },
          (error: unknown) => {
            throw mapSaveFailure(error);
          },
        );
        pendingClose = closing;
        void closing.then(
          () => {
            closeSaving = false;
            if (pendingClose === closing) pendingClose = null;
          },
          () => {
            closeSaving = false;
            if (pendingClose === closing) pendingClose = null;
          },
        );
        return closing;
      },
    };

    const record: TrackedDocument = {
      path,
      publicDocument,
      internalDocument,
      provenRevision: () => {
        if (provenRevision === null) throw new TypeError('Missing atomic read revision');
        return provenRevision;
      },
      isSaving: () => pendingSave !== null || closeSaving,
      closeClean: () => publicDocument.close(),
    };
    tracked.add(record);
    return publicDocument;
  };

  const documents: ProjectDocuments = Object.freeze({
    open(path: string) {
      let logicalPath: string;
      let ownerPath: string;
      try {
        assertControllerOpen();
        logicalPath = assertProjectPath(path);
        ownerPath = toOwnerProjectPath(options.projectRoot, logicalPath);
      } catch (error) {
        return Promise.reject(error);
      }

      const pending: PendingDocumentOpen = { path: logicalPath, invalidation: null };
      const opening = openOne(logicalPath, ownerPath, pending);
      admittedOpens.set(opening, pending);
      void opening.then(
        () => admittedOpens.delete(opening),
        () => admittedOpens.delete(opening),
      );
      return opening;
    },
  });

  return {
    documents,

    invalidate(mutation, revision) {
      const ownerRevision = checkedRevision(revision);
      let affects: (path: string) => boolean;
      let reason: ProjectDocumentInvalidation;
      switch (mutation.kind) {
        case 'rename': {
          const sourcePath = assertProjectPath(mutation.sourcePath);
          const targetPath = assertProjectPath(mutation.targetPath);
          affects = (path) =>
            affectedPath(path, sourcePath, true) || affectedPath(path, targetPath, true);
          reason = 'rename';
          break;
        }
        case 'remove': {
          const removedPath = assertProjectPath(mutation.path);
          affects = (path) => affectedPath(path, removedPath, mutation.recursive === true);
          reason = 'delete';
          break;
        }
        case 'reset': {
          const resetPath = assertProjectPath(mutation.rootPath, { allowRoot: true });
          affects = (path) => affectedPath(path, resetPath, true);
          reason = 'reset';
          break;
        }
      }

      for (const pending of admittedOpens.values()) {
        if (
          affects(pending.path) &&
          (pending.invalidation === null || pending.invalidation.revision !== null)
        ) {
          pending.invalidation = { reason, revision: ownerRevision };
        }
      }
      for (const document of tracked) {
        if (
          affects(document.path) &&
          readPrecedesInvalidation(document.provenRevision(), ownerRevision)
        ) {
          document.internalDocument.invalidate(reason, ownerRevision);
        }
      }
    },

    invalidateAll(reason) {
      for (const pending of admittedOpens.values()) {
        pending.invalidation = { reason, revision: null };
      }
      for (const document of tracked) {
        document.internalDocument.invalidate(reason, document.provenRevision());
      }
    },

    preflightClose,

    close() {
      if (closePromise !== null) return closePromise;
      try {
        preflightClose();
      } catch (error) {
        return Promise.reject(error);
      }

      fenced = true;
      const admitted = [...admittedOpens.keys()];
      const closingDocuments = [...tracked]
        .filter((document) => !document.internalDocument.snapshot().closed)
        .map((document) => document.closeClean());
      closePromise = Promise.all([
        Promise.allSettled(admitted),
        Promise.allSettled(closingDocuments),
      ]).then(([, closeResults]) => closeFailures(closeResults));
      return closePromise;
    },
  };
}
