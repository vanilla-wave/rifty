import { ClosedHandleError } from '../errors.ts';
import type { PreviewAdvertisement } from '../preview-readiness.ts';

export interface BrowserPlaygroundPreview {
  readonly port: number;
  readonly url: string;
  readonly label: string;
  readonly source: 'dev-server' | 'preview' | 'node';
}

export interface BrowserPlaygroundPreviewRegistry {
  snapshot(): readonly BrowserPlaygroundPreview[];
  subscribe(listener: (snapshot: readonly BrowserPlaygroundPreview[]) => void): () => void;
}

export interface BrowserPlaygroundPreviewAuthorityDependencies {
  readonly subscribe: (listener: (snapshot: readonly PreviewAdvertisement[]) => void) => () => void;
  readonly requestSnapshot: () => void;
  readonly mountRoute: (entry: PreviewAdvertisement) => () => void;
  readonly proveServiceWorkerControl: (signal: AbortSignal) => Promise<void>;
  readonly onDegraded: (error: Error) => void;
  readonly onHealthy: () => void;
  readonly onInvariant: (error: Error) => void;
}

export interface BrowserPlaygroundPreviewAuthority {
  readonly registry: BrowserPlaygroundPreviewRegistry;
  subscribeRouted(listener: (snapshot: readonly PreviewAdvertisement[]) => void): () => void;
  requestSnapshot(): void;
  recover(): Promise<void>;
  close(): Promise<void>;
}

interface MountedRoute {
  readonly entry: PreviewAdvertisement;
  readonly key: string;
  readonly tearDown: () => void;
}

interface PreviewGeneration {
  readonly snapshot: readonly PreviewAdvertisement[];
  readonly abort: AbortController;
}

type AuthorityState = 'live' | 'closing' | 'closed' | 'failed';

class PreviewInvariantFailure extends Error {
  readonly invariant: Error;

  constructor(invariant: Error) {
    super(invariant.message);
    this.name = 'PreviewInvariantFailure';
    this.invariant = invariant;
  }
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function routeKey(entry: PreviewAdvertisement): string {
  return JSON.stringify([
    entry.ownerToken,
    entry.port,
    entry.url,
    entry.label,
    entry.source,
    entry.sid,
    entry.previewScope ?? null,
    entry.ptySid ?? null,
    entry.ptyRid ?? null,
  ]);
}

function sameEntries(
  left: readonly PreviewAdvertisement[],
  right: readonly PreviewAdvertisement[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => routeKey(entry) === routeKey(right[index] as PreviewAdvertisement))
  );
}

function semanticEntry(entry: PreviewAdvertisement): BrowserPlaygroundPreview {
  return Object.freeze({
    port: entry.port,
    url: entry.url,
    label: entry.label,
    source: entry.source,
  });
}

function aggregate(errors: readonly Error[], message: string): Error {
  if (errors.length === 1) return errors[0] as Error;
  return new AggregateError(errors, message);
}

/** One page-side route authority; semantic entries exist only after routed control proof. */
export function createBrowserPlaygroundPreviewAuthority(
  dependencies: BrowserPlaygroundPreviewAuthorityDependencies,
): BrowserPlaygroundPreviewAuthority {
  const publicListeners = new Set<(snapshot: readonly BrowserPlaygroundPreview[]) => void>();
  const routedListeners = new Set<(snapshot: readonly PreviewAdvertisement[]) => void>();
  const mounted = new Map<number, MountedRoute>();
  let state: AuthorityState = 'live';
  let failure: Error | null = null;
  let degradation: Error | null = null;
  let routedSnapshot: readonly PreviewAdvertisement[] = Object.freeze([]);
  let publicSnapshot: readonly BrowserPlaygroundPreview[] = Object.freeze([]);
  let latestGeneration: PreviewGeneration = {
    snapshot: Object.freeze([]),
    abort: new AbortController(),
  };
  let operationTail: Promise<void> = Promise.resolve();
  let recoveryPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;

  const assertLive = (): void => {
    if (failure !== null) throw failure;
    if (state !== 'live') throw new ClosedHandleError('Playground preview registry');
  };

  const publishPublic = (snapshot: readonly BrowserPlaygroundPreview[]): void => {
    publicSnapshot = snapshot;
    for (const listener of [...publicListeners]) {
      try {
        listener(snapshot);
      } catch {
        // A page observer cannot invalidate already-routed owner state.
      }
    }
  };

  const publishRouted = (snapshot: readonly PreviewAdvertisement[]): void => {
    routedSnapshot = snapshot;
    for (const listener of [...routedListeners]) {
      try {
        listener(snapshot);
      } catch {
        // A route observer cannot invalidate already-routed owner state.
      }
    }
  };

  const withdrawPorts = (ports: ReadonlySet<number>): void => {
    if (ports.size === 0) return;
    const nextRouted = Object.freeze(routedSnapshot.filter((entry) => !ports.has(entry.port)));
    if (sameEntries(routedSnapshot, nextRouted)) return;
    publishRouted(nextRouted);
    publishPublic(Object.freeze(nextRouted.map(semanticEntry)));
  };

  const tearDownPorts = (ports: readonly number[]): Error[] => {
    const errors: Error[] = [];
    for (const port of ports) {
      const route = mounted.get(port);
      if (route === undefined) continue;
      mounted.delete(port);
      try {
        route.tearDown();
      } catch (error) {
        errors.push(errorFrom(error));
      }
    }
    return errors;
  };

  const mountedMatches = (snapshot: readonly PreviewAdvertisement[]): boolean =>
    mounted.size === snapshot.length &&
    snapshot.every((entry) => mounted.get(entry.port)?.key === routeKey(entry));

  const abortGeneration = (generation: PreviewGeneration, reason: Error): void => {
    if (generation.abort.signal.aborted) return;
    generation.abort.abort(reason);
  };

  const proveServiceWorkerControl = async (abort: AbortController): Promise<void> => {
    const { signal } = abort;
    let detachAbort = (): void => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => {
        reject(errorFrom(signal.reason ?? new Error('Preview route proof aborted')));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      detachAbort = () => signal.removeEventListener('abort', onAbort);
    });
    try {
      await Promise.race([dependencies.proveServiceWorkerControl(signal), aborted]);
    } finally {
      detachAbort();
    }
  };

  let unsubscribeRaw = (): void => {};

  const notifyDegraded = (error: Error): void => {
    try {
      dependencies.onDegraded(error);
    } catch {
      // Health observers cannot change preview authority state.
    }
  };

  const notifyHealthy = (): void => {
    try {
      dependencies.onHealthy();
    } catch {
      // Health observers cannot change preview authority state.
    }
  };

  const notifyInvariant = (error: Error): void => {
    try {
      dependencies.onInvariant(error);
    } catch {
      // Fatal observers cannot replace the first invariant failure.
    }
  };

  const failInvariant = (reason: unknown): Error => {
    if (failure !== null) return failure;
    if (state === 'closed') return new ClosedHandleError('Playground preview registry');
    state = 'failed';
    const primary = errorFrom(reason);
    const errors = [primary];
    abortGeneration(latestGeneration, primary);
    if (publicSnapshot.length > 0 || routedSnapshot.length > 0) {
      publishRouted(Object.freeze([]));
      publishPublic(Object.freeze([]));
    }
    errors.push(...tearDownPorts([...mounted.keys()]));
    try {
      unsubscribeRaw();
    } catch (error) {
      errors.push(errorFrom(error));
    }
    publicListeners.clear();
    routedListeners.clear();
    failure = aggregate(errors, 'Playground preview route authority failed');
    notifyInvariant(failure);
    return failure;
  };

  const degrade = (reason: unknown): Error => {
    const primary = errorFrom(reason);
    if (state !== 'live') return primary;
    abortGeneration(latestGeneration, primary);
    if (publicSnapshot.length > 0 || routedSnapshot.length > 0) {
      publishRouted(Object.freeze([]));
      publishPublic(Object.freeze([]));
    }
    degradation = aggregate(
      [primary, ...tearDownPorts([...mounted.keys()])],
      'Playground preview route reconciliation degraded',
    );
    notifyDegraded(degradation);
    return degradation;
  };

  const markHealthy = (): void => {
    if (degradation === null) return;
    degradation = null;
    notifyHealthy();
  };

  const reconcile = async (generation: PreviewGeneration): Promise<void> => {
    if (state !== 'live') return;
    const { snapshot: next } = generation;
    const seenPorts = new Set<number>();
    for (const entry of next) {
      if (seenPorts.has(entry.port)) {
        throw new PreviewInvariantFailure(
          new TypeError(`Owner preview snapshot repeats port ${String(entry.port)}`),
        );
      }
      seenPorts.add(entry.port);
    }
    if (generation !== latestGeneration) return;
    if (sameEntries(routedSnapshot, next) && mountedMatches(next)) {
      markHealthy();
      return;
    }

    const nextByPort = new Map(next.map((entry) => [entry.port, entry] as const));
    const withdrawn = new Set<number>();
    for (const [port, current] of mounted) {
      const replacement = nextByPort.get(port);
      if (replacement === undefined || routeKey(replacement) !== current.key) {
        withdrawn.add(port);
      }
    }
    withdrawPorts(withdrawn);
    if (state !== 'live' || generation !== latestGeneration) return;

    const tearDownErrors = tearDownPorts([...withdrawn]);
    if (tearDownErrors.length > 0) {
      throw aggregate(tearDownErrors, 'Playground preview route teardown failed');
    }
    if (state !== 'live' || generation !== latestGeneration) return;

    let routesChanged = withdrawn.size > 0;
    for (const candidate of next) {
      if (state !== 'live' || generation !== latestGeneration) return;
      const existing = mounted.get(candidate.port);
      const key = routeKey(candidate);
      if (existing?.key === key) continue;
      const tearDown = dependencies.mountRoute(candidate);
      if (typeof tearDown !== 'function') {
        throw new PreviewInvariantFailure(
          new TypeError('Playground preview route mount omitted teardown'),
        );
      }
      mounted.set(candidate.port, { entry: candidate, key, tearDown });
      routesChanged = true;
    }

    if (state !== 'live' || generation !== latestGeneration) return;
    if (routesChanged || !sameEntries(routedSnapshot, next)) {
      try {
        await proveServiceWorkerControl(generation.abort);
      } catch (error) {
        if (
          generation.abort.signal.aborted &&
          (state !== 'live' || generation !== latestGeneration)
        ) {
          return;
        }
        throw error;
      }
    }
    if (state !== 'live' || generation !== latestGeneration) return;
    const admitted = Object.freeze([...next]);
    if (sameEntries(routedSnapshot, admitted)) return;
    publishRouted(admitted);
    publishPublic(Object.freeze(admitted.map(semanticEntry)));
    markHealthy();
  };

  const scheduleReconcile = (generation: PreviewGeneration): Promise<void> => {
    const operation = operationTail.then(() => reconcile(generation));
    const reported = operation.catch((error: unknown) => {
      if (error instanceof PreviewInvariantFailure) {
        throw failInvariant(error.invariant);
      }
      throw degrade(error);
    });
    operationTail = reported.catch(() => {});
    void reported.catch(() => {});
    return reported;
  };

  const replaceGeneration = (
    snapshot: readonly PreviewAdvertisement[],
    reason: Error,
  ): PreviewGeneration => {
    abortGeneration(latestGeneration, reason);
    const generation: PreviewGeneration = {
      snapshot: Object.freeze([...snapshot]),
      abort: new AbortController(),
    };
    latestGeneration = generation;
    return generation;
  };

  const admitRaw = (snapshot: readonly PreviewAdvertisement[]): void => {
    if (state !== 'live') return;
    const owned = Object.freeze([...snapshot]);
    if (sameEntries(latestGeneration.snapshot, owned)) return;
    const generation = replaceGeneration(
      owned,
      new Error('Owner preview snapshot superseded pending route proof'),
    );
    void scheduleReconcile(generation);
  };

  try {
    unsubscribeRaw = dependencies.subscribe(admitRaw);
    dependencies.requestSnapshot();
  } catch (error) {
    failInvariant(error);
  }

  const registry: BrowserPlaygroundPreviewRegistry = Object.freeze({
    snapshot() {
      assertLive();
      return publicSnapshot;
    },
    subscribe(listener: (snapshot: readonly BrowserPlaygroundPreview[]) => void) {
      assertLive();
      if (typeof listener !== 'function')
        throw new TypeError('Preview listener must be a function');
      publicListeners.add(listener);
      try {
        listener(publicSnapshot);
      } catch {
        // Replay follows the same observer isolation as committed updates.
      }
      return () => publicListeners.delete(listener);
    },
  });

  return Object.freeze({
    registry,
    subscribeRouted(listener: (snapshot: readonly PreviewAdvertisement[]) => void) {
      assertLive();
      if (typeof listener !== 'function') {
        throw new TypeError('Routed preview listener must be a function');
      }
      routedListeners.add(listener);
      try {
        listener(routedSnapshot);
      } catch {
        // Replay follows the same observer isolation as committed updates.
      }
      return () => routedListeners.delete(listener);
    },
    requestSnapshot() {
      assertLive();
      dependencies.requestSnapshot();
    },
    recover() {
      if (failure !== null) return Promise.reject(failure);
      if (state !== 'live') {
        return Promise.reject(new ClosedHandleError('Playground preview registry'));
      }
      if (recoveryPromise !== null) return recoveryPromise;
      const recovery = (async (): Promise<void> => {
        try {
          dependencies.requestSnapshot();
        } catch (error) {
          throw degrade(error);
        }
        while (state === 'live') {
          const generation = replaceGeneration(
            latestGeneration.snapshot,
            new Error('Explicit preview recovery superseded pending route proof'),
          );
          await scheduleReconcile(generation);
          if (generation === latestGeneration) return;
        }
        assertLive();
      })();
      const recoveryPromiseResult = recovery.finally(() => {
        if (recoveryPromise === recoveryPromiseResult) recoveryPromise = null;
      });
      recoveryPromise = recoveryPromiseResult;
      return recoveryPromiseResult;
    },
    close() {
      if (closePromise !== null) return closePromise;
      if (state === 'closed') return Promise.resolve();
      state = 'closing';
      abortGeneration(latestGeneration, new ClosedHandleError('Playground preview registry'));
      closePromise = operationTail.then(async () => {
        const errors: Error[] = [];
        if (publicSnapshot.length > 0 || routedSnapshot.length > 0) {
          publishRouted(Object.freeze([]));
          publishPublic(Object.freeze([]));
        }
        const routeCount = mounted.size;
        errors.push(...tearDownPorts([...mounted.keys()]));
        if (routeCount > 0) {
          try {
            await dependencies.proveServiceWorkerControl(new AbortController().signal);
          } catch (error) {
            errors.push(errorFrom(error));
          }
        }
        try {
          unsubscribeRaw();
        } catch (error) {
          errors.push(errorFrom(error));
        }
        publicListeners.clear();
        routedListeners.clear();
        state = 'closed';
        if (errors.length > 0) {
          failure = new AggregateError(errors, 'Playground preview route close failed');
          throw failure;
        }
      });
      void closePromise.catch(() => {});
      return closePromise;
    },
  });
}
