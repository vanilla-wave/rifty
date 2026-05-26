/**
 * Tests for `PreviewOwnerResolver` strategy — the seam introduced ahead of
 * M11 A-026 (Vite-in-Worker) and A-023 (SW → Worker process registry).
 *
 * The default `FirstWindowOwnerResolver` carries the current (pre-M11)
 * behaviour verbatim: prefer the `event.clientId`, fall back once per scope
 * to the first controlled window when the id is empty. M11 ships a
 * `WorkerOwnerResolver` that consults the cross-realm port registry; the
 * route-preview pipeline must accept either implementation without code
 * change, so this file pins both the default behaviour and the seam shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstWindowOwnerResolver, type PreviewOwnerResolver } from '../src/owner-resolver.ts';
import { createPreviewInterceptor } from '../src/preview-bridge.ts';
import { SW_PREVIEW_READY, SW_PROTOCOL_VERSION } from '../src/protocol.ts';

interface MockClient {
  id: string;
  type?: ClientTypes;
  postMessage: ReturnType<typeof vi.fn>;
}

function makeMockClient(id: string, type: ClientTypes = 'window'): MockClient {
  return {
    id,
    type,
    postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>(),
  };
}

interface MockClients {
  get: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
}

function makeMockClients(clients: MockClient[]): MockClients {
  return {
    get: vi.fn(async (id: string) => clients.find((c) => c.id === id)),
    matchAll: vi.fn(async (opts?: { type?: ClientTypes; includeUncontrolled?: boolean }) => {
      const want = opts?.type;
      if (!want) return clients;
      return clients.filter((c) => c.type === want);
    }),
  };
}

function makeRequest(url = 'http://x/preview/3000/'): Request {
  return new Request(url);
}

describe('FirstWindowOwnerResolver', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the client matching the supplied clientId when present', async () => {
    const a = makeMockClient('client-A');
    const b = makeMockClient('client-B');
    const clients = makeMockClients([a, b]) as unknown as Clients;
    const resolver = new FirstWindowOwnerResolver();
    const scope = { clients } as unknown as ServiceWorkerGlobalScope;
    const owner = await resolver.resolveOwner(scope, makeRequest(), 'client-B');
    expect(owner?.id).toBe('client-B');
    // No fallback path → no console.warn
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the first controlled window when clientId is null', async () => {
    const a = makeMockClient('client-A');
    const b = makeMockClient('client-B');
    const clients = makeMockClients([a, b]) as unknown as Clients;
    const resolver = new FirstWindowOwnerResolver();
    const scope = { clients } as unknown as ServiceWorkerGlobalScope;
    const owner = await resolver.resolveOwner(scope, makeRequest(), null);
    expect(owner?.id).toBe('client-A');
    // First fallback warns once
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Same scope: no second warning
    const owner2 = await resolver.resolveOwner(scope, makeRequest(), null);
    expect(owner2?.id).toBe('client-A');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores non-window clients in the fallback path', async () => {
    const sw = makeMockClient('sw-self', 'worker');
    const win = makeMockClient('client-W', 'window');
    const clients = makeMockClients([sw, win]) as unknown as Clients;
    const resolver = new FirstWindowOwnerResolver();
    const scope = { clients } as unknown as ServiceWorkerGlobalScope;
    const owner = await resolver.resolveOwner(scope, makeRequest(), null);
    expect(owner?.id).toBe('client-W');
  });

  it('returns null when no window clients exist and no clientId given', async () => {
    const sw = makeMockClient('sw-self', 'worker');
    const clients = makeMockClients([sw]) as unknown as Clients;
    const resolver = new FirstWindowOwnerResolver();
    const scope = { clients } as unknown as ServiceWorkerGlobalScope;
    const owner = await resolver.resolveOwner(scope, makeRequest(), null);
    expect(owner).toBeNull();
  });
});

describe('createPreviewInterceptor with custom PreviewOwnerResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes preview fetches through the resolver the caller supplied', async () => {
    // A resolver that returns a non-window client, proving the seam: the
    // route-preview path uses whatever the resolver returns, not its own
    // baked-in client lookup.
    const workerClient = makeMockClient('worker-1', 'worker');
    const customResolver: PreviewOwnerResolver = {
      resolveOwner: vi.fn(async () => workerClient as unknown as Client),
    };
    const listeners: Record<string, ((event: unknown) => void)[]> = {};
    const scope = {
      clients: makeMockClients([workerClient]),
      addEventListener(type: string, fn: (event: unknown) => void): void {
        const arr = listeners[type] ?? [];
        arr.push(fn);
        listeners[type] = arr;
      },
      removeEventListener(type: string, fn: (event: unknown) => void): void {
        const arr = listeners[type];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
      },
    } as unknown as ServiceWorkerGlobalScope;

    const interceptor = createPreviewInterceptor(scope, {
      timeoutMs: 3_000,
      resolver: customResolver,
    });

    // The registry-internal ready-handshake path needs the worker client to
    // post `ready` for the request to be dispatched. Reuse the message
    // handler the interceptor installed.
    const messageHandler = listeners.message?.[0];
    expect(messageHandler).toBeDefined();
    messageHandler!({
      data: { type: SW_PREVIEW_READY, version: SW_PROTOCOL_VERSION },
      source: workerClient,
    });

    // Fire a /preview/* fetch, give the routePreview promise chain a tick.
    const fetchHandler = listeners.fetch?.[0];
    expect(fetchHandler).toBeDefined();
    let respPromise: Promise<Response> | undefined;
    fetchHandler!({
      request: new Request('http://x/preview/3000/'),
      clientId: '',
      resultingClientId: '',
      respondWith(p: Promise<Response>): void {
        respPromise = p;
      },
    });
    expect(respPromise).toBeDefined();
    await Promise.resolve();
    await Promise.resolve();

    // The custom resolver was consulted exactly once for this fetch.
    expect(customResolver.resolveOwner).toHaveBeenCalledTimes(1);
    // The seam fed our non-window client to routePreview, which then
    // postMessage'd it. The strategy works regardless of `Client.type`.
    expect(workerClient.postMessage).toHaveBeenCalledTimes(1);

    // Wrap up the in-flight response so vitest doesn't leak.
    const [, transfer] = workerClient.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    const response = await respPromise!;
    expect(response.status).toBe(200);
    interceptor.teardown();
  });
});
