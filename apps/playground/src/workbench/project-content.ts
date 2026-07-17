import type { SnapshotFs } from '../glue/snapshot-fs.ts';
import type { VfsCommitCoordinator } from '../glue/vfs-commit-coordinator.ts';
import type { ProjectDocumentInvalidation } from './errors.ts';
import {
  type ProjectDocumentReadEntry,
  type ProjectDocuments,
  type ProjectDocumentsMutation,
  type ProjectDocumentsOwnerByteScope,
  type ProjectDocumentsRevision,
  createProjectDocumentsController,
} from './project-documents.ts';
import {
  type OwnerProjectFileEntry,
  createProjectFileVersionBoundary,
  createProjectFileVersionSessionNonce,
} from './project-file-boundary.ts';
import { type ProjectFiles, createProjectFilesController } from './project-files.ts';

export interface ProjectContentControllerOptions {
  readonly projectRoot: string;
  readonly snapshots: Pick<SnapshotFs, 'entries' | 'subscribe'>;
  readonly committer: VfsCommitCoordinator;
  readonly readVersionedFile: (path: string) => Promise<ProjectDocumentReadEntry>;
  readonly readVersionedDirectory: (path: string) => Promise<readonly OwnerProjectFileEntry[]>;
}

export interface ProjectContentController {
  readonly files: ProjectFiles;
  readonly documents: ProjectDocuments;
  /** Owner-applied structural fact; called before the matching Files reflection. */
  invalidate(mutation: ProjectDocumentsMutation, revision: ProjectDocumentsRevision): void;
  /** Transport lifecycle fence; does not claim a new owner revision. */
  invalidateAll(reason: ProjectDocumentInvalidation): void;
  /** Private semantic admission gate for session tools. */
  awaitOwnerByteAdmission(scope: ProjectDocumentsOwnerByteScope): Promise<void>;
  /** Pure synchronous admission check; does not fence content handles. */
  preflightClose(): void;
  /** Dirty/saving documents reject before files or the committer are fenced. */
  close(): Promise<void>;
}

/** One session-local composition owns files, documents, invalidation, and commit ordering. */
export function createProjectContentController(
  options: ProjectContentControllerOptions,
): ProjectContentController {
  const versions = createProjectFileVersionBoundary(createProjectFileVersionSessionNonce());
  const documentController = createProjectDocumentsController({
    projectRoot: options.projectRoot,
    versions,
    readVersionedFile: options.readVersionedFile,
    committer: options.committer,
  });
  const fileController = createProjectFilesController({
    projectRoot: options.projectRoot,
    versions,
    snapshots: options.snapshots,
    committer: options.committer,
    readVersionedFile: options.readVersionedFile,
    readVersionedDirectory: options.readVersionedDirectory,
  });

  let closeAttempt: Promise<void> | null = null;
  const preflightClose = (): void => documentController.preflightClose();

  const close = (): Promise<void> => {
    if (closeAttempt !== null) return closeAttempt;
    try {
      preflightClose();
    } catch (error) {
      return Promise.reject(error);
    }
    let resolveAttempt!: () => void;
    let rejectAttempt!: (error: unknown) => void;
    const attempt = new Promise<void>((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    closeAttempt = attempt;
    void attempt.catch(() => {});

    let documentClose: Promise<void>;
    try {
      documentClose = documentController.close();
    } catch (error) {
      documentClose = Promise.reject(error);
    }
    const cleanupFailures: unknown[] = [];
    try {
      fileController.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      options.committer.close();
    } catch (error) {
      cleanupFailures.push(error);
    }

    void documentClose.then(
      () => settleClose(resolveAttempt, rejectAttempt, cleanupFailures),
      (error: unknown) => settleClose(resolveAttempt, rejectAttempt, [error, ...cleanupFailures]),
    );
    return attempt;
  };

  return Object.freeze({
    files: fileController.files,
    documents: documentController.documents,
    invalidate: documentController.invalidate,
    invalidateAll: documentController.invalidateAll,
    awaitOwnerByteAdmission: documentController.awaitOwnerByteAdmission,
    preflightClose,
    close,
  });
}

function settleClose(
  resolve: () => void,
  reject: (error: unknown) => void,
  failures: readonly unknown[],
): void {
  if (failures.length === 0) {
    resolve();
  } else if (failures.length === 1) {
    reject(failures[0]);
  } else {
    reject(new AggregateError(failures, 'Project content close failed'));
  }
}
