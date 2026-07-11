import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { describe, expect, it, vi } from 'vitest';
import { proveRiftyServiceWorkerControl } from './service-worker-control.ts';

interface FakeServiceWorkerContainer {
  controller: ServiceWorker | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  emit(type: string, event: Event): void;
}

function fakeContainer(): FakeServiceWorkerContainer {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    controller: null,
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set<EventListener>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
}

describe('rifty service-worker control proof', () => {
  it('rejects when registration never yields a controller for this page', async () => {
    const serviceWorker = fakeContainer();

    await expect(
      proveRiftyServiceWorkerControl({
        timeoutMs: 5,
        serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      }),
    ).rejects.toThrow('no controlling rifty service worker');
  });

  it('accepts only a version-matched pong from the controlling worker', async () => {
    const serviceWorker = fakeContainer();
    const controller = {
      postMessage: vi.fn(() => {
        queueMicrotask(() => {
          serviceWorker.emit('message', {
            data: {
              type: SW_PONG,
              frameVersion: SW_FRAME_VERSION,
              routingVersion: SW_ROUTING_VERSION,
              from: 'service-worker',
            },
            source: controller,
          } as unknown as MessageEvent);
        });
      }),
    } as unknown as ServiceWorker;
    serviceWorker.controller = controller;

    await expect(
      proveRiftyServiceWorkerControl({
        timeoutMs: 50,
        serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      }),
    ).resolves.toBeUndefined();
    expect(controller.postMessage).toHaveBeenCalledOnce();
  });

  it('rejects a pong from a different worker even when its versions match', async () => {
    const serviceWorker = fakeContainer();
    const controller = {
      postMessage: vi.fn(() => {
        queueMicrotask(() => {
          serviceWorker.emit('message', {
            data: {
              type: SW_PONG,
              frameVersion: SW_FRAME_VERSION,
              routingVersion: SW_ROUTING_VERSION,
              from: 'service-worker',
            },
            source: {},
          } as unknown as MessageEvent);
        });
      }),
    } as unknown as ServiceWorker;
    serviceWorker.controller = controller;

    await expect(
      proveRiftyServiceWorkerControl({
        timeoutMs: 5,
        serviceWorker: serviceWorker as unknown as ServiceWorkerContainer,
      }),
    ).rejects.toThrow('failed the rifty protocol proof');
  });
});
