/**
 * Page→owner request settlement policy. Reads may expire; a posted mutation
 * cannot be cancelled, so it stays pending until reply, send failure, or the
 * owner's certified exit. Disposing drains admitted mutations before closing.
 */

export type OwnerRequestKind = 'read' | 'mutation';

interface PendingRequest<Result> {
  readonly kind: OwnerRequestKind;
  readonly resolve: (result: Result) => void;
  readonly reject: (error: Error) => void;
  readonly timer?: ReturnType<typeof setTimeout>;
}

export interface OwnerRequestSettlementOptions {
  readonly readTimeout?: {
    readonly ms: number;
    readonly error: (requestId: string) => Error;
  };
  readonly ownerClosed?: Promise<unknown>;
  readonly ownerClosedError?: (cause: unknown) => Error;
  readonly onDrained: () => void;
}

export interface OwnerRequestSettlements<Result> {
  wait(requestId: string, kind: OwnerRequestKind): Promise<Result>;
  request(requestId: string, kind: OwnerRequestKind, send: () => void): Promise<Result>;
  resolve(requestId: string, result: Result): boolean;
  reject(requestId: string, error: Error): boolean;
  /** Stop new work; reads reject now, admitted mutations keep their reply path. */
  dispose(error: Error): void;
  /** Certified owner exit is a terminal outcome for every admitted request. */
  ownerExited(error: Error): void;
}

interface OwnerExitFanout {
  readonly listeners: Set<(cause: unknown) => void>;
  settled: boolean;
  cause: unknown;
}

const ownerExitFanouts = new WeakMap<Promise<unknown>, OwnerExitFanout>();

function subscribeOwnerExit(
  ownerClosed: Promise<unknown>,
  listener: (cause: unknown) => void,
): () => void {
  let fanout = ownerExitFanouts.get(ownerClosed);
  if (!fanout) {
    fanout = { listeners: new Set(), settled: false, cause: undefined };
    ownerExitFanouts.set(ownerClosed, fanout);
    const publish = (cause: unknown): void => {
      if (fanout?.settled) return;
      if (!fanout) return;
      fanout.settled = true;
      fanout.cause = cause;
      const listeners = [...fanout.listeners];
      fanout.listeners.clear();
      for (const notify of listeners) notify(cause);
    };
    void ownerClosed.then(
      () => publish(undefined),
      (cause: unknown) => publish(cause),
    );
  }
  if (fanout.settled) {
    let subscribed = true;
    queueMicrotask(() => {
      if (subscribed) listener(fanout?.cause);
    });
    return () => {
      subscribed = false;
    };
  }
  fanout.listeners.add(listener);
  return () => fanout?.listeners.delete(listener);
}

function errorFromUnknown(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

export function createOwnerRequestSettlements<Result>(
  options: OwnerRequestSettlementOptions,
): OwnerRequestSettlements<Result> {
  if (
    options.readTimeout &&
    (!Number.isFinite(options.readTimeout.ms) || options.readTimeout.ms <= 0)
  ) {
    throw new RangeError('owner request read timeout must be a positive finite number');
  }

  const pending = new Map<string, PendingRequest<Result>>();
  let accepting = true;
  let stoppedError = new Error('owner request bridge disposed');
  let drained = false;
  let unsubscribeOwnerExit: () => void = () => {};

  const maybeDrain = (): void => {
    if (accepting || pending.size !== 0 || drained) return;
    drained = true;
    unsubscribeOwnerExit();
    options.onDrained();
  };

  const settle = (
    requestId: string,
    complete: (request: PendingRequest<Result>) => void,
  ): boolean => {
    const request = pending.get(requestId);
    if (!request) return false;
    pending.delete(requestId);
    if (request.timer !== undefined) clearTimeout(request.timer);
    complete(request);
    maybeDrain();
    return true;
  };

  const api: OwnerRequestSettlements<Result> = {
    wait(requestId, kind) {
      if (!accepting) return Promise.reject(stoppedError);
      if (pending.has(requestId)) {
        return Promise.reject(new Error(`duplicate owner request id ${requestId}`));
      }
      const readTimeout = kind === 'read' ? options.readTimeout : undefined;
      if (kind === 'read' && !readTimeout) {
        return Promise.reject(new Error('owner read request has no timeout policy'));
      }
      return new Promise<Result>((resolve, reject) => {
        const timer = readTimeout
          ? setTimeout(() => {
              api.reject(requestId, readTimeout.error(requestId));
            }, readTimeout.ms)
          : undefined;
        pending.set(requestId, { kind, resolve, reject, timer });
      });
    },
    request(requestId, kind, send) {
      const canSend =
        accepting && !pending.has(requestId) && (kind === 'mutation' || !!options.readTimeout);
      const promise = api.wait(requestId, kind);
      if (!canSend) return promise;
      try {
        send();
      } catch (cause) {
        api.reject(requestId, errorFromUnknown(cause, `owner request send failed (${requestId})`));
      }
      return promise;
    },
    resolve(requestId, result) {
      return settle(requestId, (request) => request.resolve(result));
    },
    reject(requestId, error) {
      return settle(requestId, (request) => request.reject(error));
    },
    dispose(error) {
      if (accepting) {
        accepting = false;
        stoppedError = error;
      }
      for (const [requestId, request] of [...pending]) {
        if (request.kind === 'read') api.reject(requestId, error);
      }
      maybeDrain();
    },
    ownerExited(error) {
      accepting = false;
      stoppedError = error;
      for (const requestId of [...pending.keys()]) api.reject(requestId, error);
      maybeDrain();
    },
  };

  if (options.ownerClosed) {
    unsubscribeOwnerExit = subscribeOwnerExit(options.ownerClosed, (cause) => {
      api.ownerExited(
        options.ownerClosedError?.(cause) ?? errorFromUnknown(cause, 'workspace owner exited'),
      );
    });
  }

  return api;
}
