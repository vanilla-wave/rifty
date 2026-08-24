export type PtyTimerHandle = ReturnType<typeof setTimeout>;

export type AckDeadline = { deadline?: PtyTimerHandle };

export interface PendingPromise<T> extends AckDeadline {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

interface PtyTimers {
  setTimeout(callback: () => void, delayMs: number): PtyTimerHandle;
  clearTimeout(handle: PtyTimerHandle): void;
}

class PtyAckTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Owner did not acknowledge ${operation} within ${timeoutMs}ms`);
    this.name = 'PtyAckTimeoutError';
  }
}

export function deferred<T>(): PendingPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createPtyPendingAuthority(timeoutMs: number, timers: PtyTimers) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`PTY ACK timeout must be a positive safe integer; received ${timeoutMs}`);
  }

  function disarmDeadline(pending: AckDeadline): void {
    const deadline = pending.deadline;
    if (deadline === undefined) return;
    pending.deadline = undefined;
    timers.clearTimeout(deadline);
  }

  return Object.freeze({
    armDeadline(pending: AckDeadline, operation: string, expire: (error: Error) => void): void {
      const deadline = timers.setTimeout(() => {
        if (pending.deadline !== deadline) return;
        pending.deadline = undefined;
        expire(new PtyAckTimeoutError(operation, timeoutMs));
      }, timeoutMs);
      pending.deadline = deadline;
    },
    disarmDeadline,
    rejectPending(
      pending: AckDeadline & { readonly reject: (error: Error) => void },
      error: Error,
    ): void {
      disarmDeadline(pending);
      pending.reject(error);
    },
    resolvePending(pending: AckDeadline & { readonly resolve: () => void }): void {
      disarmDeadline(pending);
      pending.resolve();
    },
  });
}
