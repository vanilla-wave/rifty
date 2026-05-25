/**
 * Tests for `registerServiceWorker`: timeout when the SW never activates, and
 * rejection when it transitions to `redundant` mid-activation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/register.ts';

interface MockWorker {
  state: ServiceWorkerState;
  listeners: ((event: Event) => void)[];
  addEventListener: (type: string, fn: (event: Event) => void) => void;
  removeEventListener: (type: string, fn: (event: Event) => void) => void;
  transitionTo: (next: ServiceWorkerState) => void;
}

interface MockRegistration {
  active: MockWorker | null;
  installing: MockWorker | null;
  waiting: MockWorker | null;
  listeners: Record<string, ((event: Event) => void)[]>;
  addEventListener: (type: string, fn: (event: Event) => void) => void;
  removeEventListener: (type: string, fn: (event: Event) => void) => void;
  dispatch: (type: string, event: Event) => void;
}

function makeMockWorker(initial: ServiceWorkerState): MockWorker {
  const listeners: ((event: Event) => void)[] = [];
  return {
    state: initial,
    listeners,
    addEventListener(type, fn): void {
      if (type === 'statechange') listeners.push(fn);
    },
    removeEventListener(type, fn): void {
      if (type !== 'statechange') return;
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    transitionTo(next): void {
      this.state = next;
      for (const fn of listeners.slice()) {
        fn(new Event('statechange'));
      }
    },
  };
}

function makeMockRegistration(opts: {
  active?: MockWorker | null;
  installing?: MockWorker | null;
  waiting?: MockWorker | null;
}): MockRegistration {
  const listeners: Record<string, ((event: Event) => void)[]> = {};
  return {
    active: opts.active ?? null,
    installing: opts.installing ?? null,
    waiting: opts.waiting ?? null,
    listeners,
    addEventListener(type, fn): void {
      const arr = listeners[type] ?? [];
      arr.push(fn);
      listeners[type] = arr;
    },
    removeEventListener(type, fn): void {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    dispatch(type, event): void {
      const arr = listeners[type] ?? [];
      for (const fn of arr.slice()) fn(event);
    },
  };
}

describe('registerServiceWorker', () => {
  let originalNavigator: typeof globalThis.navigator;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  function installNavigator(register: (url: string) => Promise<MockRegistration>): void {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker: { register } },
    });
  }

  it('rejects with a timeout error if the SW does not activate in time', async () => {
    const worker = makeMockWorker('installing');
    const registration = makeMockRegistration({ installing: worker });
    installNavigator(async () => registration);

    const promise = registerServiceWorker('/sw.js', { timeout: 5_000 });
    // Suppress the unhandled rejection until we await it.
    const handled = promise.catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(5_001);
    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('service-worker activation timed out after 5000ms');
  });

  it('rejects when the SW transitions to redundant before activating', async () => {
    const worker = makeMockWorker('installing');
    const registration = makeMockRegistration({ installing: worker });
    installNavigator(async () => registration);

    const promise = registerServiceWorker('/sw.js', { timeout: 30_000 });
    const handled = promise.catch((e: Error) => e);
    // Trigger the redundant transition on the next microtask, after register()
    // has subscribed.
    await Promise.resolve();
    await Promise.resolve();
    worker.transitionTo('redundant');
    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('service-worker became redundant during activation');
  });

  it('resolves with the active worker when activation succeeds', async () => {
    const worker = makeMockWorker('installing');
    const registration = makeMockRegistration({ installing: worker });
    installNavigator(async () => registration);

    const promise = registerServiceWorker('/sw.js', { timeout: 30_000 });
    await Promise.resolve();
    await Promise.resolve();
    worker.transitionTo('activated');
    const result = await promise;
    expect(result.active).toBe(worker);
    expect(result.registration).toBe(registration);
  });

  it('returns immediately if the registration already has an active worker', async () => {
    const worker = makeMockWorker('activated');
    const registration = makeMockRegistration({ active: worker });
    installNavigator(async () => registration);

    const result = await registerServiceWorker('/sw.js');
    expect(result.active).toBe(worker);
  });
});
