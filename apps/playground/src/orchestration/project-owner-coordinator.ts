import { createSignal } from 'solid-js';

export interface ProjectOwnerLease {
  /** Permanently reject this and every later operation after an unsafe outcome. */
  readonly fence: (error: unknown) => never;
}

export type ProjectOwnerRunOutcome<T> =
  | { readonly kind: 'completed'; readonly value: T }
  | { readonly kind: 'superseded' };

export interface ProjectOwnerCoordinator {
  /** True while an owner operation is active/queued, or after a terminal fence. */
  readonly blocked: () => boolean;
  /**
   * FIFO admission for every owner-bound mutation and replacement. The intent
   * check runs at the queue head, immediately before the operation can bind.
   */
  readonly run: <T>(
    intentCurrent: () => boolean,
    operation: (lease: ProjectOwnerLease) => T | Promise<T>,
  ) => Promise<ProjectOwnerRunOutcome<T>>;
}

function asFenceError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(`Project owner coordinator fenced: ${String(error)}`);
}

export function createProjectOwnerCoordinator(): ProjectOwnerCoordinator {
  let fenceError: Error | null = null;
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();
  const [blocked, setBlocked] = createSignal(false);

  const admit = (): void => {
    pending++;
    setBlocked(true);
  };
  const release = (): void => {
    pending--;
    if (pending === 0 && !fenceError) setBlocked(false);
  };

  return {
    blocked,
    run<T>(intentCurrent: () => boolean, operation: (lease: ProjectOwnerLease) => T | Promise<T>) {
      admit();
      const ticket = tail.then(async (): Promise<ProjectOwnerRunOutcome<T>> => {
        if (fenceError) throw fenceError;
        if (!intentCurrent()) return { kind: 'superseded' };

        const lease: ProjectOwnerLease = {
          fence(error): never {
            fenceError ??= asFenceError(error);
            setBlocked(true);
            throw fenceError;
          },
        };

        try {
          const value = await operation(lease);
          if (fenceError) throw fenceError;
          return { kind: 'completed', value };
        } catch (error: unknown) {
          if (fenceError) throw fenceError;
          throw error;
        }
      });

      // Ordinary failure belongs to this ticket's caller; the FIFO stays live.
      tail = ticket.then(
        () => {},
        () => {},
      );
      return ticket.finally(release);
    },
  };
}
