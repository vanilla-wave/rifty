import type { OwnerEpoch, TreeRevision } from '../workbench/project-vfs-contract.ts';
import {
  type OwnerVfsCommitCleanupMessage,
  type OwnerVfsCommitIpcMessage,
  type OwnerVfsCommitReceivedMessage,
  type OwnerVfsCommitTerminal,
  type OwnerVfsDurabilityIpcMessage,
  decodeOwnerVfsCommitFailure,
  decodeOwnerVfsError,
  equalOwnerVfsCommitTerminals,
  isOwnerVfsCommitCleanedMessage,
  isOwnerVfsCommitIpcMessage,
  isOwnerVfsCommitReleasedMessage,
  isOwnerVfsDurabilityAckMessage,
  validateHostCommitAckForRequest,
  validateOwnerVfsCommitTerminal,
  validateOwnerVfsCommitTerminalForRequest,
} from './owner-vfs-ipc.ts';
import type { OwnerVfsAppliedCommitTerminal } from './owner-vfs-ipc.ts';
import type {
  HostCommitAck,
  HostCommitRequest,
  OwnerVfsDurabilityReceipt,
} from './owner-vfs-protocol.ts';
import {
  OperationIdReuseError,
  VfsCommitProtocolError,
  equalHostCommitRequests,
} from './owner-vfs-protocol.ts';

export type OwnerVfsClientOutboundFrame =
  | OwnerVfsCommitIpcMessage
  | OwnerVfsCommitReceivedMessage
  | OwnerVfsCommitCleanupMessage
  | OwnerVfsDurabilityIpcMessage;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface OwnerVfsClientTimers {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(timer: TimerHandle): void;
}

export interface OwnerVfsClientOptions {
  /** `false` proves an initial frame was not admitted; retries remain best-effort. */
  readonly send: (frame: OwnerVfsClientOutboundFrame) => boolean;
  readonly currentOwnerEpoch: () => OwnerEpoch | null;
  readonly isAlive: () => boolean;
  readonly generateBarrierId?: () => string;
  readonly timers?: OwnerVfsClientTimers;
  readonly commitReplayMs?: number;
  readonly commitAckTimeoutMs?: number;
  readonly commitReceiptRetryMs?: number;
  readonly durabilityAckTimeoutMs?: number;
  readonly reportProtocolError?: (error: VfsCommitProtocolError) => void;
}

export interface OwnerVfsClient {
  /** Consumes only exact owner-VFS terminal/release/cleanup/durability frames. */
  accept(frame: unknown): boolean;
  applyHostCommit(request: HostCommitRequest): Promise<HostCommitAck>;
  durabilityBarrier(treeRevision: TreeRevision): Promise<OwnerVfsDurabilityReceipt>;
  /** Certified transport exit: reject admitted work and stop every retry. */
  disconnect(error?: Error): void;
  /** Local teardown with one caller-owned error for pending and future work. */
  close(error?: Error): void;
}

interface PendingCommit {
  readonly request: HostCommitRequest;
  readonly ownerEpoch: OwnerEpoch;
  readonly promise: Promise<HostCommitAck>;
  readonly resolve: (ack: HostCommitAck) => void;
  readonly reject: (error: Error) => void;
  replayTimer: TimerHandle | null;
  ackTimer: TimerHandle | null;
  candidate: OwnerVfsCommitTerminal | null;
}

interface PendingTerminalDelivery {
  readonly terminal: OwnerVfsCommitTerminal;
  timer: TimerHandle | null;
}

interface PendingDurability {
  readonly resolve: (receipt: OwnerVfsDurabilityReceipt) => void;
  readonly reject: (error: Error) => void;
  readonly timer: TimerHandle;
}

const DEFAULT_COMMIT_REPLAY_MS = 250;
const DEFAULT_COMMIT_ACK_TIMEOUT_MS = 60_000;
const DEFAULT_COMMIT_RECEIPT_RETRY_MS = 250;
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
 * Page-side exact owner-VFS state machine. Transport owns only delivery and
 * owner lifecycle; request identity, replay, retained-terminal receipts,
 * cleanup, correlation, applied evidence, and durability stay here.
 */
export function createOwnerVfsClient(options: OwnerVfsClientOptions): OwnerVfsClient {
  const timers: OwnerVfsClientTimers =
    options.timers ??
    Object.freeze({
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (timer: TimerHandle) => clearTimeout(timer),
    });
  const commitReplayMs = positiveDelay(
    options.commitReplayMs,
    DEFAULT_COMMIT_REPLAY_MS,
    'owner VFS commit replay delay',
  );
  const commitAckTimeoutMs = positiveDelay(
    options.commitAckTimeoutMs,
    DEFAULT_COMMIT_ACK_TIMEOUT_MS,
    'owner VFS commit ack timeout',
  );
  const commitReceiptRetryMs = positiveDelay(
    options.commitReceiptRetryMs,
    DEFAULT_COMMIT_RECEIPT_RETRY_MS,
    'owner VFS commit receipt retry delay',
  );
  const durabilityAckTimeoutMs = positiveDelay(
    options.durabilityAckTimeoutMs,
    DEFAULT_DURABILITY_ACK_TIMEOUT_MS,
    'owner VFS durability timeout',
  );
  const generateBarrierId = options.generateBarrierId ?? defaultBarrierId;
  const reportProtocolError = options.reportProtocolError ?? (() => {});

  const commits = new Map<string, PendingCommit>();
  const receipts = new Map<string, PendingTerminalDelivery>();
  const cleanups = new Map<string, PendingTerminalDelivery>();
  const durability = new Map<string, PendingDurability>();
  let disconnected = false;
  let disconnectError: Error | null = null;
  let closedError: Error | null = null;

  const postReceipt = (operationId: string): void => {
    const pending = receipts.get(operationId);
    if (!pending) return;
    try {
      options.send({ type: 'rifty:owner-vfs-commit-received', terminal: pending.terminal });
    } catch {
      // Exact retry ownership ends only at release or certified disconnect.
    }
    if (receipts.get(operationId) !== pending) return;
    pending.timer = timers.setTimeout(() => postReceipt(operationId), commitReceiptRetryMs);
  };

  const stopReceipt = (operationId: string): void => {
    const pending = receipts.get(operationId);
    if (!pending) return;
    receipts.delete(operationId);
    if (pending.timer !== null) timers.clearTimeout(pending.timer);
  };

  const receiveTerminal = (terminal: OwnerVfsCommitTerminal): void => {
    const prior = receipts.get(terminal.operationId);
    if (prior) {
      if (equalOwnerVfsCommitTerminals(prior.terminal, terminal)) return;
      stopReceipt(terminal.operationId);
    }
    receipts.set(terminal.operationId, { terminal, timer: null });
    postReceipt(terminal.operationId);
  };

  const postCleanup = (operationId: string): void => {
    const pending = cleanups.get(operationId);
    if (!pending) return;
    try {
      options.send({ type: 'rifty:owner-vfs-commit-cleanup', terminal: pending.terminal });
    } catch {
      // Cleanup retry retains exact terminal identity until owner confirmation.
    }
    if (cleanups.get(operationId) !== pending) return;
    pending.timer = timers.setTimeout(() => postCleanup(operationId), commitReceiptRetryMs);
  };

  const stopCleanup = (operationId: string): void => {
    const pending = cleanups.get(operationId);
    if (!pending) return;
    cleanups.delete(operationId);
    if (pending.timer !== null) timers.clearTimeout(pending.timer);
  };

  const startCleanup = (terminal: OwnerVfsCommitTerminal): void => {
    const prior = cleanups.get(terminal.operationId);
    if (prior) {
      if (equalOwnerVfsCommitTerminals(prior.terminal, terminal)) return;
      stopCleanup(terminal.operationId);
    }
    cleanups.set(terminal.operationId, { terminal, timer: null });
    postCleanup(terminal.operationId);
  };

  const scheduleReplay = (operationId: string): void => {
    const pending = commits.get(operationId);
    if (!pending || pending.candidate !== null || pending.replayTimer !== null) return;
    pending.replayTimer = timers.setTimeout(() => {
      if (commits.get(operationId) !== pending) return;
      pending.replayTimer = null;
      replay(operationId);
    }, commitReplayMs);
  };

  const replay = (operationId: string): void => {
    const pending = commits.get(operationId);
    if (!pending || pending.candidate !== null) return;
    if (pending.replayTimer !== null) {
      timers.clearTimeout(pending.replayTimer);
      pending.replayTimer = null;
    }
    try {
      options.send({ type: 'rifty:owner-vfs-commit', request: pending.request });
    } catch {
      // An earlier exact send may be admitted; only terminal or exit can settle.
    }
    if (commits.get(operationId) !== pending) return;
    scheduleReplay(operationId);
  };

  const startReplay = (operationId: string): void => {
    const pending = commits.get(operationId);
    if (!pending || pending.candidate !== null) return;
    replay(operationId);
  };

  const takeCommit = (operationId: string): PendingCommit | null => {
    const pending = commits.get(operationId);
    if (!pending) return null;
    commits.delete(operationId);
    if (pending.replayTimer !== null) timers.clearTimeout(pending.replayTimer);
    if (pending.ackTimer !== null) timers.clearTimeout(pending.ackTimer);
    stopReceipt(operationId);
    return pending;
  };

  const stageCandidate = (operationId: string, candidate: OwnerVfsCommitTerminal): void => {
    const pending = commits.get(operationId);
    if (!pending) return;
    if (pending.replayTimer !== null) {
      timers.clearTimeout(pending.replayTimer);
      pending.replayTimer = null;
    }
    if (pending.ackTimer !== null) {
      timers.clearTimeout(pending.ackTimer);
      pending.ackTimer = null;
    }
    pending.candidate = candidate;
    receiveTerminal(candidate);
  };

  const protocolAppliedTerminal = (
    operationId: string,
    applied: HostCommitAck,
    error: VfsCommitProtocolError,
  ): OwnerVfsAppliedCommitTerminal => ({
    type: 'rifty:owner-vfs-commit-ack',
    operationId,
    ok: false,
    error: { kind: 'error', name: error.name, message: error.message },
    applied,
  });

  const accept = (message: unknown): boolean => {
    const terminal = validateOwnerVfsCommitTerminal(message);
    if (terminal.kind === 'malformed') {
      if (terminal.operationId === null) return true;
      const pending = commits.get(terminal.operationId);
      if (!pending) return true;
      if (terminal.applied) {
        const correlationError = validateHostCommitAckForRequest(
          terminal.applied,
          pending.request,
          pending.ownerEpoch,
        );
        if (correlationError) {
          reportProtocolError(correlationError);
          startReplay(terminal.operationId);
          return true;
        }
        stageCandidate(
          terminal.operationId,
          protocolAppliedTerminal(terminal.operationId, terminal.applied, terminal.error),
        );
        return true;
      }
      reportProtocolError(terminal.error);
      startReplay(terminal.operationId);
      return true;
    }
    if (terminal.kind === 'valid') {
      const pending = commits.get(terminal.message.operationId);
      if (!pending) return true;
      const correlationError = validateOwnerVfsCommitTerminalForRequest(
        terminal.message,
        pending.request,
        pending.ownerEpoch,
      );
      if (correlationError) {
        if (
          !terminal.message.ok &&
          terminal.message.applied &&
          validateHostCommitAckForRequest(
            terminal.message.applied,
            pending.request,
            pending.ownerEpoch,
          ) === null
        ) {
          stageCandidate(
            terminal.message.operationId,
            protocolAppliedTerminal(
              terminal.message.operationId,
              terminal.message.applied,
              correlationError,
            ),
          );
          return true;
        }
        reportProtocolError(correlationError);
        startReplay(terminal.message.operationId);
        return true;
      }
      stageCandidate(terminal.message.operationId, terminal.message);
      return true;
    }
    if (isOwnerVfsCommitReleasedMessage(message)) {
      const operationId = message.terminal.operationId;
      const pending = commits.get(operationId);
      const receipt = receipts.get(operationId);
      if (!pending?.candidate || !receipt) return true;
      if (
        !equalOwnerVfsCommitTerminals(pending.candidate, message.terminal) ||
        !equalOwnerVfsCommitTerminals(receipt.terminal, message.terminal)
      ) {
        return true;
      }
      const correlationError = validateOwnerVfsCommitTerminalForRequest(
        message.terminal,
        pending.request,
        pending.ownerEpoch,
      );
      if (correlationError) {
        reportProtocolError(correlationError);
        return true;
      }
      const settled = takeCommit(operationId);
      if (!settled) return true;
      startCleanup(message.terminal);
      if (message.terminal.ok) settled.resolve(message.terminal.ack);
      else settled.reject(decodeOwnerVfsCommitFailure(message.terminal));
      return true;
    }
    if (isOwnerVfsCommitCleanedMessage(message)) {
      const pending = cleanups.get(message.terminal.operationId);
      if (pending && equalOwnerVfsCommitTerminals(pending.terminal, message.terminal)) {
        stopCleanup(message.terminal.operationId);
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
    if (!isOwnerVfsCommitIpcMessage({ type: 'rifty:owner-vfs-commit', request })) {
      return Promise.reject(
        new VfsCommitProtocolError(
          `VFS commit ${String(request.operationId)} has a malformed request frame`,
        ),
      );
    }
    const ownedRequest = ownHostCommitRequest(request);
    const prior = commits.get(request.operationId);
    if (prior) {
      return equalHostCommitRequests(prior.request, ownedRequest)
        ? prior.promise
        : Promise.reject(new OperationIdReuseError(request.operationId));
    }
    let resolveCommit: (ack: HostCommitAck) => void = () => {};
    let rejectCommit: (error: Error) => void = () => {};
    const promise = new Promise<HostCommitAck>((resolve, reject) => {
      resolveCommit = resolve;
      rejectCommit = reject;
    });
    const pending: PendingCommit = {
      request: ownedRequest,
      ownerEpoch,
      promise,
      resolve: resolveCommit,
      reject: rejectCommit,
      replayTimer: null,
      ackTimer: null,
      candidate: null,
    };
    commits.set(request.operationId, pending);
    pending.ackTimer = timers.setTimeout(() => {
      const timedOut = takeCommit(request.operationId);
      timedOut?.reject(
        new Error(
          `owner VFS commit ack timed out after ${String(commitAckTimeoutMs)}ms (${request.operationId})`,
        ),
      );
    }, commitAckTimeoutMs);
    let sent = false;
    try {
      sent = options.send({ type: 'rifty:owner-vfs-commit', request: ownedRequest });
    } catch {
      // Same definite-not-admitted outcome as a transport `false`.
    }
    if (!sent) {
      takeCommit(request.operationId);
      rejectCommit(new Error(`owner conditional VFS commit send failed (${request.operationId})`));
      return promise;
    }
    scheduleReplay(request.operationId);
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

  const clearDeliveries = (): void => {
    for (const [operationId, pending] of receipts) {
      receipts.delete(operationId);
      if (pending.timer !== null) timers.clearTimeout(pending.timer);
    }
    for (const [operationId, pending] of cleanups) {
      cleanups.delete(operationId);
      if (pending.timer !== null) timers.clearTimeout(pending.timer);
    }
  };

  const disconnect = (error?: Error): void => {
    if (disconnected || closedError !== null) return;
    disconnected = true;
    disconnectError = error ?? null;
    for (const [operationId, pending] of commits) {
      commits.delete(operationId);
      if (pending.replayTimer !== null) timers.clearTimeout(pending.replayTimer);
      if (pending.ackTimer !== null) timers.clearTimeout(pending.ackTimer);
      pending.reject(
        error ??
          new Error(`workspace owner exited before conditional VFS commit ack (${operationId})`),
      );
    }
    clearDeliveries();
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
      if (pending.replayTimer !== null) timers.clearTimeout(pending.replayTimer);
      if (pending.ackTimer !== null) timers.clearTimeout(pending.ackTimer);
      pending.reject(error);
    }
    clearDeliveries();
    for (const [barrierId, pending] of durability) {
      durability.delete(barrierId);
      timers.clearTimeout(pending.timer);
      pending.reject(error);
    }
  };

  return Object.freeze({ accept, applyHostCommit, durabilityBarrier, disconnect, close });
}
