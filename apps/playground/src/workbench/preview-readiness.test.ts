import { describe, expect, it, vi } from 'vitest';
import {
  type PreviewAdvertisement,
  PreviewReadinessClosedError,
  createPreviewReadiness,
} from './preview-readiness.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function advertisement(overrides: Partial<PreviewAdvertisement> = {}): PreviewAdvertisement {
  return {
    ownerToken: 'owner-a',
    port: 5173,
    url: '/preview/5173/',
    source: 'dev-server',
    sid: 'dev',
    ...overrides,
  };
}

function publishSnapshot(
  listener: ((entries: readonly PreviewAdvertisement[]) => void) | null,
  entries: readonly PreviewAdvertisement[],
): void {
  if (listener === null) throw new Error('preview listener is not attached');
  listener(entries);
}

function harness() {
  const events: string[] = [];
  let listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
  const swProofs: ReturnType<typeof deferred<void>>[] = [];
  const httpProofs: ReturnType<
    typeof deferred<{ readonly ok: boolean; readonly status: number }>
  >[] = [];
  const teardowns: ReturnType<typeof vi.fn>[] = [];
  const readiness = createPreviewReadiness({
    timeoutMs: 1_000,
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    requestSnapshot() {
      events.push('request');
    },
    mountRoute(entry) {
      events.push(`mount:${entry.ownerToken}:${entry.port}`);
      const teardown = vi.fn(() => events.push(`teardown:${entry.ownerToken}:${entry.port}`));
      teardowns.push(teardown);
      return teardown;
    },
    proveServiceWorkerControl(signal) {
      events.push('sw');
      const proof = deferred<void>();
      signal.addEventListener('abort', () => proof.reject(signal.reason), { once: true });
      swProofs.push(proof);
      return proof.promise;
    },
    probe(url, signal) {
      events.push(`http:${url}`);
      const proof = deferred<{ readonly ok: boolean; readonly status: number }>();
      signal.addEventListener('abort', () => proof.reject(signal.reason), { once: true });
      httpProofs.push(proof);
      return proof.promise;
    },
  });

  return {
    readiness,
    events,
    swProofs,
    httpProofs,
    teardowns,
    publish(entries: readonly PreviewAdvertisement[]) {
      listener?.(entries);
    },
  };
}

describe('preview readiness', () => {
  it('mounts an owner-authoritative route, then proves SW control and routed HTTP', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({
      ownerToken: 'owner-a',
      matches: (entry) => entry.source === 'dev-server',
    });

    expect(h.events).toEqual(['request']);
    h.publish([advertisement({ ownerToken: 'old-owner' })]);
    expect(h.events).toEqual(['request']);

    h.publish([advertisement()]);
    expect(h.events).toEqual(['request', 'mount:owner-a:5173', 'sw']);
    h.swProofs[0]?.resolve();
    await Promise.resolve();
    expect(h.events).toEqual(['request', 'mount:owner-a:5173', 'sw', 'http:/preview/5173/']);
    h.httpProofs[0]?.resolve({ ok: true, status: 200 });

    await expect(ready).resolves.toEqual({
      ownerToken: 'owner-a',
      port: 5173,
      url: '/preview/5173/',
    });
  });

  it('revokes a disappearing candidate and ignores its late proof', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    h.publish([advertisement()]);
    expect(h.swProofs).toHaveLength(1);
    h.publish([]);
    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);

    h.swProofs[0]?.resolve();
    await Promise.resolve();
    expect(h.httpProofs).toHaveLength(0);

    h.publish([advertisement({ port: 5174, url: '/preview/5174/' })]);
    h.swProofs[1]?.resolve();
    await Promise.resolve();
    h.httpProofs[0]?.resolve({ ok: true, status: 200 });
    await expect(ready).resolves.toMatchObject({ port: 5174, url: '/preview/5174/' });
  });

  it.each([
    ['url', { url: '/preview/5173/replaced/' }],
    ['source', { source: 'node' as const }],
    ['session', { sid: 'replacement-run' }],
  ] as const)('restarts proof when the advertised %s identity changes', async (_label, change) => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    h.publish([advertisement()]);
    expect(h.swProofs).toHaveLength(1);
    const replacement = advertisement(change);
    h.publish([replacement]);

    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);
    expect(h.swProofs).toHaveLength(2);
    h.swProofs[0]?.resolve();
    await Promise.resolve();
    expect(h.httpProofs).toHaveLength(0);

    h.swProofs[1]?.resolve();
    await Promise.resolve();
    h.httpProofs[0]?.resolve({ ok: true, status: 200 });
    await expect(ready).resolves.toMatchObject({
      ownerToken: replacement.ownerToken,
      port: replacement.port,
      url: replacement.url,
    });
  });

  it('rejects a failed controlling-service-worker proof and revokes the route', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    h.publish([advertisement()]);
    h.swProofs[0]?.reject(new Error('controlling service worker changed'));

    await expect(ready).rejects.toThrow('controlling service worker changed');
    expect(h.httpProofs).toHaveLength(0);
    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-success routed response without inventing LIVE', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    h.publish([advertisement()]);
    h.swProofs[0]?.resolve();
    await Promise.resolve();
    h.httpProofs[0]?.resolve({ ok: false, status: 503 });

    await expect(ready).rejects.toThrow('HTTP 503');
    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);
  });

  it('close aborts pending proof, tears down the route, and is idempotent', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });
    h.publish([advertisement()]);

    const first = h.readiness.close();
    const second = h.readiness.close();
    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
    await expect(ready).rejects.toBeInstanceOf(PreviewReadinessClosedError);
    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);
  });

  it('close revokes a route after readiness has already resolved', async () => {
    const h = harness();
    const ready = h.readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });
    h.publish([advertisement()]);
    h.swProofs[0]?.resolve();
    await Promise.resolve();
    h.httpProofs[0]?.resolve({ ok: true, status: 200 });
    await ready;

    await h.readiness.close();

    expect(h.teardowns[0]).toHaveBeenCalledTimes(1);
  });

  it('installs the disposer before processing a synchronous subscription snapshot', async () => {
    const mountFailure = new Error('route mount failed');
    const detach = vi.fn();
    const requestSnapshot = vi.fn();
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe(listener) {
        listener([advertisement()]);
        return detach;
      },
      requestSnapshot,
      mountRoute() {
        throw mountFailure;
      },
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    await expect(ready).rejects.toBe(mountFailure);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(requestSnapshot).not.toHaveBeenCalled();
  });

  it('serializes a replacement published reentrantly by route mount', async () => {
    let listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
    const publish = (entries: readonly PreviewAdvertisement[]): void => {
      const current = listener;
      if (current === null) throw new Error('preview listener is not attached');
      current(entries);
    };
    const teardowns = new Map<number, ReturnType<typeof vi.fn>>();
    const first = advertisement();
    const replacement = advertisement({ port: 5174, url: '/preview/5174/' });
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
      requestSnapshot() {},
      mountRoute(entry) {
        const teardown = vi.fn();
        teardowns.set(entry.port, teardown);
        if (entry.port === first.port) publish([replacement]);
        return teardown;
      },
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });
    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    publish([first]);
    const handle = await ready;
    await readiness.close();

    expect(handle).toEqual({
      ownerToken: replacement.ownerToken,
      port: replacement.port,
      url: replacement.url,
    });
    expect(teardowns.get(first.port)).toHaveBeenCalledTimes(1);
    expect(teardowns.get(replacement.port)).toHaveBeenCalledTimes(1);
  });

  it('fences replacement publications from failure teardown before cleanup callbacks', async () => {
    let listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
    const mountRoute = vi.fn((entry: PreviewAdvertisement) => {
      return () => {
        const current = listener;
        if (entry.port === 5173 && current !== null) {
          current([advertisement({ port: 5174, url: '/preview/5174/' })]);
        }
      };
    });
    const proof = deferred<void>();
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
      requestSnapshot() {},
      mountRoute,
      proveServiceWorkerControl: vi.fn(() => proof.promise),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });
    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });
    publishSnapshot(listener, [advertisement()]);
    const failure = new Error('SW proof failed');

    proof.reject(failure);

    await expect(ready).rejects.toBe(failure);
    expect(mountRoute).toHaveBeenCalledTimes(1);
  });

  it('does not mount when matching synchronously closes readiness', async () => {
    const h = harness();
    let closing: Promise<void> | null = null;
    const ready = h.readiness.waitFor({
      ownerToken: 'owner-a',
      matches: () => {
        closing = h.readiness.close();
        return true;
      },
    });

    h.publish([advertisement()]);

    await expect(ready).rejects.toBeInstanceOf(PreviewReadinessClosedError);
    await expect(closing).resolves.toBeUndefined();
    expect(h.teardowns).toHaveLength(0);
    expect(h.swProofs).toHaveLength(0);
  });

  it('includes a route mounted around reentrant close in that close exactly once', async () => {
    let listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
    let closing: Promise<void> | null = null;
    const teardown = vi.fn();
    const proveServiceWorkerControl = vi.fn(async () => {});
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
      requestSnapshot() {},
      mountRoute() {
        closing = readiness.close();
        return teardown;
      },
      proveServiceWorkerControl,
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });
    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });
    publishSnapshot(listener, [advertisement()]);

    await expect(ready).rejects.toBeInstanceOf(PreviewReadinessClosedError);
    await expect(closing).resolves.toBeUndefined();
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(proveServiceWorkerControl).not.toHaveBeenCalled();
  });

  it('reserves one close promise before a route disposer can reenter close', async () => {
    let listener: ((entries: readonly PreviewAdvertisement[]) => void) | null = null;
    let reentered: Promise<void> | null = null;
    let didReenter = false;
    const teardown = vi.fn(() => {
      if (didReenter) return;
      didReenter = true;
      reentered = readiness.close();
    });
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
      requestSnapshot() {},
      mountRoute: () => teardown,
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });
    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });
    publishSnapshot(listener, [advertisement()]);
    await ready;

    const closing = readiness.close();

    expect(reentered).toBe(closing);
    expect(readiness.close()).toBe(closing);
    await closing;
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('waits for and detaches a disposer returned after close during subscribe', async () => {
    const detach = vi.fn();
    const requestSnapshot = vi.fn();
    let closing: Promise<void> | null = null;
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe() {
        closing = readiness.close();
        return detach;
      },
      requestSnapshot,
      mountRoute: vi.fn(() => vi.fn()),
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    const ready = readiness.waitFor({ ownerToken: 'owner-a', matches: () => true });

    await expect(ready).rejects.toBeInstanceOf(PreviewReadinessClosedError);
    await expect(closing).resolves.toBeUndefined();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(requestSnapshot).not.toHaveBeenCalled();
  });

  it('propagates subscribe failure without requesting a snapshot', async () => {
    const failure = new Error('subscribe failed');
    const requestSnapshot = vi.fn();
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe() {
        throw failure;
      },
      requestSnapshot,
      mountRoute: vi.fn(() => vi.fn()),
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    await expect(readiness.waitFor({ ownerToken: 'owner-a', matches: () => true })).rejects.toBe(
      failure,
    );
    expect(requestSnapshot).not.toHaveBeenCalled();
  });

  it('detaches and propagates a synchronous snapshot-request failure', async () => {
    const failure = new Error('snapshot request failed');
    const detach = vi.fn();
    const readiness = createPreviewReadiness({
      timeoutMs: 1_000,
      subscribe() {
        return detach;
      },
      requestSnapshot() {
        throw failure;
      },
      mountRoute: vi.fn(() => vi.fn()),
      proveServiceWorkerControl: vi.fn(async () => {}),
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    await expect(readiness.waitFor({ ownerToken: 'owner-a', matches: () => true })).rejects.toBe(
      failure,
    );
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
