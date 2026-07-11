import {
  SW_FRAME_VERSION,
  SW_PING,
  SW_PONG,
  SW_ROUTING_VERSION,
  type SwPongFrame,
} from '@riftydev/service-worker';

export interface ServiceWorkerControlProofOptions {
  readonly timeoutMs: number;
  readonly serviceWorker?: ServiceWorkerContainer;
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function waitForController(
  serviceWorker: ServiceWorkerContainer,
  deadline: number,
): Promise<ServiceWorker> {
  if (serviceWorker.controller) return Promise.resolve(serviceWorker.controller);
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
    const onControllerChange = (): void => {
      const controller = serviceWorker.controller;
      if (!controller) return;
      cleanup();
      resolve(controller);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('no controlling rifty service worker'));
    }, remaining(deadline));
    serviceWorker.addEventListener('controllerchange', onControllerChange);
    onControllerChange();
  });
}

function isMatchingPong(value: unknown): value is SwPongFrame {
  if (value === null || typeof value !== 'object') return false;
  const frame = value as Partial<SwPongFrame>;
  return (
    frame.type === SW_PONG &&
    frame.frameVersion === SW_FRAME_VERSION &&
    frame.routingVersion === SW_ROUTING_VERSION &&
    frame.from === 'service-worker'
  );
}

function pingController(
  serviceWorker: ServiceWorkerContainer,
  controller: ServiceWorker,
  deadline: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      serviceWorker.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== controller || !isMatchingPong(event.data)) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('controlling service worker failed the rifty protocol proof'));
    }, remaining(deadline));
    serviceWorker.addEventListener('message', onMessage);
    try {
      controller.postMessage({
        type: SW_PING,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Prove that this page is controlled by a protocol-compatible rifty SW. */
export async function proveRiftyServiceWorkerControl(
  options: ServiceWorkerControlProofOptions,
): Promise<void> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('service worker control proof timeout must be positive');
  }
  const serviceWorker = options.serviceWorker ?? globalThis.navigator?.serviceWorker;
  if (!serviceWorker) throw new Error('serviceWorker is not available in this environment');
  const deadline = Date.now() + options.timeoutMs;
  const controller = await waitForController(serviceWorker, deadline);
  await pingController(serviceWorker, controller, deadline);
}
