interface PreviewAdvertisementBase {
  readonly ownerToken: string;
  readonly port: number;
  readonly url: string;
  readonly source: 'dev-server' | 'preview' | 'node';
  readonly sid: string;
  readonly previewScope?: string;
}

export type PreviewAdvertisement = PreviewAdvertisementBase &
  (
    | { readonly ptySid: string; readonly ptyRid: string }
    | { readonly ptySid?: never; readonly ptyRid?: never }
  );

export interface PreviewHandle {
  readonly ownerToken: string;
  readonly port: number;
  readonly url: string;
}

export class PreviewReadinessClosedError extends Error {
  constructor() {
    super('Preview readiness is closed');
    this.name = 'PreviewReadinessClosedError';
  }
}

export class PreviewReadinessBusyError extends Error {
  constructor() {
    super('Preview readiness already has a pending wait');
    this.name = 'PreviewReadinessBusyError';
  }
}

export interface PreviewReadinessDependencies {
  readonly timeoutMs: number;
  subscribe(listener: (entries: readonly PreviewAdvertisement[]) => void): () => void;
  requestSnapshot(): void;
  mountRoute(entry: PreviewAdvertisement): () => void;
  proveServiceWorkerControl(signal: AbortSignal): Promise<void>;
  probe(
    url: string,
    signal: AbortSignal,
  ): Promise<{ readonly ok: boolean; readonly status: number }>;
}

export interface PreviewReadiness {
  waitFor(options: {
    readonly ownerToken: string;
    readonly ptySid: string;
    readonly ptyRid: string;
    readonly matches: (entry: PreviewAdvertisement) => boolean;
  }): Promise<PreviewHandle>;
  close(): Promise<void>;
}

export function createPreviewReadiness(
  dependencies: PreviewReadinessDependencies,
): PreviewReadiness {
  if (!Number.isFinite(dependencies.timeoutMs) || dependencies.timeoutMs <= 0) {
    throw new RangeError('Preview readiness timeout must be a positive finite number');
  }

  type Wait = {
    readonly ownerToken: string;
    readonly ptySid: string;
    readonly ptyRid: string;
    readonly matches: (entry: PreviewAdvertisement) => boolean;
    readonly promise: Promise<PreviewHandle>;
    readonly resolve: (handle: PreviewHandle) => void;
    readonly reject: (error: Error) => void;
    settled: boolean;
  };
  type Attempt = {
    readonly key: string;
    readonly entry: PreviewAdvertisement;
    readonly abort: AbortController;
    readonly tearDown: () => void;
  };

  let closed = false;
  let closePromise: Promise<void> | null = null;
  let wait: Wait | null = null;
  let attempt: Attempt | null = null;
  let unsubscribe: (() => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let reconciling = false;
  let subscribing = false;
  let queuedEntries: readonly PreviewAdvertisement[] | null = null;
  let closeResolve: (() => void) | null = null;
  let closeReject: ((reason?: unknown) => void) | null = null;
  let closeFinished = false;

  const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const keyOf = (entry: PreviewAdvertisement): string =>
    JSON.stringify([
      entry.ownerToken,
      entry.port,
      entry.url,
      entry.source,
      entry.sid,
      entry.previewScope ?? null,
      entry.ptySid ?? null,
      entry.ptyRid ?? null,
    ]);

  const clearTimeoutIfNeeded = (): void => {
    if (timeout === null) return;
    clearTimeout(timeout);
    timeout = null;
  };

  const detachSubscription = (): Error | null => {
    const detach = unsubscribe;
    unsubscribe = null;
    if (detach === null) return null;
    try {
      detach();
      return null;
    } catch (error) {
      return asError(error);
    }
  };

  const releaseAttempt = (reason: Error): Error | null => {
    const current = attempt;
    attempt = null;
    if (current === null) return null;
    current.abort.abort(reason);
    try {
      current.tearDown();
      return null;
    } catch (error) {
      return asError(error);
    }
  };

  const finishClose = (): void => {
    if (!closed || closeFinished || reconciling || subscribing) return;
    closeFinished = true;
    const error = new PreviewReadinessClosedError();
    const releaseError = releaseAttempt(error);
    const subscriptionError = detachSubscription();
    const errors = [releaseError, subscriptionError].filter(
      (candidate): candidate is Error => candidate !== null,
    );
    if (errors.length === 0) closeResolve?.();
    else {
      closeReject?.(
        new AggregateError(
          errors,
          `Preview readiness close failed: ${errors.map((candidate) => candidate.message).join('; ')}`,
        ),
      );
    }
  };

  const fail = (error: Error): void => {
    const pending = wait;
    if (pending === null || pending.settled) return;
    pending.settled = true;
    clearTimeoutIfNeeded();
    const releaseError = releaseAttempt(error);
    const subscriptionError = detachSubscription();
    const errors = [error, releaseError, subscriptionError].filter(
      (candidate): candidate is Error => candidate !== null,
    );
    const firstError = errors[0];
    pending.reject(
      errors.length === 1 && firstError !== undefined
        ? firstError
        : new AggregateError(errors, errors.map((candidate) => candidate.message).join('; ')),
    );
  };

  const candidateFor = (
    entries: readonly PreviewAdvertisement[],
    pending: Wait,
  ): PreviewAdvertisement | null => {
    for (const entry of entries) {
      if (entry.ownerToken !== pending.ownerToken) continue;
      if (entry.ptySid !== pending.ptySid || entry.ptyRid !== pending.ptyRid) continue;
      if (pending.matches(entry)) return entry;
    }
    return null;
  };

  const beginAttempt = (entry: PreviewAdvertisement, pending: Wait): void => {
    const abort = new AbortController();
    let tearDown: () => void;
    try {
      tearDown = dependencies.mountRoute(entry);
    } catch (error) {
      fail(asError(error));
      return;
    }
    const current: Attempt = { key: keyOf(entry), entry, abort, tearDown };
    attempt = current;
    if (pending.settled || closed || wait !== pending) return;

    void (async () => {
      try {
        await dependencies.proveServiceWorkerControl(abort.signal);
        if (attempt !== current || pending.settled || closed) return;
        const response = await dependencies.probe(entry.url, abort.signal);
        if (attempt !== current || pending.settled || closed) return;
        if (!response.ok) {
          throw new Error(`Preview readiness routed proof failed with HTTP ${response.status}`);
        }
        pending.settled = true;
        clearTimeoutIfNeeded();
        pending.resolve({ ownerToken: entry.ownerToken, port: entry.port, url: entry.url });
      } catch (error) {
        if (attempt !== current || abort.signal.aborted || pending.settled || closed) return;
        fail(asError(error));
      }
    })();
  };

  const reconcileOnce = (entries: readonly PreviewAdvertisement[]): void => {
    const pending = wait;
    if (pending === null || pending.settled || closed) return;
    let candidate: PreviewAdvertisement | null;
    try {
      candidate = candidateFor(entries, pending);
    } catch (error) {
      fail(asError(error));
      return;
    }
    if (pending.settled || closed || wait !== pending) return;
    if (candidate === null) {
      if (attempt !== null) {
        const releaseError = releaseAttempt(new Error('Preview advertisement was revoked'));
        if (releaseError !== null) fail(releaseError);
      }
      return;
    }
    const key = keyOf(candidate);
    if (attempt?.key === key) return;
    if (attempt !== null) {
      const releaseError = releaseAttempt(new Error('Preview advertisement was replaced'));
      if (releaseError !== null) {
        fail(releaseError);
        return;
      }
    }
    if (pending.settled || closed || wait !== pending) return;
    beginAttempt(candidate, pending);
  };

  const reconcile = (entries: readonly PreviewAdvertisement[]): void => {
    queuedEntries = entries;
    if (reconciling) return;
    reconciling = true;
    try {
      while (queuedEntries !== null) {
        const next = queuedEntries;
        queuedEntries = null;
        reconcileOnce(next);
        if (closed || wait?.settled === true) queuedEntries = null;
      }
    } catch (error) {
      queuedEntries = null;
      fail(asError(error));
    } finally {
      reconciling = false;
      finishClose();
    }
  };

  return {
    waitFor(options) {
      if (closed) return Promise.reject(new PreviewReadinessClosedError());
      if (wait !== null) return Promise.reject(new PreviewReadinessBusyError());

      let resolve!: (handle: PreviewHandle) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<PreviewHandle>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      void promise.catch(() => {});
      const pending: Wait = {
        ownerToken: options.ownerToken,
        ptySid: options.ptySid,
        ptyRid: options.ptyRid,
        matches: options.matches,
        promise,
        resolve,
        reject,
        settled: false,
      };
      wait = pending;
      timeout = setTimeout(
        () => fail(new Error(`Preview readiness timed out after ${dependencies.timeoutMs}ms`)),
        dependencies.timeoutMs,
      );
      let attaching = true;
      let synchronousEntries: readonly PreviewAdvertisement[] | null = null;
      const listener = (entries: readonly PreviewAdvertisement[]): void => {
        if (attaching) {
          synchronousEntries = entries;
          return;
        }
        reconcile(entries);
      };
      subscribing = true;
      try {
        unsubscribe = dependencies.subscribe(listener);
        subscribing = false;
        attaching = false;
        if (synchronousEntries !== null) reconcile(synchronousEntries);
        if (!pending.settled && !closed) dependencies.requestSnapshot();
      } catch (error) {
        subscribing = false;
        attaching = false;
        fail(asError(error));
      } finally {
        finishClose();
      }
      return promise;
    },

    close() {
      if (closePromise !== null) return closePromise;
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      closePromise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      closeResolve = resolve;
      closeReject = reject;
      void closePromise.catch(() => {});
      closed = true;
      const error = new PreviewReadinessClosedError();
      const pending = wait;
      if (pending !== null && !pending.settled) {
        pending.settled = true;
        pending.reject(error);
      }
      clearTimeoutIfNeeded();
      finishClose();
      return closePromise;
    },
  };
}
