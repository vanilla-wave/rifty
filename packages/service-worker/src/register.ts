/**
 * Register the rifty Service Worker and wait until it reaches the `activated`
 * state. Adds a bounded timeout and explicit `redundant` handling so a stuck
 * registration surfaces as a rejection instead of hanging forever.
 */

export interface ServiceWorkerRegistrationResult {
  readonly registration: ServiceWorkerRegistration;
  readonly active: ServiceWorker;
}

export interface RegisterServiceWorkerOptions {
  scope?: string;
  type?: WorkerType;
  /**
   * Maximum time (ms) to wait for the SW to reach `activated`. If exceeded,
   * the promise rejects with `Error('service-worker activation timed out
   * after Nms')`. Default `30_000`.
   */
  timeout?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Register the rifty SW. Throws if `navigator.serviceWorker` is unavailable
 * (Workers in private browsing in some engines). Rejects if the worker either
 * times out before activating or transitions to `redundant`.
 */
export async function registerServiceWorker(
  scriptUrl: string,
  options?: RegisterServiceWorkerOptions,
): Promise<ServiceWorkerRegistrationResult> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('serviceWorker is not available in this environment');
  }
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const registration = await navigator.serviceWorker.register(scriptUrl, {
    scope: options?.scope ?? '/',
    type: options?.type ?? 'module',
  });

  // If a worker is already active, we're done — no waiting, no timeout.
  if (registration.active) {
    return { registration, active: registration.active };
  }

  const active = await waitForActivation(registration, timeoutMs);
  return { registration, active };
}

function waitForActivation(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
): Promise<ServiceWorker> {
  return new Promise<ServiceWorker>((resolve, reject) => {
    let settled = false;
    const settleResolve = (worker: ServiceWorker): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(worker);
    };
    const settleReject = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const timer = setTimeout(() => {
      settleReject(new Error(`service-worker activation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const attachStateListener = (worker: ServiceWorker): void => {
      const onStateChange = (): void => {
        // Log state transitions so a stuck worker is debuggable.
        // eslint-disable-next-line no-console
        console.log(`[rifty/service-worker] state -> ${worker.state}`);
        if (worker.state === 'activated') {
          worker.removeEventListener('statechange', onStateChange);
          settleResolve(worker);
        } else if (worker.state === 'redundant') {
          worker.removeEventListener('statechange', onStateChange);
          settleReject(new Error('service-worker became redundant during activation'));
        }
      };
      worker.addEventListener('statechange', onStateChange);
      // Cover the race where the worker already activated between the
      // `register()` resolve and the listener attaching.
      if (worker.state === 'activated') settleResolve(worker);
      else if (worker.state === 'redundant') {
        settleReject(new Error('service-worker became redundant during activation'));
      }
    };

    const candidate = registration.installing ?? registration.waiting;
    if (candidate) {
      attachStateListener(candidate);
      return;
    }
    // No worker yet — wait for `updatefound` to discover the installing one.
    const onUpdateFound = (): void => {
      const installing = registration.installing;
      if (installing) {
        registration.removeEventListener('updatefound', onUpdateFound);
        attachStateListener(installing);
      }
    };
    registration.addEventListener('updatefound', onUpdateFound);
  });
}
