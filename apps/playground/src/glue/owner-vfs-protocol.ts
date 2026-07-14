/** Owner-realm VFS revision/CAS frames. Internal until Workbench extraction. */

/** Fresh nonce for one owner lifetime. Consumers compare it; they never parse it. */
export type OwnerEpoch = string;

/** Monotonic within one {@link OwnerEpoch}. */
export type TreeRevision = number;

/** Opaque token for one path state. Equality is its only supported operation. */
export type PathVersion = string;

/** Minimal owner identity carried by every reflected state frame. */
export interface OwnerVfsRevisionFrame {
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
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
