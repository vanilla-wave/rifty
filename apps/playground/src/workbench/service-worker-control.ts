import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';

export interface ServiceWorkerControlWorker {
  postMessage(message: unknown): void;
}

export interface ServiceWorkerControlContainer {
  readonly controller: ServiceWorkerControlWorker | null;
  addEventListener(type: 'controllerchange' | 'message', listener: EventListener): void;
  removeEventListener(type: 'controllerchange' | 'message', listener: EventListener): void;
}

export interface ServiceWorkerControlTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export class ServiceWorkerControlAbortedError extends Error {
  constructor(reason?: unknown) {
    super('Service-worker control proof was aborted');
    this.name = 'ServiceWorkerControlAbortedError';
    this.cause = reason;
  }
}

export interface ServiceWorkerControlProofOptions {
  readonly container: ServiceWorkerControlContainer;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly timers: ServiceWorkerControlTimers;
}

export function proveRiftyServiceWorkerControl(
  options: ServiceWorkerControlProofOptions,
): Promise<void> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return Promise.reject(
      new RangeError('Service-worker control proof timeout must be a positive finite number'),
    );
  }
  if (options.signal?.aborted) {
    return Promise.reject(new ServiceWorkerControlAbortedError(options.signal.reason));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeController: ServiceWorkerControlWorker | null = null;
    let timerId: number | undefined;
    let controllerListenerAttached = false;
    let messageListenerAttached = false;
    let abortListenerAttached = false;

    const cleanup = (): void => {
      if (timerId !== undefined) options.timers.clearTimeout(timerId);
      if (controllerListenerAttached) {
        options.container.removeEventListener('controllerchange', onControllerChange);
      }
      if (messageListenerAttached) {
        options.container.removeEventListener('message', onMessage);
      }
      if (abortListenerAttached) options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve();
      else reject(error);
    };

    const onControllerChange: EventListener = (): void => {
      if (settled) return;
      let controller: ServiceWorkerControlWorker | null;
      try {
        controller = options.container.controller;
      } catch (error) {
        finish(toError(error));
        return;
      }
      if (controller === activeController) return;
      activeController = controller;
      if (controller === null) return;
      try {
        controller.postMessage({
          type: SW_PING,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
        });
      } catch (error) {
        finish(toError(error));
      }
    };

    const onMessage: EventListener = (event): void => {
      if (!(event instanceof MessageEvent)) return;
      let currentController: ServiceWorkerControlWorker | null;
      try {
        currentController = options.container.controller;
      } catch (error) {
        finish(toError(error));
        return;
      }
      if (
        event.source !== activeController ||
        event.source !== currentController ||
        !isMatchingPong(event.data)
      ) {
        return;
      }
      finish();
    };

    const onAbort: EventListener = (): void =>
      finish(new ServiceWorkerControlAbortedError(options.signal?.reason));

    try {
      timerId = options.timers.setTimeout(() => {
        const awaited = activeController === null ? 'a controller' : 'PONG';
        finish(new Error(`Service-worker control proof timed out waiting for ${awaited}`));
      }, options.timeoutMs);
      options.container.addEventListener('controllerchange', onControllerChange);
      controllerListenerAttached = true;
      options.container.addEventListener('message', onMessage);
      messageListenerAttached = true;
      options.signal?.addEventListener('abort', onAbort, { once: true });
      abortListenerAttached = options.signal !== undefined;
    } catch (error) {
      finish(toError(error));
      return;
    }

    if (options.signal?.aborted) onAbort(new Event('abort'));
    else onControllerChange(new Event('controllerchange'));
  });
}

function isMatchingPong(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const frame = value as Readonly<Record<string, unknown>>;
  return (
    frame.type === SW_PONG &&
    frame.from === 'service-worker' &&
    frame.frameVersion === SW_FRAME_VERSION &&
    frame.routingVersion === SW_ROUTING_VERSION
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
