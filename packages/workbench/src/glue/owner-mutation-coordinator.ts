import { type OwnerWritePort, commitOwnerWrites } from './owner-write-barrier.ts';

interface PendingMutation {
  cancel(error: Error): void;
}

export interface OwnerMutationCoordinatorOptions<Frame, Owner extends OwnerWritePort<Frame>> {
  readonly currentOwner: () => Owner;
  readonly subscribeSnapshot: (listener: () => void) => () => void;
  readonly timeoutMs: number;
  /** Prefix retained in timeout diagnostics at the consuming seam. */
  readonly label: string;
}

export interface OwnerMutationCoordinator<Frame> {
  /**
   * Send now; resolve only after apply ack, durability flush, and a matching
   * snapshot published after the send began.
   */
  mutate(frame: Frame, reflected: () => boolean): Promise<void>;
  /** Reject every pending mutation and reject all future mutations. */
  dispose(error: Error): void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function withCleanupFailure(primary: Error, cleanup: Error | null): Error {
  return cleanup === null ? primary : new AggregateError([primary, cleanup], primary.message);
}

export function createOwnerMutationCoordinator<Frame, Owner extends OwnerWritePort<Frame>>(
  options: OwnerMutationCoordinatorOptions<Frame, Owner>,
): OwnerMutationCoordinator<Frame> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`${options.label} timeoutMs must be a positive finite number`);
  }

  let disposed = false;
  let disposeError: Error | null = null;
  const pending = new Set<PendingMutation>();

  return {
    mutate(frame, reflected) {
      if (disposed) {
        return Promise.reject(disposeError ?? new Error(`${options.label} disposed`));
      }

      let owner: Owner;
      try {
        // Owner lookup happens before the snapshot subscription. A publish
        // caused by lookup is pre-send state and must never satisfy reflection.
        owner = options.currentOwner();
      } catch (error) {
        return Promise.reject(asError(error));
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let sent = false;
        let acked = false;
        let flushed = false;
        let publishedAfterSend = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe = (): void => {};

        const cleanup = (): Error | null => {
          pending.delete(operation);
          if (timer !== null) clearTimeout(timer);
          const release = unsubscribe;
          unsubscribe = (): void => {};
          try {
            release();
            return null;
          } catch (error) {
            return asError(error);
          }
        };
        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          reject(withCleanupFailure(error, cleanup()));
        };
        const finish = (): void => {
          if (settled || !acked || !flushed || !publishedAfterSend) return;
          let matches: boolean;
          try {
            matches = reflected();
          } catch (error) {
            fail(asError(error));
            return;
          }
          if (!matches) return;
          settled = true;
          const cleanupError = cleanup();
          if (cleanupError === null) resolve();
          else reject(cleanupError);
        };
        const operation: PendingMutation = { cancel: fail };

        try {
          unsubscribe = options.subscribeSnapshot(() => {
            if (!sent) return;
            publishedAfterSend = true;
            finish();
          });
        } catch (error) {
          fail(asError(error));
          return;
        }

        pending.add(operation);
        timer = setTimeout(() => {
          fail(
            new Error(
              `${options.label} did not ${!acked ? 'ack' : !flushed ? 'flush' : 'reflect'} within ${options.timeoutMs}ms`,
            ),
          );
        }, options.timeoutMs);

        sent = true;
        const commit = commitOwnerWrites(() => owner, [frame]);
        void commit.applied.then(
          () => {
            acked = true;
            finish();
          },
          (error: unknown) => fail(asError(error)),
        );
        void commit.durable.then(
          () => {
            flushed = true;
            finish();
          },
          (error: unknown) => fail(asError(error)),
        );
      });
    },
    dispose(error) {
      if (disposed) return;
      disposed = true;
      disposeError = error;
      for (const operation of [...pending]) operation.cancel(error);
      pending.clear();
    },
  };
}
