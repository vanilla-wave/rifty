import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceWorkerControlAbortedError,
  type ServiceWorkerControlContainer,
  type ServiceWorkerControlWorker,
  proveRiftyServiceWorkerControl,
} from './service-worker-control.ts';

class Worker implements ServiceWorkerControlWorker {
  readonly messages: unknown[] = [];
  readonly transfers: Transferable[][] = [];

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.messages.push(message);
    this.transfers.push(transfer);
  }
}

class Container implements ServiceWorkerControlContainer {
  controller: ServiceWorkerControlWorker | null = null;
  readonly #listeners = new Map<'controllerchange' | 'message', Set<EventListener>>();

  addEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: 'controllerchange' | 'message', listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  emit(type: 'controllerchange' | 'message', event: Event = new Event(type)): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type: 'controllerchange' | 'message'): number {
    return this.#listeners.get(type)?.size ?? 0;
  }
}

class TestTimers {
  readonly #callbacks = new Map<number, () => void>();
  #nextId = 1;

  readonly setTimeout = vi.fn((callback: () => void, _delayMs: number): number => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#callbacks.set(id, callback);
    return id;
  });

  readonly clearTimeout = vi.fn((id: number): void => {
    this.#callbacks.delete(id);
  });

  get pending(): number {
    return this.#callbacks.size;
  }

  fireAll(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

function messageEvent(source: ServiceWorkerControlWorker, data: unknown): MessageEvent<unknown> {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', { value: source });
  return event;
}

const exactPong = Object.freeze({
  type: SW_PONG,
  from: 'service-worker',
  frameVersion: SW_FRAME_VERSION,
  routingVersion: SW_ROUTING_VERSION,
});

function transferredReplyPort(worker: Worker, attempt = 0): MessagePort {
  const port = worker.transfers[attempt]?.[0];
  if (!(port instanceof MessagePort)) throw new Error('missing transferred reply port');
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rifty service-worker control proof', () => {
  it('correlates every controller attempt to its dedicated reply port', async () => {
    const container = new Container();
    const previous = new Worker();
    const replacement = new Worker();
    const timers = new TestTimers();
    const close = vi.spyOn(MessagePort.prototype, 'close');
    container.controller = previous;

    let resolved = false;
    const proof = proveRiftyServiceWorkerControl({ container, timeoutMs: 1_000, timers });
    void proof.then(() => {
      resolved = true;
    });

    const staleReplyPort = transferredReplyPort(previous);
    container.controller = replacement;
    container.emit('controllerchange');
    const currentReplyPort = transferredReplyPort(replacement);
    expect(currentReplyPort).not.toBe(staleReplyPort);

    staleReplyPort.postMessage(exactPong);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    currentReplyPort.postMessage(exactPong);
    await expect(proof).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('never accepts an uncorrelated matching PONG from the global container bus', async () => {
    const container = new Container();
    const controller = new Worker();
    const impostor = new Worker();
    const timers = new TestTimers();
    const close = vi.spyOn(MessagePort.prototype, 'close');
    container.controller = controller;

    const proof = proveRiftyServiceWorkerControl({
      container,
      timeoutMs: 25,
      timers,
    });

    container.emit('message', messageEvent(impostor, exactPong));
    timers.fireAll();

    await expect(proof).rejects.toThrow('timed out');
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cleans the proof after a synchronous controller postMessage failure', async () => {
    const container = new Container();
    const abort = new AbortController();
    const removeAbortListener = vi.spyOn(abort.signal, 'removeEventListener');
    const failure = new Error('controller is gone');
    const controller: ServiceWorkerControlWorker = {
      postMessage(): void {
        throw failure;
      },
    };
    const timers = new TestTimers();
    container.controller = controller;

    const proof = proveRiftyServiceWorkerControl({
      container,
      timeoutMs: 1_000,
      signal: abort.signal,
      timers,
    });

    await expect(proof).rejects.toBe(failure);
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.setTimeout).toHaveBeenCalledTimes(1);
    expect(timers.clearTimeout).toHaveBeenCalledTimes(1);
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(timers.pending).toBe(0);
  });

  it('re-proves a replacement controller and rejects the previous controller PONG', async () => {
    const container = new Container();
    const previous = new Worker();
    const replacement = new Worker();
    const timers = new TestTimers();
    container.controller = previous;

    let resolved = false;
    const proof = proveRiftyServiceWorkerControl({
      container,
      timeoutMs: 1_000,
      timers,
    });
    void proof.then(() => {
      resolved = true;
    });

    container.controller = replacement;
    container.emit('controllerchange', new Event('controllerchange'));
    transferredReplyPort(previous).postMessage(exactPong);
    await Promise.resolve();
    const acceptedPrevious = resolved;

    transferredReplyPort(replacement).postMessage(exactPong);
    await expect(proof).resolves.toBeUndefined();

    expect(acceptedPrevious).toBe(false);
    expect(replacement.messages).toEqual([
      { type: SW_PING, frameVersion: SW_FRAME_VERSION, routingVersion: SW_ROUTING_VERSION },
    ]);
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
  });

  it('accepts only a version-matching PONG from the actual controller', async () => {
    const container = new Container();
    const controller = new Worker();
    const impostor = new Worker();
    const timers = new TestTimers();
    container.controller = controller;

    const proof = proveRiftyServiceWorkerControl({ container, timeoutMs: 1_000, timers });
    expect(controller.messages).toEqual([
      { type: SW_PING, frameVersion: SW_FRAME_VERSION, routingVersion: SW_ROUTING_VERSION },
    ]);

    container.emit('message', messageEvent(impostor, exactPong));
    const replyPort = transferredReplyPort(controller);
    replyPort.postMessage({
      ...exactPong,
      routingVersion: SW_ROUTING_VERSION + 1,
    });
    expect(container.listenerCount('message')).toBe(0);

    replyPort.postMessage(exactPong);
    await expect(proof).resolves.toBeUndefined();
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
  });

  it('waits for a controller and proves that exact controller', async () => {
    const container = new Container();
    const controller = new Worker();
    const timers = new TestTimers();
    const proof = proveRiftyServiceWorkerControl({ container, timeoutMs: 1_000, timers });
    expect(container.listenerCount('controllerchange')).toBe(1);

    container.controller = controller;
    container.emit('controllerchange');
    expect(controller.messages).toHaveLength(1);
    transferredReplyPort(controller).postMessage(exactPong);

    await expect(proof).resolves.toBeUndefined();
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
  });

  it('closes the active reply port on abort without a late success', async () => {
    const container = new Container();
    const controller = new Worker();
    const abort = new AbortController();
    const timers = new TestTimers();
    const close = vi.spyOn(MessagePort.prototype, 'close');
    container.controller = controller;
    const proof = proveRiftyServiceWorkerControl({
      container,
      timeoutMs: 1_000,
      signal: abort.signal,
      timers,
    });

    abort.abort('project closed');
    await expect(proof).rejects.toBeInstanceOf(ServiceWorkerControlAbortedError);
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects in a finite bound when no controller appears', async () => {
    const container = new Container();
    const timers = new TestTimers();
    const proof = proveRiftyServiceWorkerControl({ container, timeoutMs: 25, timers });
    const observed = expect(proof).rejects.toThrow('timed out');

    timers.fireAll();
    await observed;
    expect(container.listenerCount('controllerchange')).toBe(0);
    expect(container.listenerCount('message')).toBe(0);
    expect(timers.pending).toBe(0);
  });
});
