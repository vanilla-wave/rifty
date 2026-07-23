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

/** One node of the project tree. Dirs carry no content; files may carry bytes. */
export interface VfsSnapshotEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  /** Opaque owner-issued identity; content/size are never used as identity. */
  readonly version: PathVersion;
  /** Present for files small enough to inline. */
  readonly content?: Uint8Array;
  /** Only valid reason for an owner-certified file to omit its bytes. */
  readonly contentOmitted?: 'size-cap';
}

/** A full-tree replace frame. The receiver swaps its store wholesale per frame. */
export interface VfsSnapshotFrame extends OwnerVfsRevisionFrame {
  readonly type: 'snapshot';
  readonly root: string;
  readonly entries: readonly VfsSnapshotEntry[];
  /** True when an excluded `node_modules` exists under root. */
  readonly nodeModulesPresent: boolean;
}
