import {
  type OwnerVfsCommitIpcMessage,
  type OwnerVfsDurabilityIpcMessage,
  decodeOwnerVfsCommitFailure,
  decodeOwnerVfsError,
  isOwnerVfsCommitIpcMessage,
  isOwnerVfsDurabilityAckMessage,
  validateHostCommitAckForRequest,
  validateOwnerVfsCommitTerminal,
  validateOwnerVfsCommitTerminalForRequest,
} from './owner-vfs-ipc.ts';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerEpoch,
  OwnerVfsDurabilityReceipt,
  TreeRevision,
} from './owner-vfs-protocol.ts';
import {
  OperationIdReuseError,
  VfsCommitAppliedError,
  VfsCommitProtocolError,
} from './owner-vfs-protocol.ts';

export type OwnerVfsClientOutboundFrame = OwnerVfsCommitIpcMessage | OwnerVfsDurabilityIpcMessage;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface OwnerVfsClientTimers {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(timer: TimerHandle): void;
}

export interface OwnerVfsClientOptions {
  /** `false` or throw proves this one attempted frame was not admitted. */
  readonly send: (frame: OwnerVfsClientOutboundFrame) => boolean;
  readonly currentOwnerEpoch: () => OwnerEpoch | null;
  readonly isAlive: () => boolean;
  readonly generateBarrierId?: () => string;
  readonly timers?: OwnerVfsClientTimers;
  readonly durabilityAckTimeoutMs?: number;
  readonly reportProtocolError?: (error: VfsCommitProtocolError) => void;
}

export interface OwnerVfsClient {
  /** Consumes only exact owner-VFS terminal and durability frames. */
  accept(frame: unknown): boolean;
  applyHostCommit(request: HostCommitRequest): Promise<HostCommitAck>;
  durabilityBarrier(treeRevision: TreeRevision): Promise<OwnerVfsDurabilityReceipt>;
  /** Certified transport exit settles every admitted operation. */
  disconnect(error?: Error): void;
  close(error?: Error): void;
}

interface PendingCommit {
  readonly request: HostCommitRequest;
  readonly ownerEpoch: OwnerEpoch;
  readonly resolve: (ack: HostCommitAck) => void;
  readonly reject: (error: Error) => void;
}

interface PendingDurability {
  readonly resolve: (receipt: OwnerVfsDurabilityReceipt) => void;
  readonly reject: (error: Error) => void;
  readonly timer: TimerHandle;
}

const DEFAULT_DURABILITY_ACK_TIMEOUT_MS = 35_000;

function ownHostCommitRequest(request: HostCommitRequest): HostCommitRequest {
  return request.kind === 'write' ? { ...request, data: request.data.slice() } : { ...request };
}

function defaultBarrierId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `vfs-barrier-${Math.random().toString(36).slice(2, 10)}`
  );
}

function positiveDelay(value: number | undefined, fallback: number, label: string): number {
  const delay = value ?? fallback;
  if (!Number.isFinite(delay) || delay <= 0) throw new RangeError(`${label} must be positive`);
  return delay;
}

/**
 * Dedicated live-port client. An admitted mutation is sent exactly once and
 * settles only from its correlated terminal or confirmed owner death.
 */
export function createOwnerVfsClient(options: OwnerVfsClientOptions): OwnerVfsClient {
  const timers: OwnerVfsClientTimers =
    options.timers ??
    Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: TimerHandle) => clearTimeout(timer),
    });
  const durabilityAckTimeoutMs = positiveDelay(
    options.durabilityAckTimeoutMs,
    DEFAULT_DURABILITY_ACK_TIMEOUT_MS,
    'owner VFS durability timeout',
  );
  const generateBarrierId = options.generateBarrierId ?? defaultBarrierId;
  const reportProtocolError = options.reportProtocolError ?? (() => {});
  const commits = new Map<string, PendingCommit>();
  const durability = new Map<string, PendingDurability>();
  let disconnected = false;
  let disconnectError: Error | null = null;
  let closedError: Error | null = null;

  const takeCommit = (operationId: string): PendingCommit | null => {
    const pending = commits.get(operationId);
    if (!pending) return null;
    commits.delete(operationId);
    return pending;
  };

  const accept = (message: unknown): boolean => {
    const terminal = validateOwnerVfsCommitTerminal(message);
    if (terminal.kind === 'malformed') {
      if (terminal.operationId === null) return true;
      const pending = takeCommit(terminal.operationId);
      if (!pending) return true;
      reportProtocolError(terminal.error);
      if (
        terminal.applied &&
        validateHostCommitAckForRequest(terminal.applied, pending.request, pending.ownerEpoch) ===
          null
      ) {
        pending.reject(new VfsCommitAppliedError(terminal.applied, terminal.error));
      } else {
        pending.reject(terminal.error);
      }
      return true;
    }
    if (terminal.kind === 'valid') {
      const pending = takeCommit(terminal.message.operationId);
      if (!pending) return true;
      const correlationError = validateOwnerVfsCommitTerminalForRequest(
        terminal.message,
        pending.request,
        pending.ownerEpoch,
      );
      if (correlationError) {
        reportProtocolError(correlationError);
        if (
          !terminal.message.ok &&
          terminal.message.applied &&
          validateHostCommitAckForRequest(
            terminal.message.applied,
            pending.request,
            pending.ownerEpoch,
          ) === null
        ) {
          pending.reject(new VfsCommitAppliedError(terminal.message.applied, correlationError));
        } else {
          pending.reject(correlationError);
        }
      } else if (terminal.message.ok) {
        pending.resolve(terminal.message.ack);
      } else {
        pending.reject(decodeOwnerVfsCommitFailure(terminal.message));
      }
      return true;
    }
    if (isOwnerVfsDurabilityAckMessage(message)) {
      const pending = durability.get(message.barrierId);
      if (!pending) return true;
      durability.delete(message.barrierId);
      timers.clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.receipt);
      else {
        try {
          pending.reject(decodeOwnerVfsError(message.error));
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return true;
    }
    return false;
  };

  const unavailableCommit = (): Error | null => {
    if (closedError !== null) return closedError;
    if (disconnectError !== null) return disconnectError;
    if (disconnected || !options.isAlive()) {
      return new Error('workspace owner has exited — conditional VFS commit was not applied.');
    }
    return null;
  };

  const applyHostCommit = (request: HostCommitRequest): Promise<HostCommitAck> => {
    const unavailable = unavailableCommit();
    if (unavailable !== null) return Promise.reject(unavailable);
    const ownerEpoch = options.currentOwnerEpoch();
    if (ownerEpoch === null) {
      return Promise.reject(new Error('workspace owner is not ready for conditional VFS commits'));
    }
    const ownedRequest = ownHostCommitRequest(request);
    if (!isOwnerVfsCommitIpcMessage({ type: 'rifty:owner-vfs-commit', request: ownedRequest })) {
      return Promise.reject(
        new VfsCommitProtocolError(
          `VFS commit ${String(request.operationId)} has a malformed request frame`,
        ),
      );
    }
    const prior = commits.get(request.operationId);
    if (prior) {
      return Promise.reject(new OperationIdReuseError(request.operationId));
    }
    let resolveCommit: (ack: HostCommitAck) => void = () => {};
    let rejectCommit: (error: Error) => void = () => {};
    const promise = new Promise<HostCommitAck>((resolve, reject) => {
      resolveCommit = resolve;
      rejectCommit = reject;
    });
    commits.set(request.operationId, {
      request: ownedRequest,
      ownerEpoch,
      resolve: resolveCommit,
      reject: rejectCommit,
    });
    let sent = false;
    try {
      sent = options.send({ type: 'rifty:owner-vfs-commit', request: ownedRequest });
    } catch {
      // Throw is the same definite-not-admitted outcome as `false`.
    }
    if (!sent) {
      takeCommit(request.operationId);
      rejectCommit(new Error(`owner conditional VFS commit send failed (${request.operationId})`));
    }
    return promise;
  };

  const unavailableDurability = (): Error | null => {
    if (closedError !== null) return closedError;
    if (disconnectError !== null) return disconnectError;
    if (disconnected || !options.isAlive()) {
      return new Error('workspace owner has exited — VFS durability cannot be proven.');
    }
    return null;
  };

  const durabilityBarrier = (treeRevision: TreeRevision): Promise<OwnerVfsDurabilityReceipt> => {
    const unavailable = unavailableDurability();
    if (unavailable !== null) return Promise.reject(unavailable);
    const ownerEpoch = options.currentOwnerEpoch();
    if (ownerEpoch === null) {
      return Promise.reject(new Error('workspace owner is not ready for VFS durability'));
    }
    const barrierId = generateBarrierId();
    return new Promise<OwnerVfsDurabilityReceipt>((resolve, reject) => {
      const timer = timers.setTimeout(() => {
        durability.delete(barrierId);
        reject(new Error(`owner VFS durability ack timed out (${barrierId})`));
      }, durabilityAckTimeoutMs);
      durability.set(barrierId, { resolve, reject, timer });
      let sent = false;
      try {
        sent = options.send({
          type: 'rifty:owner-vfs-durability',
          barrierId,
          ownerEpoch,
          treeRevision,
        });
      } catch (error) {
        durability.delete(barrierId);
        timers.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!sent) {
        durability.delete(barrierId);
        timers.clearTimeout(timer);
        reject(new Error(`owner VFS durability send failed (${barrierId})`));
      }
    });
  };

  const disconnect = (error?: Error): void => {
    if (disconnected || closedError !== null) return;
    disconnected = true;
    disconnectError = error ?? null;
    for (const [operationId, pending] of commits) {
      commits.delete(operationId);
      pending.reject(
        error ??
          new Error(`workspace owner exited before conditional VFS commit ack (${operationId})`),
      );
    }
    for (const [barrierId, pending] of durability) {
      durability.delete(barrierId);
      timers.clearTimeout(pending.timer);
      pending.reject(
        error ?? new Error(`workspace owner exited before VFS durability ack (${barrierId})`),
      );
    }
  };

  const close = (error = new Error('owner VFS client is closed')): void => {
    if (closedError !== null || disconnected) return;
    closedError = error;
    for (const [operationId, pending] of commits) {
      commits.delete(operationId);
      pending.reject(error);
    }
    for (const [barrierId, pending] of durability) {
      durability.delete(barrierId);
      timers.clearTimeout(pending.timer);
      pending.reject(error);
    }
  };

  return Object.freeze({ accept, applyHostCommit, durabilityBarrier, disconnect, close });
}
