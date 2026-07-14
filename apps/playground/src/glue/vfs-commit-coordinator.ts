import type {
  HostCommitAck,
  HostCommitOperation,
  HostCommitRequest,
  OwnerEpoch,
  OwnerVfsDurabilityReceipt,
  OwnerVfsRevisionFrame,
  TreeRevision,
} from './owner-vfs-protocol.ts';

export type VfsCommitStage = 'reflection' | 'durability';

export class VfsCommitProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfsCommitProtocolError';
  }
}

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
}

export interface VfsCommitReceipt extends HostCommitAck {
  readonly durability: OwnerVfsDurabilityReceipt['durability'];
}

export interface VfsCommitCoordinator {
  /** Claims an operation id and invokes owner transport before returning. */
  commit(operation: HostCommitOperation): Promise<VfsCommitReceipt>;
  /** Rejects all pending and future commits. Idempotent. */
  close(error?: Error): void;
}

interface PendingCommit {
  owner: VfsCommitOwner | null;
  handedOff: boolean;
  cancel(error: Error): void;
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
    commit(operation) {
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

        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          reject(cleanupError(error, cleanup()));
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
          const releaseError = cleanup();
          if (releaseError !== null) {
            reject(releaseError);
            return;
          }
          resolve({ ...ack, durability: checked.durability });
        };

        const armObservationTimeout = (stage: VfsCommitStage): void => {
          if (timer !== null) clearTimeout(timer);
          const applied = ack;
          if (settled || applied === null) return;
          timer = setTimeout(
            () => fail(new VfsCommitTimeoutError(applied, stage, options.timeoutMs)),
            options.timeoutMs,
          );
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
            fail(toError(error));
            return;
          }
          void barrier.then(finish, (error: unknown) => fail(toError(error)));
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
