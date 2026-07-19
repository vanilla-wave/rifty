/** Owner-realm VFS revision/CAS frames. Internal until Workbench extraction. */

import type {
  OwnerEpoch,
  OwnerVfsRevisionFrame,
  PathVersion,
  TreeRevision,
} from '../workbench/project-vfs-contract.ts';

/** Loud boundary failure for a malformed or mis-correlated VFS protocol frame. */
export class VfsCommitProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfsCommitProtocolError';
  }
}

interface HostCommitBase {
  readonly operationId: string;
}

export type HostCommitRequest =
  | (HostCommitBase & {
      readonly kind: 'write';
      readonly path: string;
      readonly data: Uint8Array;
      /** `null` requires absence. */
      readonly expectedVersion: PathVersion | null;
    })
  | (HostCommitBase & {
      readonly kind: 'mkdir';
      readonly path: string;
      readonly expectedVersion: null;
    })
  | (HostCommitBase & {
      readonly kind: 'remove';
      readonly path: string;
      readonly expectedVersion: PathVersion;
      readonly recursive?: boolean;
    })
  | (HostCommitBase & {
      readonly kind: 'rename';
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly expectedSourceVersion: PathVersion;
      /** `null` requires an unused target path. */
      readonly expectedTargetVersion: PathVersion | null;
    });

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => right[index] === byte);
}

/** Exact operation identity; operation ids never collapse divergent request bytes. */
export function equalHostCommitRequests(
  left: HostCommitRequest,
  right: HostCommitRequest,
): boolean {
  if (left.kind !== right.kind || left.operationId !== right.operationId) return false;
  switch (left.kind) {
    case 'write':
      return (
        right.kind === 'write' &&
        left.path === right.path &&
        left.expectedVersion === right.expectedVersion &&
        equalBytes(left.data, right.data)
      );
    case 'mkdir':
      return (
        right.kind === 'mkdir' &&
        left.path === right.path &&
        left.expectedVersion === right.expectedVersion
      );
    case 'remove':
      return (
        right.kind === 'remove' &&
        left.path === right.path &&
        left.expectedVersion === right.expectedVersion &&
        left.recursive === right.recursive
      );
    case 'rename':
      return (
        right.kind === 'rename' &&
        left.sourcePath === right.sourcePath &&
        left.targetPath === right.targetPath &&
        left.expectedSourceVersion === right.expectedSourceVersion &&
        left.expectedTargetVersion === right.expectedTargetVersion
      );
  }
}

type WithoutOperationId<Request> = Request extends HostCommitBase
  ? Omit<Request, 'operationId'>
  : never;

/** Page-side intent before the coordinator assigns its unique operation id. */
export type HostCommitOperation = WithoutOperationId<HostCommitRequest>;

export interface PathVersionUpdate {
  readonly path: string;
  /** `null` proves the path is absent after the commit. */
  readonly version: PathVersion | null;
}

export interface HostCommitAck {
  readonly operationId: string;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
  readonly versions: readonly PathVersionUpdate[];
}

/** Exact terminal identity echoed by the bounded commit receipt handshake. */
export function equalHostCommitAcks(left: HostCommitAck, right: HostCommitAck): boolean {
  if (
    left.operationId !== right.operationId ||
    left.ownerEpoch !== right.ownerEpoch ||
    left.treeRevision !== right.treeRevision ||
    left.versions.length !== right.versions.length
  ) {
    return false;
  }
  return left.versions.every((version, index) => {
    const candidate = right.versions[index];
    return candidate?.path === version.path && candidate.version === version.version;
  });
}

function cloneHostCommitAck(ack: HostCommitAck): HostCommitAck {
  return {
    operationId: ack.operationId,
    ownerEpoch: ack.ownerEpoch,
    treeRevision: ack.treeRevision,
    versions: ack.versions.map((version) => ({ ...version })),
  };
}

/** Mutation applied, but a later owner-side observation step failed. */
export class VfsCommitAppliedError extends Error {
  readonly applied: HostCommitAck;

  constructor(applied: HostCommitAck, cause: Error) {
    super(
      `VFS commit ${applied.operationId} applied at revision ${applied.treeRevision}: ${cause.message}`,
    );
    this.name = 'VfsCommitAppliedError';
    this.applied = cloneHostCommitAck(applied);
    this.cause = cause;
  }
}

export type OwnerVfsSnapshotEntry =
  | {
      readonly path: string;
      readonly kind: 'dir';
      readonly size: 0;
      readonly version: PathVersion;
    }
  | {
      readonly path: string;
      readonly kind: 'file';
      readonly size: number;
      /** Always present and uncapped. Reflection cannot infer large-file identity. */
      readonly content: Uint8Array;
      readonly version: PathVersion;
    };

export interface OwnerVfsSnapshot extends OwnerVfsRevisionFrame {
  readonly entries: readonly OwnerVfsSnapshotEntry[];
}

export interface OwnerVfsDurabilityReceipt {
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
  readonly durability: 'durable' | 'ephemeral';
}

/** Owner completed its flush and reported unhealed persistence failures. */
export class VfsPersistenceFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistFailureError';
  }
}

export interface VfsVersionConflictDetails {
  readonly path: string;
  readonly expectedVersion: PathVersion | null;
  readonly actualVersion: PathVersion | null;
  readonly actualEntry: OwnerVfsSnapshotEntry | null;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
}

function cloneEntry(entry: OwnerVfsSnapshotEntry | null): OwnerVfsSnapshotEntry | null {
  if (entry === null) return null;
  if (entry.kind === 'dir') return { ...entry };
  return { ...entry, content: entry.content.slice() };
}

export class VfsVersionConflictError extends Error {
  readonly path: string;
  readonly expectedVersion: PathVersion | null;
  readonly actualVersion: PathVersion | null;
  readonly actualEntry: OwnerVfsSnapshotEntry | null;
  readonly actualBytes: Uint8Array | null;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;

  constructor(details: VfsVersionConflictDetails) {
    super(
      `VFS version conflict at ${details.path}: expected ${details.expectedVersion ?? '<absent>'}, actual ${details.actualVersion ?? '<absent>'}`,
    );
    this.name = 'VfsVersionConflictError';
    this.path = details.path;
    this.expectedVersion = details.expectedVersion;
    this.actualVersion = details.actualVersion;
    this.actualEntry = cloneEntry(details.actualEntry);
    this.actualBytes = this.actualEntry?.kind === 'file' ? this.actualEntry.content.slice() : null;
    this.ownerEpoch = details.ownerEpoch;
    this.treeRevision = details.treeRevision;
  }
}

export class OperationIdReuseError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super(`VFS operation id reused with a divergent request: ${operationId}`);
    this.name = 'OperationIdReuseError';
    this.operationId = operationId;
  }
}
