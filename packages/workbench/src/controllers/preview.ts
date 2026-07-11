import { notifySubscribers } from '../fault-boundary.ts';
import { errorsFrom } from '../fault-boundary.ts';
import {
  PreviewRouteSetError,
  createPreviewRouteSet,
  previewRouteKey,
} from '../glue/preview-route-set.ts';

export type PreviewStatus = 'idle' | 'starting' | 'live' | 'error';

export interface PreviewPort {
  readonly port: number;
  readonly url: string;
  readonly previewScope?: string;
  readonly label?: string;
  readonly source?: string;
  readonly sid?: string;
}

export interface PreviewPortsFrame {
  readonly ports: readonly PreviewPort[];
}

export interface PreviewDevServerFrame {
  readonly status: 'stopped' | 'starting' | 'running';
  readonly port?: number;
  readonly url?: string;
  readonly previewScope?: string;
  readonly error?: string;
}

export interface PreviewOwnerPort {
  readonly previewOwnerToken: string;
  onDevServer(listener: (frame: PreviewDevServerFrame) => void): () => void;
  onPreview(listener: (frame: PreviewPortsFrame) => void): () => void;
  requestPreview(): void;
}

export interface PreviewSnapshot {
  readonly status: PreviewStatus;
  readonly port: number | null;
  readonly url: string | null;
  readonly ports: readonly PreviewPort[];
  readonly error: string | null;
}

export interface PreviewProbeInit {
  readonly method: 'GET';
  readonly cache: 'no-store';
  readonly signal: AbortSignal;
}

export interface PreviewControllerOptions {
  readonly currentOwner: () => PreviewOwnerPort;
  /** Mount the page route and owner bridge for one advertised port. */
  readonly mountBridge: (port: number, ownerToken: string, previewScope?: string) => () => void;
  /** Must issue the real same-origin `/preview/<port>/` fetch through the SW. */
  readonly proveServiceWorkerRoundTrip: (url: string, init: PreviewProbeInit) => Promise<Response>;
  readonly probeTimeoutMs?: number;
}

export interface PreviewController {
  snapshot(): PreviewSnapshot;
  subscribe(listener: (snapshot: PreviewSnapshot) => void): () => void;
  /** Rebind after the session replaces its owner. Defaults to `currentOwner()`. */
  attachOwner(owner?: PreviewOwnerPort): void;
  /** Resume owner tracking after an explicit stop and request a fresh port set. */
  start(): void;
  /** Select one of the owner's currently advertised preview ports. */
  select(port: number): void;
  /** Re-run the SW proof for the selected port. */
  retry(): void;
  /** Surface an external preview prerequisite failure before a port exists. */
  fail(error: unknown): void;
  /** Tear down every mounted bridge/route and ignore frames until `start()`. */
  stop(): void;
  dispose(): void;
}

const DEFAULT_PROBE_TIMEOUT_MS = 4_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function copyPort(port: PreviewPort): PreviewPort {
  return { ...port };
}

export function createPreviewController(options: PreviewControllerOptions): PreviewController {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0) {
    throw new Error('preview probeTimeoutMs must be a positive finite number');
  }

  let disposed = false;
  let suspended = false;
  let owner: PreviewOwnerPort | null = null;
  let ownerEpoch = 0;
  let unsubscribeDev: (() => void) | null = null;
  let unsubscribePorts: (() => void) | null = null;
  let devStatus: PreviewDevServerFrame['status'] = 'stopped';
  let announcedPort: number | null = null;
  let announcedUrl: string | null = null;
  let selectedPort: number | null = null;
  let ports: PreviewPort[] = [];
  let state: PreviewSnapshot = {
    status: 'idle',
    port: null,
    url: null,
    ports: [],
    error: null,
  };
  const listeners = new Set<(snapshot: PreviewSnapshot) => void>();
  const previewRoutes = createPreviewRouteSet({ mountBridge: options.mountBridge });
  let proofEpoch = 0;
  let proofAbort: AbortController | null = null;
  let activeProofKey: string | null = null;
  let provenKey: string | null = null;
  let forcedError: string | null = null;

  const assertAlive = (): void => {
    if (disposed) throw new Error('preview controller disposed');
  };

  const publish = (next: Omit<PreviewSnapshot, 'ports'>): void => {
    if (disposed) return;
    state = { ...next, ports: ports.map(copyPort) };
    notifySubscribers(listeners, state);
  };

  const primary = (): PreviewPort | null => {
    if (ports.length === 0) return null;
    if (selectedPort !== null) {
      const selected = ports.find((entry) => entry.port === selectedPort);
      if (selected) return selected;
    }
    if (announcedPort !== null) {
      const announced = ports.find((entry) => entry.port === announcedPort);
      if (announced) return announced;
    }
    return ports.at(-1) ?? null;
  };

  const cancelProof = (): void => {
    proofEpoch += 1;
    proofAbort?.abort();
    proofAbort = null;
    activeProofKey = null;
  };

  const proofError = (entry: PreviewPort, message: string): void => {
    publish({ status: 'error', port: entry.port, url: entry.url, error: message });
  };

  const prove = (entry: PreviewPort, force = false): void => {
    const currentOwner = owner;
    if (!currentOwner || suspended || disposed) return;
    const key = previewRouteKey(currentOwner.previewOwnerToken, entry);
    if (!force && activeProofKey === key && state.url === entry.url) return;
    if (!force && provenKey === key && state.status === 'live' && state.url === entry.url) return;

    cancelProof();
    const epoch = proofEpoch;
    const abort = new AbortController();
    proofAbort = abort;
    activeProofKey = key;
    provenKey = null;
    publish({ status: 'starting', port: entry.port, url: entry.url, error: null });

    const probe = Promise.resolve().then(() =>
      options.proveServiceWorkerRoundTrip(entry.url, {
        method: 'GET',
        cache: 'no-store',
        signal: abort.signal,
      }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`preview SW round-trip timed out after ${probeTimeoutMs}ms`));
      }, probeTimeoutMs);
    });

    void Promise.race([probe, timeout]).then(
      (response) => {
        if (timer !== undefined) clearTimeout(timer);
        // Response headers complete the SW proof. Body cleanup is best-effort and
        // must never extend the bounded readiness operation.
        void Promise.resolve()
          .then(() => response.body?.cancel())
          .catch(() => {});
        if (disposed || suspended || epoch !== proofEpoch) return;
        if (!response.ok) {
          activeProofKey = null;
          proofError(entry, `preview SW round-trip failed with HTTP ${response.status}`);
          return;
        }
        const latestOwner = owner;
        const latest = primary();
        if (
          !latestOwner ||
          !latest ||
          previewRouteKey(latestOwner.previewOwnerToken, latest) !== key ||
          latest.url !== entry.url
        ) {
          return;
        }
        proofAbort = null;
        activeProofKey = null;
        provenKey = key;
        publish({ status: 'live', port: entry.port, url: entry.url, error: null });
      },
      (error: unknown) => {
        if (timer !== undefined) clearTimeout(timer);
        if (disposed || suspended || epoch !== proofEpoch) return;
        proofAbort = null;
        activeProofKey = null;
        proofError(entry, errorMessage(error));
      },
    );
  };

  const reconcile = (): void => {
    if (disposed || suspended) return;
    const currentOwner = owner;
    if (!currentOwner) return;
    if (forcedError !== null) {
      cancelProof();
      provenKey = null;
      try {
        previewRoutes.clear();
      } catch (error) {
        forcedError = `${forcedError}; preview route teardown failed: ${errorMessage(error)}`;
      }
      publish({ status: 'error', port: null, url: null, error: forcedError });
      return;
    }
    try {
      previewRoutes.reconcile(currentOwner.previewOwnerToken, ports);
    } catch (error) {
      cancelProof();
      provenKey = null;
      const operation = error instanceof PreviewRouteSetError ? error.operation : 'reconcile';
      const message = `preview bridge ${operation} failed: ${errorMessage(error)}`;
      const entry = primary();
      if (entry) proofError(entry, message);
      else publish({ status: 'error', port: null, url: null, error: message });
      return;
    }

    const entry = primary();
    if (entry) {
      selectedPort = entry.port;
      // A duplicate primary can already be proven while labels/secondary ports
      // changed. Publish that owner snapshot even when no new proof is needed.
      publish({
        status: state.status,
        port: state.port,
        url: state.url,
        error: state.error,
      });
      prove(entry);
      return;
    }
    cancelProof();
    provenKey = null;
    previewRoutes.clear();
    if (state.status === 'error' && state.error !== null) return;
    publish({
      status: devStatus === 'starting' || devStatus === 'running' ? 'starting' : 'idle',
      port: announcedPort,
      url: announcedUrl,
      error: null,
    });
  };

  const detachOwner = (): void => {
    const errors: Error[] = [];
    ownerEpoch += 1;
    try {
      unsubscribeDev?.();
    } catch (error) {
      errors.push(asError(error));
    }
    try {
      unsubscribePorts?.();
    } catch (error) {
      errors.push(asError(error));
    }
    unsubscribeDev = null;
    unsubscribePorts = null;
    cancelProof();
    provenKey = null;
    try {
      previewRoutes.clear();
    } catch (error) {
      errors.push(asError(error));
    }
    owner = null;
    if (errors.length > 0) {
      throw new AggregateError(errors, errors.map((error) => error.message).join('; '));
    }
  };

  const attachOwner = (nextOwner: PreviewOwnerPort = options.currentOwner()): void => {
    assertAlive();
    detachOwner();
    suspended = false;
    owner = nextOwner;
    devStatus = 'stopped';
    announcedPort = null;
    announcedUrl = null;
    selectedPort = null;
    ports = [];
    publish(
      forcedError === null
        ? { status: 'idle', port: null, url: null, error: null }
        : { status: 'error', port: null, url: null, error: forcedError },
    );
    const epoch = ownerEpoch;
    try {
      unsubscribeDev = nextOwner.onDevServer((frame) => {
        if (disposed || suspended || epoch !== ownerEpoch) return;
        devStatus = frame.status;
        announcedPort = frame.port ?? null;
        announcedUrl = frame.url ?? null;
        if (frame.port !== undefined) selectedPort = frame.port;
        if (forcedError !== null) {
          reconcile();
          return;
        }
        if (frame.error !== undefined && ports.length === 0) {
          cancelProof();
          provenKey = null;
          previewRoutes.clear();
          publish({
            status: 'error',
            port: announcedPort,
            url: announcedUrl,
            error: frame.error,
          });
          return;
        }
        if (ports.length === 0) {
          publish({
            status: frame.status === 'stopped' ? 'idle' : 'starting',
            port: announcedPort,
            url: announcedUrl,
            error: null,
          });
        }
        reconcile();
      });
      unsubscribePorts = nextOwner.onPreview((frame) => {
        if (disposed || suspended || epoch !== ownerEpoch) return;
        ports = frame.ports.map(copyPort);
        if (selectedPort !== null && !ports.some((entry) => entry.port === selectedPort)) {
          selectedPort = null;
        }
        reconcile();
      });
      nextOwner.requestPreview();
    } catch (error) {
      const primary = asError(error);
      try {
        detachOwner();
      } catch (cleanupError) {
        const failures = [primary, ...errorsFrom(cleanupError)];
        throw new AggregateError(failures, failures.map((failure) => failure.message).join('; '));
      }
      throw primary;
    }
  };

  const stop = (): void => {
    assertAlive();
    suspended = true;
    cancelProof();
    provenKey = null;
    let teardownError: Error | null = null;
    try {
      previewRoutes.clear();
    } catch (error) {
      teardownError = asError(error);
    }
    ports = [];
    selectedPort = null;
    announcedPort = null;
    announcedUrl = null;
    devStatus = 'stopped';
    forcedError = null;
    publish({ status: 'idle', port: null, url: null, error: null });
    if (teardownError) throw teardownError;
  };

  attachOwner();

  return {
    snapshot() {
      assertAlive();
      return state;
    },
    subscribe(listener) {
      assertAlive();
      listeners.add(listener);
      notifySubscribers([listener], state);
      return () => listeners.delete(listener);
    },
    attachOwner,
    start() {
      assertAlive();
      suspended = false;
      forcedError = null;
      try {
        owner?.requestPreview();
      } catch (error) {
        const failure = asError(error);
        publish({ status: 'error', port: null, url: null, error: failure.message });
        throw failure;
      }
      reconcile();
    },
    select(port) {
      assertAlive();
      if (!ports.some((entry) => entry.port === port)) {
        throw new Error(`preview port ${port} is not advertised by the owner`);
      }
      selectedPort = port;
      const entry = primary();
      if (entry) prove(entry, true);
    },
    retry() {
      assertAlive();
      forcedError = null;
      const entry = primary();
      if (!entry) throw new Error('preview has no advertised port to retry');
      prove(entry, true);
    },
    fail(error) {
      assertAlive();
      forcedError = errorMessage(error);
      reconcile();
      if (owner === null) {
        publish({ status: 'error', port: null, url: null, error: forcedError });
      }
    },
    stop,
    dispose() {
      if (disposed) return;
      const teardownErrors: Error[] = [];
      try {
        detachOwner();
      } catch (error) {
        teardownErrors.push(asError(error));
      }
      try {
        previewRoutes.dispose();
      } catch (error) {
        teardownErrors.push(asError(error));
      } finally {
        disposed = true;
        listeners.clear();
      }
      if (teardownErrors.length > 0) {
        throw new AggregateError(
          teardownErrors,
          teardownErrors.map((error) => error.message).join('; '),
        );
      }
    },
  };
}
