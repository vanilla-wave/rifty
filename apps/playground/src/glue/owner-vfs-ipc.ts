import type { PersistFailureReport } from '@riftydev/vfs';
import {
  type HostCommitAck,
  type HostCommitRequest,
  OperationIdReuseError,
  type OwnerEpoch,
  type OwnerVfsDurabilityReceipt,
  type OwnerVfsSnapshotEntry,
  type TreeRevision,
  VfsVersionConflictError,
} from './owner-vfs-protocol.ts';

export interface OwnerVfsCommitIpcMessage {
  readonly type: 'rifty:owner-vfs-commit';
  readonly request: HostCommitRequest;
}

interface SerializedErrorBase {
  readonly name: string;
  readonly message: string;
}

export type OwnerVfsErrorFrame =
  | (SerializedErrorBase & {
      readonly kind: 'version-conflict';
      readonly path: string;
      readonly expectedVersion: string | null;
      readonly actualVersion: string | null;
      readonly actualEntry: OwnerVfsSnapshotEntry | null;
      readonly ownerEpoch: OwnerEpoch;
      readonly treeRevision: TreeRevision;
    })
  | (SerializedErrorBase & {
      readonly kind: 'operation-id-reuse';
      readonly operationId: string;
    })
  | (SerializedErrorBase & { readonly kind: 'error' });

export type OwnerVfsCommitAckMessage =
  | {
      readonly type: 'rifty:owner-vfs-commit-ack';
      readonly operationId: string;
      readonly ok: true;
      readonly ack: HostCommitAck;
    }
  | {
      readonly type: 'rifty:owner-vfs-commit-ack';
      readonly operationId: string;
      readonly ok: false;
      readonly error: OwnerVfsErrorFrame;
    };

export interface OwnerVfsDurabilityIpcMessage {
  readonly type: 'rifty:owner-vfs-durability';
  readonly barrierId: string;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
}

export type OwnerVfsDurabilityAckMessage =
  | {
      readonly type: 'rifty:owner-vfs-durability-ack';
      readonly barrierId: string;
      readonly ok: true;
      readonly receipt: OwnerVfsDurabilityReceipt;
    }
  | {
      readonly type: 'rifty:owner-vfs-durability-ack';
      readonly barrierId: string;
      readonly ok: false;
      readonly error: OwnerVfsErrorFrame;
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

export function isOwnerVfsCommitIpcMessage(message: unknown): message is OwnerVfsCommitIpcMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-commit' &&
    isRecord(message.request) &&
    typeof message.request.operationId === 'string'
  );
}

export function isOwnerVfsCommitAckMessage(message: unknown): message is OwnerVfsCommitAckMessage {
  if (
    !isRecord(message) ||
    message.type !== 'rifty:owner-vfs-commit-ack' ||
    typeof message.operationId !== 'string' ||
    typeof message.ok !== 'boolean'
  ) {
    return false;
  }
  return message.ok ? isRecord(message.ack) : isRecord(message.error);
}

export function isOwnerVfsDurabilityIpcMessage(
  message: unknown,
): message is OwnerVfsDurabilityIpcMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-durability' &&
    typeof message.barrierId === 'string' &&
    typeof message.ownerEpoch === 'string' &&
    typeof message.treeRevision === 'number'
  );
}

export function isOwnerVfsDurabilityAckMessage(
  message: unknown,
): message is OwnerVfsDurabilityAckMessage {
  if (
    !isRecord(message) ||
    message.type !== 'rifty:owner-vfs-durability-ack' ||
    typeof message.barrierId !== 'string' ||
    typeof message.ok !== 'boolean'
  ) {
    return false;
  }
  return message.ok ? isRecord(message.receipt) : isRecord(message.error);
}

function cloneEntry(entry: OwnerVfsSnapshotEntry | null): OwnerVfsSnapshotEntry | null {
  if (entry === null || entry.kind === 'dir') return entry === null ? null : { ...entry };
  return { ...entry, content: entry.content.slice() };
}

export function encodeOwnerVfsError(cause: unknown): OwnerVfsErrorFrame {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (error instanceof VfsVersionConflictError) {
    return {
      kind: 'version-conflict',
      name: error.name,
      message: error.message,
      path: error.path,
      expectedVersion: error.expectedVersion,
      actualVersion: error.actualVersion,
      actualEntry: cloneEntry(error.actualEntry),
      ownerEpoch: error.ownerEpoch,
      treeRevision: error.treeRevision,
    };
  }
  if (error instanceof OperationIdReuseError) {
    return {
      kind: 'operation-id-reuse',
      name: error.name,
      message: error.message,
      operationId: error.operationId,
    };
  }
  return { kind: 'error', name: error.name, message: error.message };
}

export function decodeOwnerVfsError(frame: OwnerVfsErrorFrame): Error {
  if (frame.kind === 'version-conflict') {
    return new VfsVersionConflictError({
      path: frame.path,
      expectedVersion: frame.expectedVersion,
      actualVersion: frame.actualVersion,
      actualEntry: cloneEntry(frame.actualEntry),
      ownerEpoch: frame.ownerEpoch,
      treeRevision: frame.treeRevision,
    });
  }
  if (frame.kind === 'operation-id-reuse') return new OperationIdReuseError(frame.operationId);
  const error = new Error(frame.message);
  error.name = frame.name;
  return error;
}

export interface OwnerVfsCommitHandlerOptions {
  readonly message: OwnerVfsCommitIpcMessage;
  readonly apply: (request: HostCommitRequest) => HostCommitAck | Promise<HostCommitAck>;
  readonly publishSnapshot: () => void;
  readonly send: (message: OwnerVfsCommitAckMessage) => void;
}

/** Owner apply → publish → ACK ordering; retries reuse the authority's operation id. */
export function handleOwnerVfsCommitRequest(options: OwnerVfsCommitHandlerOptions): void {
  const operationId = options.message.request.operationId;
  const succeed = (ack: HostCommitAck): void => {
    options.publishSnapshot();
    options.send({ type: 'rifty:owner-vfs-commit-ack', operationId, ok: true, ack });
  };
  const fail = (error: unknown): void => {
    options.send({
      type: 'rifty:owner-vfs-commit-ack',
      operationId,
      ok: false,
      error: encodeOwnerVfsError(error),
    });
  };
  try {
    const applied = options.apply(options.message.request);
    const then =
      typeof applied === 'object' && applied !== null
        ? (applied as { readonly then?: unknown }).then
        : undefined;
    if (typeof then === 'function') {
      void Promise.resolve(applied).then(succeed, fail);
      return;
    }
    succeed(applied as HostCommitAck);
  } catch (error) {
    fail(error);
  }
}

export interface OwnerVfsDurabilityHandlerOptions {
  readonly message: OwnerVfsDurabilityIpcMessage;
  readonly current: () => { readonly ownerEpoch: OwnerEpoch; readonly treeRevision: TreeRevision };
  readonly durability: OwnerVfsDurabilityReceipt['durability'];
  readonly flush: () => Promise<PersistFailureReport | undefined>;
  readonly send: (message: OwnerVfsDurabilityAckMessage) => void;
}

function dirtyLedgerError(report: PersistFailureReport): Error {
  const sample = report.failures
    .slice(0, 3)
    .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
    .join('; ');
  const error = new Error(
    `OPFS write-through drained with ${report.total} unhealed persist failure(s): ${sample}`,
  );
  error.name = 'PersistFailureError';
  return error;
}

/** Bound owner/revision persistence barrier; never emits a false durable receipt. */
export async function handleOwnerVfsDurabilityRequest(
  options: OwnerVfsDurabilityHandlerOptions,
): Promise<void> {
  const { message } = options;
  try {
    const state = options.current();
    if (message.ownerEpoch !== state.ownerEpoch) {
      throw new Error(
        `VFS durability owner changed: expected ${message.ownerEpoch}, actual ${state.ownerEpoch}`,
      );
    }
    if (
      !Number.isSafeInteger(message.treeRevision) ||
      message.treeRevision < 0 ||
      message.treeRevision > state.treeRevision
    ) {
      throw new Error(
        `VFS durability revision ${String(message.treeRevision)} is not applied by owner revision ${String(state.treeRevision)}`,
      );
    }
    const report = await options.flush();
    if (report !== undefined && report.total > 0) throw dirtyLedgerError(report);
    options.send({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: message.barrierId,
      ok: true,
      receipt: {
        ownerEpoch: state.ownerEpoch,
        treeRevision: state.treeRevision,
        durability: options.durability,
      },
    });
  } catch (error) {
    options.send({
      type: 'rifty:owner-vfs-durability-ack',
      barrierId: message.barrierId,
      ok: false,
      error: encodeOwnerVfsError(error),
    });
  }
}
