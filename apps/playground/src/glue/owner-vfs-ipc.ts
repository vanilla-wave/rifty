import { type PersistFailureReport, isAbsolute, normalizePath } from '@riftydev/vfs';
import {
  type HostCommitAck,
  type HostCommitRequest,
  OperationIdReuseError,
  type OwnerEpoch,
  type OwnerVfsDurabilityReceipt,
  type OwnerVfsSnapshotEntry,
  type TreeRevision,
  VfsCommitAppliedError,
  VfsCommitProtocolError,
  VfsVersionConflictError,
} from './owner-vfs-protocol.ts';

export interface OwnerVfsCommitIpcMessage {
  readonly type: 'rifty:owner-vfs-commit';
  readonly request: HostCommitRequest;
}

/** Page proves it received an applied terminal, allowing exact replay cleanup. */
export interface OwnerVfsCommitReceivedMessage {
  readonly type: 'rifty:owner-vfs-commit-received';
  readonly ack: HostCommitAck;
}

/** Owner confirms the full request/ACK replay record is no longer retained. */
export interface OwnerVfsCommitReleasedMessage {
  readonly type: 'rifty:owner-vfs-commit-released';
  readonly ack: HostCommitAck;
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
      /** Present iff apply succeeded before a later publication step failed. */
      readonly applied?: HostCommitAck;
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

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAbsolutePath(value: unknown): value is string {
  return isNonemptyString(value) && isAbsolute(value);
}

function isPathVersion(value: unknown): value is string {
  return isNonemptyString(value);
}

function isNullablePathVersion(value: unknown): value is string | null {
  return value === null || isPathVersion(value);
}

function isOwnerVfsSnapshotEntry(value: unknown): value is OwnerVfsSnapshotEntry {
  if (
    !isRecord(value) ||
    !isAbsolutePath(value.path) ||
    !isPathVersion(value.version) ||
    !isNonnegativeSafeInteger(value.size)
  ) {
    return false;
  }
  if (value.kind === 'dir') return value.size === 0;
  return (
    value.kind === 'file' &&
    value.content instanceof Uint8Array &&
    value.content.byteLength === value.size
  );
}

function isHostCommitRequest(value: unknown): value is HostCommitRequest {
  if (!isRecord(value) || !isNonemptyString(value.operationId)) return false;
  switch (value.kind) {
    case 'write':
      return (
        isAbsolutePath(value.path) &&
        value.data instanceof Uint8Array &&
        isNullablePathVersion(value.expectedVersion)
      );
    case 'mkdir':
      return isAbsolutePath(value.path) && value.expectedVersion === null;
    case 'remove':
      return (
        isAbsolutePath(value.path) &&
        isPathVersion(value.expectedVersion) &&
        (value.recursive === undefined || typeof value.recursive === 'boolean')
      );
    case 'rename':
      return (
        isAbsolutePath(value.sourcePath) &&
        isAbsolutePath(value.targetPath) &&
        isPathVersion(value.expectedSourceVersion) &&
        isNullablePathVersion(value.expectedTargetVersion)
      );
    default:
      return false;
  }
}

function isHostCommitAck(value: unknown): value is HostCommitAck {
  if (
    !isRecord(value) ||
    !isNonemptyString(value.operationId) ||
    !isNonemptyString(value.ownerEpoch) ||
    !isNonnegativeSafeInteger(value.treeRevision) ||
    !Array.isArray(value.versions) ||
    value.versions.length < 1 ||
    value.versions.length > 2
  ) {
    return false;
  }
  const paths = new Set<string>();
  for (const version of value.versions) {
    if (
      !isRecord(version) ||
      !isAbsolutePath(version.path) ||
      !isNullablePathVersion(version.version) ||
      paths.has(version.path)
    ) {
      return false;
    }
    paths.add(version.path);
  }
  return true;
}

function isOwnerVfsErrorFrame(value: unknown): value is OwnerVfsErrorFrame {
  if (!isRecord(value) || !isNonemptyString(value.name) || typeof value.message !== 'string') {
    return false;
  }
  switch (value.kind) {
    case 'error':
      return true;
    case 'operation-id-reuse':
      return value.name === 'OperationIdReuseError' && isNonemptyString(value.operationId);
    case 'version-conflict': {
      if (
        value.name !== 'VfsVersionConflictError' ||
        !isAbsolutePath(value.path) ||
        !isNullablePathVersion(value.expectedVersion) ||
        !isNullablePathVersion(value.actualVersion) ||
        !isNonemptyString(value.ownerEpoch) ||
        !isNonnegativeSafeInteger(value.treeRevision)
      ) {
        return false;
      }
      if (value.actualVersion === null) return value.actualEntry === null;
      return (
        isOwnerVfsSnapshotEntry(value.actualEntry) &&
        value.actualEntry.path === value.path &&
        value.actualEntry.version === value.actualVersion
      );
    }
    default:
      return false;
  }
}

export function isOwnerVfsCommitIpcMessage(message: unknown): message is OwnerVfsCommitIpcMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-commit' &&
    isHostCommitRequest(message.request)
  );
}

export type OwnerVfsCommitTerminalValidation =
  | { readonly kind: 'unrelated' }
  | { readonly kind: 'valid'; readonly message: OwnerVfsCommitAckMessage }
  | {
      readonly kind: 'malformed';
      readonly operationId: string | null;
      readonly applied: HostCommitAck | null;
      readonly error: VfsCommitProtocolError;
    };

/** Sole structural decoder for commit terminals; never leaks a raw decoder error. */
export function validateOwnerVfsCommitTerminal(message: unknown): OwnerVfsCommitTerminalValidation {
  if (!isRecord(message) || message.type !== 'rifty:owner-vfs-commit-ack') {
    return { kind: 'unrelated' };
  }
  const operationId = isNonemptyString(message.operationId) ? message.operationId : null;
  const applied =
    operationId !== null &&
    isHostCommitAck(message.applied) &&
    message.applied.operationId === operationId
      ? message.applied
      : null;
  const malformed = (detail: string): OwnerVfsCommitTerminalValidation => ({
    kind: 'malformed',
    operationId,
    applied,
    error: new VfsCommitProtocolError(
      `Malformed owner VFS commit terminal (${operationId ?? '<unknown>'}): ${detail}`,
    ),
  });
  if (operationId === null) return malformed('invalid operation identity');
  if (message.ok === true) {
    if (!isHostCommitAck(message.ack)) return malformed('invalid ACK evidence');
    if (message.ack.operationId !== operationId) return malformed('ACK operation mismatch');
    if (message.applied !== undefined) return malformed('success carried failure evidence');
    return { kind: 'valid', message: message as unknown as OwnerVfsCommitAckMessage };
  }
  if (message.ok !== false) return malformed('invalid terminal discriminator');
  if (!isOwnerVfsErrorFrame(message.error)) return malformed('invalid error evidence');
  if (message.error.kind === 'operation-id-reuse' && message.error.operationId !== operationId) {
    return malformed('reuse error operation mismatch');
  }
  if (message.applied !== undefined && applied === null) {
    return malformed('invalid applied evidence');
  }
  return { kind: 'valid', message: message as unknown as OwnerVfsCommitAckMessage };
}

export function isOwnerVfsCommitAckMessage(message: unknown): message is OwnerVfsCommitAckMessage {
  return validateOwnerVfsCommitTerminal(message).kind === 'valid';
}

export function isOwnerVfsCommitReceivedMessage(
  message: unknown,
): message is OwnerVfsCommitReceivedMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-commit-received' &&
    isHostCommitAck(message.ack)
  );
}

export function isOwnerVfsCommitReleasedMessage(
  message: unknown,
): message is OwnerVfsCommitReleasedMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-commit-released' &&
    isHostCommitAck(message.ack)
  );
}

export function isOwnerVfsDurabilityIpcMessage(
  message: unknown,
): message is OwnerVfsDurabilityIpcMessage {
  return (
    isRecord(message) &&
    message.type === 'rifty:owner-vfs-durability' &&
    isNonemptyString(message.barrierId) &&
    isNonemptyString(message.ownerEpoch) &&
    isNonnegativeSafeInteger(message.treeRevision)
  );
}

function isOwnerVfsDurabilityReceipt(value: unknown): value is OwnerVfsDurabilityReceipt {
  return (
    isRecord(value) &&
    isNonemptyString(value.ownerEpoch) &&
    isNonnegativeSafeInteger(value.treeRevision) &&
    (value.durability === 'durable' || value.durability === 'ephemeral')
  );
}

export function isOwnerVfsDurabilityAckMessage(
  message: unknown,
): message is OwnerVfsDurabilityAckMessage {
  if (
    !isRecord(message) ||
    message.type !== 'rifty:owner-vfs-durability-ack' ||
    !isNonemptyString(message.barrierId) ||
    typeof message.ok !== 'boolean'
  ) {
    return false;
  }
  return message.ok
    ? isOwnerVfsDurabilityReceipt(message.receipt)
    : isOwnerVfsErrorFrame(message.error);
}

function normalizedRequestPaths(request: HostCommitRequest): readonly string[] {
  if (request.kind !== 'rename') return [normalizePath(request.path)];
  return [normalizePath(request.sourcePath), normalizePath(request.targetPath)];
}

function expectedVersionForRequestPath(
  request: HostCommitRequest,
  path: string,
  actualVersion: string | null,
): { readonly expectedVersion: string | null } | null {
  const normalizedPath = normalizePath(path);
  const candidates =
    request.kind === 'rename'
      ? [
          {
            path: normalizePath(request.sourcePath),
            expectedVersion: request.expectedSourceVersion,
          },
          {
            path: normalizePath(request.targetPath),
            expectedVersion: request.expectedTargetVersion,
          },
        ]
      : [{ path: normalizePath(request.path), expectedVersion: request.expectedVersion }];
  const matches = candidates.filter((candidate) => candidate.path === normalizedPath);
  for (const candidate of matches) {
    if (candidate.expectedVersion !== actualVersion) {
      return { expectedVersion: candidate.expectedVersion };
    }
  }
  return null;
}

/** Contextual identity/evidence check after structural terminal validation. */
export function validateHostCommitAckForRequest(
  ack: HostCommitAck,
  request: HostCommitRequest,
  ownerEpoch: OwnerEpoch,
): VfsCommitProtocolError | null {
  if (ack.operationId !== request.operationId) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received ACK for ${ack.operationId}`,
    );
  }
  if (ack.ownerEpoch !== ownerEpoch) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received ACK from owner ${ack.ownerEpoch}; expected ${ownerEpoch}`,
    );
  }
  let paths: readonly string[];
  try {
    paths = normalizedRequestPaths(request);
  } catch {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} has invalid request path evidence`,
    );
  }
  const expected =
    request.kind === 'rename' && paths[0] !== paths[1]
      ? [
          { path: paths[0] as string, absent: true },
          { path: paths[1] as string, absent: false },
        ]
      : [
          {
            path: paths.at(-1) as string,
            absent: request.kind === 'remove',
          },
        ];
  if (ack.versions.length !== expected.length) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received divergent version evidence`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = ack.versions[index];
    const wanted = expected[index];
    if (
      !actual ||
      !wanted ||
      actual.path !== wanted.path ||
      (wanted.absent ? actual.version !== null : actual.version === null)
    ) {
      return new VfsCommitProtocolError(
        `VFS commit ${request.operationId} received divergent version evidence`,
      );
    }
  }
  return null;
}

export function validateOwnerVfsCommitTerminalForRequest(
  message: OwnerVfsCommitAckMessage,
  request: HostCommitRequest,
  ownerEpoch: OwnerEpoch,
): VfsCommitProtocolError | null {
  if (message.operationId !== request.operationId) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received terminal for ${message.operationId}`,
    );
  }
  if (message.ok) return validateHostCommitAckForRequest(message.ack, request, ownerEpoch);
  if (message.applied) {
    const appliedError = validateHostCommitAckForRequest(message.applied, request, ownerEpoch);
    if (appliedError) return appliedError;
  }
  if (message.error.kind === 'operation-id-reuse') {
    return message.error.operationId === request.operationId
      ? null
      : new VfsCommitProtocolError(
          `VFS commit ${request.operationId} received reuse error for ${message.error.operationId}`,
        );
  }
  if (message.error.kind !== 'version-conflict') return null;
  if (message.error.ownerEpoch !== ownerEpoch) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received conflict from owner ${message.error.ownerEpoch}; expected ${ownerEpoch}`,
    );
  }
  let expectation: { readonly expectedVersion: string | null } | null;
  try {
    expectation = expectedVersionForRequestPath(
      request,
      message.error.path,
      message.error.actualVersion,
    );
  } catch {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} has invalid request path evidence`,
    );
  }
  if (expectation === null) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received conflict for divergent path ${message.error.path}`,
    );
  }
  if (message.error.expectedVersion !== expectation.expectedVersion) {
    return new VfsCommitProtocolError(
      `VFS commit ${request.operationId} received conflict for divergent expected version`,
    );
  }
  return null;
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

export function decodeOwnerVfsCommitFailure(
  frame: Extract<OwnerVfsCommitAckMessage, { readonly ok: false }>,
): Error {
  const cause = decodeOwnerVfsError(frame.error);
  return frame.applied ? new VfsCommitAppliedError(frame.applied, cause) : cause;
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
    try {
      options.publishSnapshot();
    } catch (error) {
      fail(error, ack);
      return;
    }
    options.send({ type: 'rifty:owner-vfs-commit-ack', operationId, ok: true, ack });
  };
  const fail = (error: unknown, applied?: HostCommitAck): void => {
    options.send({
      type: 'rifty:owner-vfs-commit-ack',
      operationId,
      ok: false,
      error: encodeOwnerVfsError(error),
      ...(applied ? { applied } : {}),
    });
  };
  let applied: HostCommitAck | Promise<HostCommitAck>;
  let then: unknown;
  try {
    applied = options.apply(options.message.request);
    then =
      typeof applied === 'object' && applied !== null
        ? (applied as { readonly then?: unknown }).then
        : undefined;
  } catch (error) {
    fail(error);
    return;
  }
  if (typeof then === 'function') {
    void Promise.resolve(applied).then(succeed, (error: unknown) => fail(error));
    return;
  }
  succeed(applied as HostCommitAck);
}

export interface OwnerVfsCommitReceiptHandlerOptions {
  readonly message: OwnerVfsCommitReceivedMessage;
  readonly release: (ack: HostCommitAck) => void;
  readonly recover: (operationId: string) => HostCommitAck | null;
  readonly send: (message: OwnerVfsCommitReleasedMessage | OwnerVfsCommitAckMessage) => void;
  readonly reportError?: (error: Error) => void;
}

/** Same-sender ordering makes every earlier retry precede this exact receipt. */
export function handleOwnerVfsCommitReceipt(options: OwnerVfsCommitReceiptHandlerOptions): void {
  try {
    options.release(options.message.ack);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (options.reportError) options.reportError(error);
    else console.error('[owner-vfs] rejected divergent commit receipt', error);
    let recovered: HostCommitAck | null;
    try {
      recovered = options.recover(options.message.ack.operationId);
    } catch (recoveryCause) {
      const recoveryError =
        recoveryCause instanceof Error ? recoveryCause : new Error(String(recoveryCause));
      if (options.reportError) options.reportError(recoveryError);
      else console.error('[owner-vfs] failed to recover retained commit ACK', recoveryError);
      return;
    }
    if (recovered) {
      options.send({
        type: 'rifty:owner-vfs-commit-ack',
        operationId: recovered.operationId,
        ok: true,
        ack: recovered,
      });
    }
    return;
  }
  options.send({ type: 'rifty:owner-vfs-commit-released', ack: options.message.ack });
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
