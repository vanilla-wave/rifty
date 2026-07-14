import {
  type HostCommitOperation,
  type OwnerVfsRevisionFrame,
  type OwnerVfsSnapshotEntry,
  type PathVersion,
  VfsVersionConflictError,
} from './owner-vfs-protocol.ts';
import type { VfsCommitReceipt } from './vfs-commit-coordinator.ts';

type FileSnapshotEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }>;

export type ProjectDocumentInvalidation = 'rename' | 'delete' | 'reset';

export class ProjectDocumentClosedError extends Error {
  constructor(path: string) {
    super(`Project document ${path} is closed`);
    this.name = 'ProjectDocumentClosedError';
  }
}

export class DirtyProjectDocumentError extends Error {
  constructor(path: string) {
    super(`Project document ${path} has unsaved changes; choose save or discard`);
    this.name = 'DirtyProjectDocumentError';
  }
}

export class StaleProjectDocumentError extends Error {
  readonly path: string;
  readonly reason: ProjectDocumentInvalidation;

  constructor(path: string, reason: ProjectDocumentInvalidation) {
    super(`Project document ${path} became stale after ${reason}`);
    this.name = 'StaleProjectDocumentError';
    this.path = path;
    this.reason = reason;
  }
}

export class ProjectDocumentSaveInProgressError extends Error {
  constructor(path: string) {
    super(`Project document ${path} already has a save in progress`);
    this.name = 'ProjectDocumentSaveInProgressError';
  }
}

export class ProjectDocumentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectDocumentProtocolError';
  }
}

/** One owner read that returns bytes and opaque version from the same revision. */
export interface ProjectDocumentReadSource {
  readVersionedFile(path: string): Promise<FileSnapshotEntry>;
}

/** Narrow seam implemented by {@link import('./vfs-commit-coordinator.ts').VfsCommitCoordinator}. */
export interface ProjectDocumentCommitter {
  commit(operation: HostCommitOperation): Promise<VfsCommitReceipt>;
}

export interface ProjectDocumentConflict {
  readonly remoteVersion: PathVersion | null;
  readonly remoteBytes: Uint8Array | null;
  readonly ownerEpoch: string;
  readonly treeRevision: number;
}

export interface ProjectDocumentSnapshot {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly version: PathVersion | null;
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
  /** Owner rename/delete/reset invalidates both queued and future saves. */
  invalidate(reason: ProjectDocumentInvalidation, owner: OwnerVfsRevisionFrame): void;
  close(options?: ProjectDocumentCloseOptions): Promise<void>;
}

const textEncoder = new TextEncoder();

function copyConflict(conflict: ProjectDocumentConflict | null): ProjectDocumentConflict | null {
  if (conflict === null) return null;
  return {
    ...conflict,
    remoteBytes: conflict.remoteBytes?.slice() ?? null,
  };
}

function committedPathVersion(receipt: VfsCommitReceipt, path: string): PathVersion {
  const update = receipt.versions.find((candidate) => candidate.path === path);
  if (update === undefined || update.version === null) {
    throw new ProjectDocumentProtocolError(
      `VFS commit ${receipt.operationId} did not return a file version for ${path}`,
    );
  }
  return update.version;
}

/**
 * Open one editable document from an atomic owner entry. The implementation
 * owns CAS versions, edit-during-save bookkeeping, conflict evidence, and
 * explicit dirty close behind the small document interface.
 */
export async function openProjectDocument(
  path: string,
  source: ProjectDocumentReadSource,
  committer: ProjectDocumentCommitter,
): Promise<ProjectDocument> {
  const opened = await source.readVersionedFile(path);
  if (opened.kind !== 'file' || opened.path !== path) {
    throw new ProjectDocumentProtocolError(
      `Versioned document read for ${path} returned ${opened.kind} ${opened.path}`,
    );
  }

  let bytes = opened.content.slice();
  let version: PathVersion | null = opened.version;
  let dirty = false;
  let closed = false;
  let staleReason: ProjectDocumentInvalidation | null = null;
  let invalidation: (OwnerVfsRevisionFrame & { reason: ProjectDocumentInvalidation }) | null = null;
  let conflict: ProjectDocumentConflict | null = null;
  let editRevision = 0;
  let saving: Promise<void> | null = null;

  const assertOpen = (): void => {
    if (closed) throw new ProjectDocumentClosedError(path);
  };

  const staleError = (): StaleProjectDocumentError | null =>
    staleReason === null ? null : new StaleProjectDocumentError(path, staleReason);

  const document: ProjectDocument = {
    path,

    snapshot() {
      return {
        path,
        bytes: bytes.slice(),
        version,
        dirty,
        closed,
        staleReason,
        conflict: copyConflict(conflict),
      };
    },

    replace(data) {
      assertOpen();
      const stale = staleError();
      if (stale !== null) throw stale;
      bytes = typeof data === 'string' ? textEncoder.encode(data) : data.slice();
      editRevision += 1;
      dirty = true;
    },

    save() {
      try {
        assertOpen();
      } catch (error) {
        return Promise.reject(error);
      }
      const stale = staleError();
      if (stale !== null) return Promise.reject(stale);
      if (saving !== null) return Promise.reject(new ProjectDocumentSaveInProgressError(path));
      if (!dirty) return Promise.resolve();

      const savedBytes = bytes.slice();
      const savedEditRevision = editRevision;
      const expectedVersion = version;

      const pendingSave = committer
        .commit({ kind: 'write', path, data: savedBytes, expectedVersion })
        .then((receipt) => {
          const invalidated = invalidation;
          if (
            invalidated !== null &&
            (receipt.ownerEpoch !== invalidated.ownerEpoch ||
              receipt.treeRevision >= invalidated.treeRevision)
          ) {
            throw new StaleProjectDocumentError(path, invalidated.reason);
          }
          if (closed) throw new ProjectDocumentClosedError(path);

          version = committedPathVersion(receipt, path);
          conflict = null;
          // A replace after save began remains a distinct unsaved local edit.
          dirty = editRevision !== savedEditRevision;
        })
        .catch((error: unknown) => {
          if (error instanceof VfsVersionConflictError && error.path === path) {
            conflict = {
              remoteVersion: error.actualVersion,
              remoteBytes: error.actualBytes?.slice() ?? null,
              ownerEpoch: error.ownerEpoch,
              treeRevision: error.treeRevision,
            };
            // Keep the opened/last-saved CAS base. Remote identity remains
            // separate evidence; no hidden rebase, retry, or last-writer-wins.
            dirty = true;
            if (invalidation !== null) {
              throw new StaleProjectDocumentError(path, invalidation.reason);
            }
          }
          if (error instanceof StaleProjectDocumentError) throw error;
          if (closed) throw new ProjectDocumentClosedError(path);
          throw error;
        })
        .finally(() => {
          if (saving === pendingSave) saving = null;
        });

      saving = pendingSave;
      return pendingSave;
    },

    invalidate(reason, owner) {
      if (
        !owner.ownerEpoch ||
        !Number.isSafeInteger(owner.treeRevision) ||
        owner.treeRevision < 0
      ) {
        throw new ProjectDocumentProtocolError(
          'Document invalidation requires a valid owner frame',
        );
      }
      if (closed || invalidation !== null) return;
      invalidation = { ...owner, reason };
      staleReason = reason;
    },

    async close(options) {
      if (closed) return;
      if (saving !== null) {
        if (options?.dirty !== 'save') {
          throw new ProjectDocumentSaveInProgressError(path);
        }
        await saving;
      }
      if (dirty) {
        if (options === undefined) throw new DirtyProjectDocumentError(path);
        if (options.dirty === 'save') {
          await document.save();
          if (dirty) throw new DirtyProjectDocumentError(path);
        }
      }
      closed = true;
    },
  };

  return document;
}
