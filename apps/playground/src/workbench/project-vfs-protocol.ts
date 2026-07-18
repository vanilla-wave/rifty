import type {
  OwnerVfsCommitCleanedMessage,
  OwnerVfsCommitCleanupMessage,
  OwnerVfsCommitIpcMessage,
  OwnerVfsCommitReceivedMessage,
  OwnerVfsCommitReleasedMessage,
  OwnerVfsCommitTerminal,
  OwnerVfsDurabilityAckMessage,
  OwnerVfsDurabilityIpcMessage,
  OwnerVfsErrorFrame,
} from '../glue/owner-vfs-ipc.ts';
import {
  isOwnerVfsCommitCleanedMessage,
  isOwnerVfsCommitCleanupMessage,
  isOwnerVfsCommitIpcMessage,
  isOwnerVfsCommitReceivedMessage,
  isOwnerVfsCommitReleasedMessage,
  isOwnerVfsDurabilityAckMessage,
  isOwnerVfsDurabilityIpcMessage,
  validateOwnerVfsCommitTerminal,
} from '../glue/owner-vfs-ipc.ts';
import type {
  HostCommitAck,
  OwnerVfsRevisionFrame,
  OwnerVfsSnapshotEntry,
  PathVersion,
  TreeRevision,
} from '../glue/owner-vfs-protocol.ts';
import type { VfsSnapshotFrame } from '../glue/vfs-snapshot-port.ts';

export interface ProjectVfsSnapshotRequest {
  readonly type: 'workbench:project-vfs-snapshot-request';
}

export interface ProjectVfsReadFileRequest {
  readonly type: 'workbench:project-vfs-read-file';
  readonly requestId: string;
  readonly path: string;
}

export interface ProjectVfsReadDirectoryRequest {
  readonly type: 'workbench:project-vfs-read-directory';
  readonly requestId: string;
  readonly path: string;
}

export interface ProjectVfsSnapshotMessage {
  readonly type: 'workbench:project-vfs-snapshot';
  readonly frame: VfsSnapshotFrame;
}

export type ProjectVfsAppliedMutation =
  | {
      readonly kind: 'rename';
      readonly treeRevision: TreeRevision;
      readonly sourcePath: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: 'remove';
      readonly treeRevision: TreeRevision;
      readonly path: string;
      readonly recursive: boolean;
    }
  | {
      readonly kind: 'reset';
      readonly treeRevision: TreeRevision;
      readonly rootPath: string;
    };

export interface ProjectVfsStateMessage {
  readonly type: 'workbench:project-vfs-state';
  readonly fromTreeRevision: TreeRevision;
  readonly mutations: readonly ProjectVfsAppliedMutation[];
  readonly frame: VfsSnapshotFrame;
}

export interface ProjectVfsFatalMessage {
  readonly type: 'workbench:project-vfs-fatal';
  readonly error: ProjectVfsReadFailure;
}

type FileEntry = Extract<OwnerVfsSnapshotEntry, { readonly kind: 'file' }>;

export interface ProjectVfsDirectoryEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly version: PathVersion;
}

interface ProjectVfsReadFailure {
  readonly name: string;
  readonly message: string;
}

export type ProjectVfsReadFileResult =
  | ({
      readonly type: 'workbench:project-vfs-read-file-result';
      readonly requestId: string;
      readonly ok: true;
      readonly entry: FileEntry;
    } & OwnerVfsRevisionFrame)
  | {
      readonly type: 'workbench:project-vfs-read-file-result';
      readonly requestId: string;
      readonly ok: false;
      readonly error: ProjectVfsReadFailure;
    };

export type ProjectVfsReadDirectoryResult =
  | ({
      readonly type: 'workbench:project-vfs-read-directory-result';
      readonly requestId: string;
      readonly ok: true;
      readonly entries: readonly ProjectVfsDirectoryEntry[];
    } & OwnerVfsRevisionFrame)
  | {
      readonly type: 'workbench:project-vfs-read-directory-result';
      readonly requestId: string;
      readonly ok: false;
      readonly error: ProjectVfsReadFailure;
    };

export type PageProjectVfsFrame =
  | OwnerVfsCommitIpcMessage
  | OwnerVfsCommitReceivedMessage
  | OwnerVfsCommitCleanupMessage
  | OwnerVfsDurabilityIpcMessage
  | ProjectVfsSnapshotRequest
  | ProjectVfsReadFileRequest
  | ProjectVfsReadDirectoryRequest;

export type OwnerProjectVfsFrame =
  | OwnerVfsCommitTerminal
  | OwnerVfsCommitReleasedMessage
  | OwnerVfsCommitCleanedMessage
  | OwnerVfsDurabilityAckMessage
  | ProjectVfsSnapshotMessage
  | ProjectVfsStateMessage
  | ProjectVfsFatalMessage
  | ProjectVfsReadFileResult
  | ProjectVfsReadDirectoryResult;

/** One exact-key decoder for every page→owner Project VFS sibling. */
export function inspectPageProjectVfsFrame(value: unknown): PageProjectVfsFrame {
  const frame = record(value, 'page project VFS frame');
  switch (frame.type) {
    case 'rifty:owner-vfs-commit':
      inspectCommitRequestFrame(frame);
      if (!isOwnerVfsCommitIpcMessage(frame)) throw invalid('page project VFS commit');
      return frame;
    case 'rifty:owner-vfs-commit-received':
      exact(frame, ['type', 'terminal'], 'page project VFS commit receipt');
      inspectCommitTerminal(frame.terminal);
      if (!isOwnerVfsCommitReceivedMessage(frame)) throw invalid('page project VFS commit receipt');
      return frame;
    case 'rifty:owner-vfs-commit-cleanup':
      exact(frame, ['type', 'terminal'], 'page project VFS commit cleanup');
      inspectCommitTerminal(frame.terminal);
      if (!isOwnerVfsCommitCleanupMessage(frame)) throw invalid('page project VFS commit cleanup');
      return frame;
    case 'rifty:owner-vfs-durability':
      exact(
        frame,
        ['type', 'barrierId', 'ownerEpoch', 'treeRevision'],
        'page project VFS durability request',
      );
      nonEmptyString(frame.barrierId, 'page project VFS barrier id');
      inspectRevision(frame);
      if (!isOwnerVfsDurabilityIpcMessage(frame)) {
        throw invalid('page project VFS durability request');
      }
      return frame;
    case 'workbench:project-vfs-snapshot-request':
      exact(frame, ['type'], 'page project VFS snapshot request');
      return frame as unknown as ProjectVfsSnapshotRequest;
    case 'workbench:project-vfs-read-file':
      exact(frame, ['type', 'requestId', 'path'], 'page project VFS read-file request');
      inspectReadRequest(frame);
      return frame as unknown as ProjectVfsReadFileRequest;
    case 'workbench:project-vfs-read-directory':
      exact(frame, ['type', 'requestId', 'path'], 'page project VFS read-directory request');
      inspectReadRequest(frame);
      return frame as unknown as ProjectVfsReadDirectoryRequest;
    default:
      throw invalid('page project VFS frame');
  }
}

/** One exact-key decoder for every owner→page Project VFS sibling. */
export function inspectOwnerProjectVfsFrame(value: unknown): OwnerProjectVfsFrame {
  const frame = record(value, 'owner project VFS frame');
  switch (frame.type) {
    case 'rifty:owner-vfs-commit-ack':
      return inspectCommitTerminal(frame);
    case 'rifty:owner-vfs-commit-released':
      exact(frame, ['type', 'terminal'], 'owner project VFS commit release');
      inspectCommitTerminal(frame.terminal);
      if (!isOwnerVfsCommitReleasedMessage(frame)) {
        throw invalid('owner project VFS commit release');
      }
      return frame;
    case 'rifty:owner-vfs-commit-cleaned':
      exact(frame, ['type', 'terminal'], 'owner project VFS commit cleaned');
      inspectCommitTerminal(frame.terminal);
      if (!isOwnerVfsCommitCleanedMessage(frame)) {
        throw invalid('owner project VFS commit cleaned');
      }
      return frame;
    case 'rifty:owner-vfs-durability-ack':
      inspectDurabilityAck(frame);
      if (!isOwnerVfsDurabilityAckMessage(frame)) {
        throw invalid('owner project VFS durability result');
      }
      return frame;
    case 'workbench:project-vfs-snapshot':
      exact(frame, ['type', 'frame'], 'owner project VFS snapshot');
      inspectSnapshot(frame.frame);
      return frame as unknown as ProjectVfsSnapshotMessage;
    case 'workbench:project-vfs-state':
      return inspectState(frame);
    case 'workbench:project-vfs-fatal':
      return inspectFatal(frame);
    case 'workbench:project-vfs-read-file-result':
      return inspectReadFileResult(frame);
    case 'workbench:project-vfs-read-directory-result':
      return inspectReadDirectoryResult(frame);
    default:
      throw invalid('owner project VFS frame');
  }
}

function inspectCommitRequestFrame(frame: Record<string, unknown>): void {
  exact(frame, ['type', 'request'], 'page project VFS commit');
  const request = record(frame.request, 'page project VFS commit request');
  switch (request.kind) {
    case 'write':
      exact(
        request,
        ['kind', 'operationId', 'path', 'data', 'expectedVersion'],
        'page project VFS write',
      );
      bytes(request.data, 'page project VFS write bytes');
      nullableVersion(request.expectedVersion, 'page project VFS write expected version');
      inspectPathRequest(request);
      break;
    case 'mkdir':
      exact(request, ['kind', 'operationId', 'path', 'expectedVersion'], 'page project VFS mkdir');
      if (request.expectedVersion !== null) throw invalid('page project VFS mkdir version');
      inspectPathRequest(request);
      break;
    case 'remove':
      exact(
        request,
        own(request, 'recursive')
          ? ['kind', 'operationId', 'path', 'expectedVersion', 'recursive']
          : ['kind', 'operationId', 'path', 'expectedVersion'],
        'page project VFS remove',
      );
      version(request.expectedVersion, 'page project VFS remove expected version');
      if (own(request, 'recursive') && typeof request.recursive !== 'boolean') {
        throw invalid('page project VFS remove recursive');
      }
      inspectPathRequest(request);
      break;
    case 'rename':
      exact(
        request,
        [
          'kind',
          'operationId',
          'sourcePath',
          'targetPath',
          'expectedSourceVersion',
          'expectedTargetVersion',
        ],
        'page project VFS rename',
      );
      nonEmptyString(request.operationId, 'page project VFS operation id');
      absolutePath(request.sourcePath, 'page project VFS rename source');
      absolutePath(request.targetPath, 'page project VFS rename target');
      version(request.expectedSourceVersion, 'page project VFS rename source version');
      nullableVersion(request.expectedTargetVersion, 'page project VFS rename target version');
      break;
    default:
      throw invalid('page project VFS commit request');
  }
}

function inspectPathRequest(request: Record<string, unknown>): void {
  nonEmptyString(request.operationId, 'page project VFS operation id');
  absolutePath(request.path, 'page project VFS path');
}

function inspectCommitTerminal(value: unknown): OwnerVfsCommitTerminal {
  const terminal = record(value, 'owner project VFS commit terminal');
  if (terminal.type !== 'rifty:owner-vfs-commit-ack') {
    throw invalid('owner project VFS commit terminal');
  }
  nonEmptyString(terminal.operationId, 'owner project VFS terminal operation id');
  if (terminal.ok === true) {
    exact(terminal, ['type', 'operationId', 'ok', 'ack'], 'owner project VFS commit success');
    inspectHostCommitAck(terminal.ack);
  } else if (terminal.ok === false) {
    exact(
      terminal,
      own(terminal, 'applied')
        ? ['type', 'operationId', 'ok', 'error', 'applied']
        : ['type', 'operationId', 'ok', 'error'],
      'owner project VFS commit failure',
    );
    inspectOwnerVfsError(terminal.error);
    if (own(terminal, 'applied')) inspectHostCommitAck(terminal.applied);
  } else {
    throw invalid('owner project VFS commit result');
  }
  const inspected = validateOwnerVfsCommitTerminal(terminal);
  if (inspected.kind !== 'valid') throw invalid('owner project VFS commit terminal');
  return inspected.message;
}

function inspectHostCommitAck(value: unknown): HostCommitAck {
  const ack = record(value, 'owner project VFS ACK');
  exact(ack, ['operationId', 'ownerEpoch', 'treeRevision', 'versions'], 'owner project VFS ACK');
  nonEmptyString(ack.operationId, 'owner project VFS ACK operation id');
  inspectRevision(ack);
  if (!Array.isArray(ack.versions)) throw invalid('owner project VFS ACK versions');
  for (const value of ack.versions) {
    const update = record(value, 'owner project VFS ACK version');
    exact(update, ['path', 'version'], 'owner project VFS ACK version');
    absolutePath(update.path, 'owner project VFS ACK path');
    nullableVersion(update.version, 'owner project VFS ACK version');
  }
  return ack as unknown as HostCommitAck;
}

function inspectOwnerVfsError(value: unknown): OwnerVfsErrorFrame {
  const error = record(value, 'owner project VFS error');
  nonEmptyString(error.name, 'owner project VFS error name');
  string(error.message, 'owner project VFS error message');
  switch (error.kind) {
    case 'error':
      exact(error, ['kind', 'name', 'message'], 'owner project VFS error');
      break;
    case 'operation-id-reuse':
      exact(error, ['kind', 'name', 'message', 'operationId'], 'owner project VFS operation reuse');
      nonEmptyString(error.operationId, 'owner project VFS reused operation id');
      break;
    case 'persistence-failure':
      exact(error, ['kind', 'name', 'message'], 'owner project VFS persistence failure');
      if (error.name !== 'PersistFailureError') {
        throw invalid('owner project VFS persistence failure name');
      }
      break;
    case 'version-conflict':
      exact(
        error,
        [
          'kind',
          'name',
          'message',
          'path',
          'expectedVersion',
          'actualVersion',
          'actualEntry',
          'ownerEpoch',
          'treeRevision',
        ],
        'owner project VFS version conflict',
      );
      absolutePath(error.path, 'owner project VFS conflict path');
      nullableVersion(error.expectedVersion, 'owner project VFS expected version');
      nullableVersion(error.actualVersion, 'owner project VFS actual version');
      if (error.actualEntry !== null) inspectOwnerSnapshotEntry(error.actualEntry);
      inspectRevision(error);
      break;
    default:
      throw invalid('owner project VFS error');
  }
  return error as unknown as OwnerVfsErrorFrame;
}

function inspectDurabilityAck(frame: Record<string, unknown>): void {
  nonEmptyString(frame.barrierId, 'owner project VFS barrier id');
  if (frame.ok === true) {
    exact(frame, ['type', 'barrierId', 'ok', 'receipt'], 'owner project VFS durability success');
    const receipt = record(frame.receipt, 'owner project VFS durability receipt');
    exact(
      receipt,
      ['ownerEpoch', 'treeRevision', 'durability'],
      'owner project VFS durability receipt',
    );
    inspectRevision(receipt);
    if (receipt.durability !== 'durable' && receipt.durability !== 'ephemeral') {
      throw invalid('owner project VFS durability');
    }
    return;
  }
  if (frame.ok === false) {
    exact(frame, ['type', 'barrierId', 'ok', 'error'], 'owner project VFS durability failure');
    inspectOwnerVfsError(frame.error);
    return;
  }
  throw invalid('owner project VFS durability result');
}

function inspectSnapshot(value: unknown): VfsSnapshotFrame {
  const snapshot = record(value, 'owner project VFS snapshot frame');
  exact(
    snapshot,
    ['type', 'root', 'ownerEpoch', 'treeRevision', 'entries', 'nodeModulesPresent'],
    'owner project VFS snapshot frame',
  );
  if (snapshot.type !== 'snapshot') throw invalid('owner project VFS snapshot type');
  absolutePath(snapshot.root, 'owner project VFS snapshot root');
  inspectRevision(snapshot);
  if (!Array.isArray(snapshot.entries)) throw invalid('owner project VFS snapshot entries');
  for (const entry of snapshot.entries) inspectSnapshotEntry(entry);
  if (typeof snapshot.nodeModulesPresent !== 'boolean') {
    throw invalid('owner project VFS node_modules marker');
  }
  return snapshot as unknown as VfsSnapshotFrame;
}

function inspectState(frame: Record<string, unknown>): ProjectVfsStateMessage {
  exact(frame, ['type', 'fromTreeRevision', 'mutations', 'frame'], 'owner project VFS state');
  const fromTreeRevision = nonNegativeInteger(
    frame.fromTreeRevision,
    'owner project VFS state prior revision',
  );
  const snapshot = inspectSnapshot(frame.frame);
  if (snapshot.treeRevision < fromTreeRevision) throw invalid('owner project VFS state revision');
  if (!Array.isArray(frame.mutations)) throw invalid('owner project VFS state mutations');

  let priorRevision = fromTreeRevision;
  for (const value of frame.mutations) {
    const mutation = record(value, 'owner project VFS applied mutation');
    const treeRevision = nonNegativeInteger(
      mutation.treeRevision,
      'owner project VFS applied mutation revision',
    );
    if (
      treeRevision <= fromTreeRevision ||
      treeRevision < priorRevision ||
      treeRevision > snapshot.treeRevision
    ) {
      throw invalid('owner project VFS applied mutation revision');
    }
    priorRevision = treeRevision;
    switch (mutation.kind) {
      case 'rename':
        exact(
          mutation,
          ['kind', 'treeRevision', 'sourcePath', 'targetPath'],
          'owner project VFS rename mutation',
        );
        absolutePath(mutation.sourcePath, 'owner project VFS rename mutation source');
        absolutePath(mutation.targetPath, 'owner project VFS rename mutation target');
        break;
      case 'remove':
        exact(
          mutation,
          ['kind', 'treeRevision', 'path', 'recursive'],
          'owner project VFS remove mutation',
        );
        absolutePath(mutation.path, 'owner project VFS remove mutation path');
        if (typeof mutation.recursive !== 'boolean') {
          throw invalid('owner project VFS remove mutation recursive');
        }
        break;
      case 'reset':
        exact(mutation, ['kind', 'treeRevision', 'rootPath'], 'owner project VFS reset mutation');
        absolutePath(mutation.rootPath, 'owner project VFS reset mutation root');
        break;
      default:
        throw invalid('owner project VFS applied mutation');
    }
  }
  return frame as unknown as ProjectVfsStateMessage;
}

function inspectFatal(frame: Record<string, unknown>): ProjectVfsFatalMessage {
  exact(frame, ['type', 'error'], 'owner project VFS fatal');
  inspectFailure(frame.error, 'owner project VFS fatal error');
  return frame as unknown as ProjectVfsFatalMessage;
}

function inspectSnapshotEntry(value: unknown): void {
  const entry = record(value, 'owner project VFS snapshot entry');
  if (entry.kind === 'dir') {
    exact(entry, ['path', 'kind', 'size', 'version'], 'owner project VFS snapshot directory');
    if (entry.size !== 0) throw invalid('owner project VFS snapshot directory size');
  } else if (entry.kind === 'file') {
    const hasContent = own(entry, 'content');
    const hasOmission = own(entry, 'contentOmitted');
    if (hasContent === hasOmission) throw invalid('owner project VFS snapshot file content');
    exact(
      entry,
      hasContent
        ? ['path', 'kind', 'size', 'version', 'content']
        : ['path', 'kind', 'size', 'version', 'contentOmitted'],
      'owner project VFS snapshot file',
    );
    if (hasContent) {
      const content = bytes(entry.content, 'owner project VFS snapshot content');
      if (content.byteLength !== entry.size) throw invalid('owner project VFS snapshot file size');
    } else if (entry.contentOmitted !== 'size-cap') {
      throw invalid('owner project VFS snapshot omission');
    }
  } else {
    throw invalid('owner project VFS snapshot entry kind');
  }
  inspectCommonEntry(entry);
}

function inspectOwnerSnapshotEntry(value: unknown): OwnerVfsSnapshotEntry {
  const entry = record(value, 'owner project VFS owner entry');
  if (entry.kind === 'dir') {
    exact(entry, ['path', 'kind', 'size', 'version'], 'owner project VFS owner directory');
    if (entry.size !== 0) throw invalid('owner project VFS owner directory size');
  } else if (entry.kind === 'file') {
    exact(entry, ['path', 'kind', 'size', 'content', 'version'], 'owner project VFS owner file');
    const content = bytes(entry.content, 'owner project VFS owner file content');
    if (content.byteLength !== entry.size) throw invalid('owner project VFS owner file size');
  } else {
    throw invalid('owner project VFS owner entry kind');
  }
  inspectCommonEntry(entry);
  return entry as unknown as OwnerVfsSnapshotEntry;
}

function inspectCommonEntry(entry: Record<string, unknown>): void {
  absolutePath(entry.path, 'owner project VFS entry path');
  nonNegativeInteger(entry.size, 'owner project VFS entry size');
  version(entry.version, 'owner project VFS entry version');
}

function inspectReadRequest(frame: Record<string, unknown>): void {
  nonEmptyString(frame.requestId, 'page project VFS read request id');
  absolutePath(frame.path, 'page project VFS read path');
}

function inspectReadFileResult(frame: Record<string, unknown>): ProjectVfsReadFileResult {
  nonEmptyString(frame.requestId, 'owner project VFS read-file request id');
  if (frame.ok === true) {
    exact(
      frame,
      ['type', 'requestId', 'ok', 'ownerEpoch', 'treeRevision', 'entry'],
      'owner project VFS read-file success',
    );
    inspectRevision(frame);
    const entry = inspectOwnerSnapshotEntry(frame.entry);
    if (entry.kind !== 'file') throw invalid('owner project VFS read-file entry');
  } else if (frame.ok === false) {
    exact(frame, ['type', 'requestId', 'ok', 'error'], 'owner project VFS read-file failure');
    inspectReadFailure(frame.error);
  } else {
    throw invalid('owner project VFS read-file result');
  }
  return frame as unknown as ProjectVfsReadFileResult;
}

function inspectReadDirectoryResult(frame: Record<string, unknown>): ProjectVfsReadDirectoryResult {
  nonEmptyString(frame.requestId, 'owner project VFS read-directory request id');
  if (frame.ok === true) {
    exact(
      frame,
      ['type', 'requestId', 'ok', 'ownerEpoch', 'treeRevision', 'entries'],
      'owner project VFS read-directory success',
    );
    inspectRevision(frame);
    if (!Array.isArray(frame.entries)) throw invalid('owner project VFS directory entries');
    for (const value of frame.entries) {
      const entry = record(value, 'owner project VFS directory entry');
      exact(entry, ['path', 'kind', 'size', 'version'], 'owner project VFS directory entry');
      if (entry.kind !== 'file' && entry.kind !== 'dir') {
        throw invalid('owner project VFS directory entry kind');
      }
      if (entry.kind === 'dir' && entry.size !== 0) {
        throw invalid('owner project VFS directory size');
      }
      inspectCommonEntry(entry);
    }
  } else if (frame.ok === false) {
    exact(frame, ['type', 'requestId', 'ok', 'error'], 'owner project VFS read-directory failure');
    inspectReadFailure(frame.error);
  } else {
    throw invalid('owner project VFS read-directory result');
  }
  return frame as unknown as ProjectVfsReadDirectoryResult;
}

function inspectReadFailure(value: unknown): ProjectVfsReadFailure {
  const error = inspectFailure(value, 'owner project VFS read failure');
  return error as unknown as ProjectVfsReadFailure;
}

function inspectFailure(value: unknown, label: string): Record<string, unknown> {
  const error = record(value, label);
  exact(error, ['name', 'message'], label);
  nonEmptyString(error.name, `${label} name`);
  string(error.message, `${label} message`);
  return error;
}

function inspectRevision(value: Record<string, unknown>): void {
  nonEmptyString(value.ownerEpoch, 'owner project VFS epoch');
  nonNegativeInteger(value.treeRevision, 'owner project VFS revision');
}

function exact(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw invalid(label);
  }
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(label);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(label);
  return value;
}

function absolutePath(value: unknown, label: string): string {
  const path = nonEmptyString(value, label);
  if (!path.startsWith('/') || path.includes('\0')) throw invalid(label);
  const segments = path.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalid(label);
  }
  return path;
}

function version(value: unknown, label: string): string {
  return nonEmptyString(value, label);
}

function nullableVersion(value: unknown, label: string): string | null {
  if (value === null) return null;
  return version(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(label);
  return value as number;
}

function bytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw invalid(label);
  return value;
}

function invalid(label: string): TypeError {
  return new TypeError(`Invalid ${label}`);
}
