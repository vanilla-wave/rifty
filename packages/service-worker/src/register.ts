export interface ServiceWorkerRegistrationResult {
  readonly registration: ServiceWorkerRegistration;
  readonly active: ServiceWorker;
}

/**
 * Register the rifty SW. Throws if `navigator.serviceWorker` is unavailable
 * (Workers in private browsing in some engines).
 */
export async function registerServiceWorker(
  scriptUrl: string,
  options?: { scope?: string; type?: WorkerType },
): Promise<ServiceWorkerRegistrationResult> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('serviceWorker is not available in this environment');
  }
  const registration = await navigator.serviceWorker.register(scriptUrl, {
    scope: options?.scope ?? '/',
    type: options?.type ?? 'module',
  });

  // Wait for an active worker — Chrome triggers `controllerchange` only after
  // first registration if there isn't already a controlling SW.
  const active = await new Promise<ServiceWorker>((resolve) => {
    if (registration.active) {
      resolve(registration.active);
      return;
    }
    const candidate = registration.installing ?? registration.waiting;
    if (!candidate) {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (installing) {
          installing.addEventListener('statechange', () => {
            if (installing.state === 'activated') resolve(installing);
          });
        }
      });
      return;
    }
    candidate.addEventListener('statechange', () => {
      if (candidate.state === 'activated') resolve(candidate);
    });
  });

  return { registration, active };
}
