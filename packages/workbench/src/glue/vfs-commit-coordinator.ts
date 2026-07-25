import type {
  HostCommitAck,
  HostCommitOperation,
  HostCommitRequest,
  OwnerEpoch,
  OwnerVfsDurabilityReceipt,
  OwnerVfsRevisionFrame,
  TreeRevision,
} from './owner-vfs-protocol.ts';
import {
  VfsCommitAppliedError,
  VfsCommitProtocolError,
  VfsPersistenceFailureError,
} from './owner-vfs-protocol.ts';

export type VfsCommitStage = 'reflection' | 'durability';

export { VfsCommitProtocolError } from './owner-vfs-protocol.ts';

export class VfsCommitTimeoutError extends Error {
  readonly operationId: string;
  readonly stage: VfsCommitStage;
  readonly ack: HostCommitAck;

  constructor(ack: HostCommitAck, stage: VfsCommitStage, timeoutMs: number) {
    super(
      `VFS commit ${ack.operationId} applied at revision ${ack.treeRevision} but ${stage} did not complete within ${timeoutMs}ms`,
    );
    this.name = 'VfsCommitTimeoutError';
    this.operationId = ack.operationId;
    this.stage = stage;
    this.ack = ack;
  }
}

export class VfsOwnerExitedError extends Error {
  readonly ownerEpoch: OwnerEpoch;
  readonly exitReason: unknown;

  constructor(ownerEpoch: OwnerEpoch, exitReason?: unknown) {
    super(`VFS owner ${ownerEpoch} exited during a host commit`);
    this.name = 'VfsOwnerExitedError';
    this.ownerEpoch = ownerEpoch;
    this.exitReason = exitReason;
  }
}

export class VfsCommitCoordinatorClosedError extends Error {
  constructor() {
    super('VFS commit coordinator is closed');
    this.name = 'VfsCommitCoordinatorClosedError';
  }
}

/** Captured page→owner transport. Every phase stays bound to this exact owner. */
export interface VfsCommitOwner {
  readonly ownerEpoch: OwnerEpoch;
  isAlive(): boolean;
  readonly closed: Promise<unknown>;
  applyHostCommit(request: HostCommitRequest): Promise<HostCommitAck>;
  durabilityBarrier(treeRevision: TreeRevision): Promise<OwnerVfsDurabilityReceipt>;
}

export interface VfsCommitCoordinatorOptions {
  /** Captured once per commit, synchronously before transport. */
  captureOwner(): VfsCommitOwner;
  /** Owner revision frames only after the corresponding page mirror apply. */
  subscribeSnapshots(listener: (snapshot: OwnerVfsRevisionFrame) => void): () => void;
  readonly timeoutMs: number;
  /** Impossible ACK/durability correlations; reporter failures never replace commit truth. */
  readonly reportProtocolError?: (error: VfsCommitProtocolError) => void;
  /** Exact durability-barrier transitions; observer failures never replace commit truth. */
  readonly onDurabilityState?: (state: VfsCommitDurabilityState) => void;
}

export type VfsCommitDurabilityState =
  | {
      readonly status: 'failed';
      readonly error: Error;
      readonly recover: () => Promise<void>;
    }
  | { readonly status: 'proved' };

export interface VfsCommitReceipt extends HostCommitAck {
  readonly durability: OwnerVfsDurabilityReceipt['durability'];
}

export interface VfsCommitObservation {
  /** Runs once immediately after a correlated ACK proves the mutation applied. */
  readonly onApplied?: (revision: OwnerVfsRevisionFrame) => void;
}

export interface VfsCommitCoordinator {
  /** Claims an operation id and invokes owner transport before returning. */
  commit(
    operation: HostCommitOperation,
    observation?: VfsCommitObservation,
  ): Promise<VfsCommitReceipt>;
  /** Rejects future and unhanded commits; handed-off commits keep their owner outcome. */
  close(error?: Error): void;
}

interface PendingCommit {
  owner: VfsCommitOwner | null;
  handedOff: boolean;
  cancel(error: Error): void;
}

interface DurabilityFailureTarget {
  readonly generation: number;
  readonly owner: VfsCommitOwner;
  readonly operationId: string;
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
}

function createCoordinatorNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('VFS commit coordinator requires cryptographic operation identity');
}

function createRequest(operation: HostCommitOperation, operationId: string): HostCommitRequest {
  switch (operation.kind) {
    case 'write':
      return { ...operation, operationId, data: operation.data.slice() };
    case 'mkdir':
    case 'remove':
    case 'rename':
      return { ...operation, operationId };
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function cleanupError(primary: Error, secondary: Error | null): Error {
  return secondary === null ? primary : new AggregateError([primary, secondary], primary.message);
}

function hasAppliedEvidence(error: Error): boolean {
  return error instanceof VfsCommitAppliedError || error instanceof VfsCommitTimeoutError;
}

/** Decoded only from the owner wire's completed-flush outcome. */
function isCompletedFlushPersistenceFailure(error: Error): boolean {
  return error instanceof VfsPersistenceFailureError;
}

function assertAck(ack: HostCommitAck, operationId: string, ownerEpoch: OwnerEpoch): HostCommitAck {
  if (ack.operationId !== operationId) {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} received ACK for ${ack.operationId}`,
    );
  }
  if (ack.ownerEpoch !== ownerEpoch) {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} received ACK from owner ${ack.ownerEpoch}; expected ${ownerEpoch}`,
    );
  }
  if (!Number.isSafeInteger(ack.treeRevision) || ack.treeRevision < 0) {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} received invalid tree revision ${String(ack.treeRevision)}`,
    );
  }
  return ack;
}

function assertDurabilityReceipt(
  receipt: OwnerVfsDurabilityReceipt,
  operationId: string,
  ownerEpoch: OwnerEpoch,
  treeRevision: TreeRevision,
): OwnerVfsDurabilityReceipt {
  if (receipt.ownerEpoch !== ownerEpoch) {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} received durability from owner ${receipt.ownerEpoch}; expected ${ownerEpoch}`,
    );
  }
  if (!Number.isSafeInteger(receipt.treeRevision) || receipt.treeRevision < treeRevision) {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} durability revision ${String(receipt.treeRevision)} is below ${treeRevision}`,
    );
  }
  if (receipt.durability !== 'durable' && receipt.durability !== 'ephemeral') {
    throw new VfsCommitProtocolError(
      `VFS commit ${operationId} received invalid durability ${String(receipt.durability)}`,
    );
  }
  return receipt;
}

/**
 * Deep page-side host-commit module. It hides operation identity, owner capture,
 * exact reflection, durability ordering, timeouts, and teardown behind one
 * conditional `commit` interface.
 */
export function createVfsCommitCoordinator(
  options: VfsCommitCoordinatorOptions,
): VfsCommitCoordinator {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('VFS commit timeoutMs must be a positive finite number');
  }

  const coordinatorId = createCoordinatorNonce();
  let nextOperationId = 0;
  let closedError: Error | null = null;
  const pending = new Set<PendingCommit>();
  const watchedOwners = new Set<VfsCommitOwner>();
  const durabilityProofHighWater = new Map<OwnerEpoch, TreeRevision>();
  const durabilityFailureHighWater = new Map<OwnerEpoch, DurabilityFailureTarget>();
  let nextDurabilityFailureGeneration = 0;

  const reportProtocolError = (error: Error): void => {
    if (!(error instanceof VfsCommitProtocolError)) return;
    try {
      options.reportProtocolError?.(error);
    } catch {
      // Invariant observation cannot replace the exact commit rejection.
    }
  };

  const publishDurabilityState = (state: VfsCommitDurabilityState): void => {
    try {
      options.onDurabilityState?.(Object.freeze(state));
    } catch {
      // Health observation cannot replace an already-proved commit outcome.
    }
  };

  const recordDurabilityProof = (receipt: OwnerVfsDurabilityReceipt): void => {
    const provedRevision = Math.max(
      durabilityProofHighWater.get(receipt.ownerEpoch) ?? -1,
      receipt.treeRevision,
    );
    durabilityProofHighWater.set(receipt.ownerEpoch, provedRevision);

    const failed = durabilityFailureHighWater.get(receipt.ownerEpoch);
    if (failed === undefined || provedRevision < failed.treeRevision) return;
    durabilityFailureHighWater.delete(receipt.ownerEpoch);
    if (durabilityFailureHighWater.size === 0) {
      publishDurabilityState({ status: 'proved' });
    }
  };

  const recoverFailedDurability = async (): Promise<void> => {
    const targets = [...durabilityFailureHighWater.values()].sort(
      (left, right) => left.generation - right.generation,
    );
    await Promise.all(
      targets.map(async (target) => {
        if (!target.owner.isAlive()) throw new VfsOwnerExitedError(target.ownerEpoch);
        const receipt = await target.owner.durabilityBarrier(target.treeRevision);
        let checked: OwnerVfsDurabilityReceipt;
        try {
          checked = assertDurabilityReceipt(
            receipt,
            target.operationId,
            target.ownerEpoch,
            target.treeRevision,
          );
        } catch (error) {
          const failure = toError(error);
          reportProtocolError(failure);
          throw failure;
        }
        recordDurabilityProof(checked);
      }),
    );
  };

  const recordDurabilityFailure = (
    target: Omit<DurabilityFailureTarget, 'generation'>,
    error: Error,
  ): void => {
    const provedRevision = durabilityProofHighWater.get(target.ownerEpoch) ?? -1;
    if (provedRevision >= target.treeRevision) return;

    const failed = durabilityFailureHighWater.get(target.ownerEpoch);
    if (failed !== undefined && failed.treeRevision >= target.treeRevision) return;
    durabilityFailureHighWater.set(target.ownerEpoch, {
      ...target,
      generation: ++nextDurabilityFailureGeneration,
    });
    publishDurabilityState({ status: 'failed', error, recover: recoverFailedDurability });
  };

  const failOwner = (owner: VfsCommitOwner, reason: unknown): void => {
    watchedOwners.delete(owner);
    const error = new VfsOwnerExitedError(owner.ownerEpoch, reason);
    for (const operation of [...pending]) {
      if (operation.owner === owner) operation.cancel(error);
    }
  };

  const watchOwner = (owner: VfsCommitOwner): void => {
    if (watchedOwners.has(owner)) return;
    watchedOwners.add(owner);
    void owner.closed.then(
      (reason) => failOwner(owner, reason),
      (reason: unknown) => failOwner(owner, reason),
    );
  };

  const coordinator: VfsCommitCoordinator = {
    commit(operation, observation = {}) {
      if (closedError !== null) return Promise.reject(closedError);

      const operationId = `host-vfs:${coordinatorId}:${++nextOperationId}`;
      const request = createRequest(operation, operationId);

      return new Promise<VfsCommitReceipt>((resolve, reject) => {
        let settled = false;
        let sent = false;
        let ack: HostCommitAck | null = null;
        let reflectedRevision = -1;
        let durabilityStarted = false;
        let unsubscribe = (): void => {};
        let timer: ReturnType<typeof setTimeout> | null = null;

        const operationState: PendingCommit = {
          owner: null,
          handedOff: false,
          cancel(error) {
            fail(error);
          },
        };

        const cleanup = (): Error | null => {
          pending.delete(operationState);
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          const release = unsubscribe;
          unsubscribe = (): void => {};
          try {
            release();
            return null;
          } catch (error) {
            return toError(error);
          }
        };

        const appliedError = (error: Error): Error => {
          if (ack === null || hasAppliedEvidence(error)) return error;
          return new VfsCommitAppliedError(ack, error);
        };

        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          reject(appliedError(cleanupError(error, cleanup())));
          reportProtocolError(error);
        };

        const publishDurabilityFailed = (error: Error): void => {
          if (!isCompletedFlushPersistenceFailure(error)) return;
          const applied = ack;
          const owner = operationState.owner;
          if (applied === null || owner === null) return;
          recordDurabilityFailure(
            {
              owner,
              operationId,
              ownerEpoch: applied.ownerEpoch,
              treeRevision: applied.treeRevision,
            },
            error,
          );
        };

        const finish = (receipt: OwnerVfsDurabilityReceipt): void => {
          if (settled || ack === null) return;
          let checked: OwnerVfsDurabilityReceipt;
          try {
            checked = assertDurabilityReceipt(
              receipt,
              operationId,
              ack.ownerEpoch,
              ack.treeRevision,
            );
          } catch (error) {
            fail(toError(error));
            return;
          }
          settled = true;
          recordDurabilityProof(checked);
          const releaseError = cleanup();
          if (releaseError !== null) {
            reject(appliedError(releaseError));
            return;
          }
          resolve({ ...ack, durability: checked.durability });
        };

        const armObservationTimeout = (stage: VfsCommitStage): void => {
          if (timer !== null) clearTimeout(timer);
          const applied = ack;
          if (settled || applied === null) return;
          timer = setTimeout(() => {
            const error = new VfsCommitTimeoutError(applied, stage, options.timeoutMs);
            if (stage === 'durability') publishDurabilityFailed(error);
            fail(error);
          }, options.timeoutMs);
        };

        const crossDurability = (): void => {
          if (
            settled ||
            durabilityStarted ||
            ack === null ||
            reflectedRevision < ack.treeRevision
          ) {
            return;
          }
          durabilityStarted = true;
          armObservationTimeout('durability');
          const owner = operationState.owner;
          if (owner === null) {
            fail(new VfsOwnerExitedError(ack.ownerEpoch));
            return;
          }
          let alive: boolean;
          try {
            alive = owner.isAlive();
          } catch (error) {
            fail(toError(error));
            return;
          }
          if (settled) return;
          if (!alive) {
            fail(new VfsOwnerExitedError(owner.ownerEpoch));
            return;
          }
          let barrier: Promise<OwnerVfsDurabilityReceipt>;
          try {
            barrier = owner.durabilityBarrier(ack.treeRevision);
          } catch (error) {
            const failure = toError(error);
            publishDurabilityFailed(failure);
            fail(failure);
            return;
          }
          void barrier.then(finish, (error: unknown) => {
            if (settled) return;
            const failure = toError(error);
            publishDurabilityFailed(failure);
            fail(failure);
          });
        };

        // The pending claim exists before any injected callback can re-enter.
        pending.add(operationState);

        let owner: VfsCommitOwner;
        try {
          owner = options.captureOwner();
        } catch (error) {
          fail(toError(error));
          return;
        }
        if (settled) return;
        operationState.owner = owner;
        let alive: boolean;
        try {
          alive = owner.isAlive();
        } catch (error) {
          fail(toError(error));
          return;
        }
        if (settled) return;
        if (!alive) {
          fail(new VfsOwnerExitedError(owner.ownerEpoch));
          return;
        }
        watchOwner(owner);

        let releaseSnapshots: () => void;
        try {
          releaseSnapshots = options.subscribeSnapshots((snapshot) => {
            if (settled || !sent || snapshot.ownerEpoch !== owner.ownerEpoch) return;
            if (!Number.isSafeInteger(snapshot.treeRevision) || snapshot.treeRevision < 0) return;
            reflectedRevision = Math.max(reflectedRevision, snapshot.treeRevision);
            crossDurability();
          });
        } catch (error) {
          fail(toError(error));
          return;
        }
        if (settled) {
          releaseSnapshots();
          return;
        }
        unsubscribe = releaseSnapshots;

        sent = true;
        operationState.handedOff = true;
        let applying: Promise<HostCommitAck>;
        try {
          applying = owner.applyHostCommit(request);
        } catch (error) {
          fail(toError(error));
          return;
        }
        void applying.then(
          (candidate) => {
            if (settled) return;
            try {
              ack = assertAck(candidate, operationId, owner.ownerEpoch);
              observation.onApplied?.(
                Object.freeze({ ownerEpoch: ack.ownerEpoch, treeRevision: ack.treeRevision }),
              );
            } catch (error) {
              fail(toError(error));
              return;
            }
            armObservationTimeout('reflection');
            crossDurability();
          },
          (error: unknown) => fail(toError(error)),
        );
      });
    },

    close(error = new VfsCommitCoordinatorClosedError()) {
      if (closedError !== null) return;
      closedError = error;
      for (const operation of [...pending]) {
        if (!operation.handedOff) operation.cancel(error);
      }
    },
  };

  return coordinator;
}
