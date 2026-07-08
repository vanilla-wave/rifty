/**
 * Tests for the SW-side state machine of the preview-bridge handshake
 * (`rifty:preview:ready`). Covers: pre-handshake queuing, post-handshake
 * dispatch, ready timeout, goodbye eviction, version-mismatch refusal.
 *
 * The SW is exercised via `createPreviewInterceptor` — the testable factory
 * that owns the fetch + message handlers and an internal ready-clients
 * registry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MessageHandlerHooks, createPreviewInterceptor } from '../src/preview-bridge.ts';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_ROUTING_VERSION,
} from '../src/protocol.ts';

interface MockClient {
  id: string;
  type: ClientTypes;
  url?: string;
  postMessage: ReturnType<typeof vi.fn>;
}

interface MockScope {
  clients: { matchAll: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  location: { origin: string };
  listeners: Record<string, ((event: unknown) => void)[]>;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  fetch: (
    url: string,
    init?: RequestInit & {
      clientId?: string;
      resultingClientId?: string;
      requestMode?: RequestMode;
      destination?: RequestDestination;
    },
  ) => Promise<Response>;
  postMessage: (data: unknown, source: MockClient) => void;
}

interface MockFetchInit extends RequestInit {
  clientId?: string;
  resultingClientId?: string;
  requestMode?: RequestMode;
  destination?: RequestDestination;
}

interface MockFetchDispatch {
  responded: boolean;
  response?: Promise<Response>;
}

function makeMockClient(id: string, type: ClientTypes = 'window', url?: string): MockClient {
  return {
    id,
    type,
    url,
    postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>(),
  };
}

function dispatchFetchEvent(
  scope: MockScope,
  url: string,
  init?: MockFetchInit,
): MockFetchDispatch {
  const fetchListeners = scope.listeners.fetch ?? [];
  let response: Promise<Response> | undefined;
  const { clientId, resultingClientId, requestMode, destination, ...requestInit } = init ?? {};
  const request = new Request(url, requestInit);
  if (requestMode !== undefined) {
    Object.defineProperty(request, 'mode', { configurable: true, value: requestMode });
  }
  if (destination !== undefined) {
    Object.defineProperty(request, 'destination', { configurable: true, value: destination });
  }
  const event = {
    request,
    clientId: clientId ?? '',
    resultingClientId: resultingClientId ?? '',
    respondWith(p: Promise<Response>): void {
      response = p;
    },
  };
  for (const fn of fetchListeners) fn(event);
  return { responded: response !== undefined, response };
}

function makeMockScope(clients: MockClient[]): MockScope {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    clients: {
      matchAll: vi.fn(async () => clients),
      get: vi.fn(async (id: string) => clients.find((c) => c.id === id)),
    },
    location: { origin: 'http://x' },
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
    async fetch(url, init): Promise<Response> {
      const dispatch = dispatchFetchEvent(this, url, init);
      if (!dispatch.response) throw new Error('respondWith never called');
      return dispatch.response;
    },
    postMessage(data, source): void {
      const messageListeners = listeners.message ?? [];
      const event = { data, source };
      for (const fn of messageListeners) fn(event);
    },
  };
}

async function flushPreviewDispatch(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

describe('SW-side handshake state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues fetch until the client posts ready, then dispatches', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const hooks: MessageHandlerHooks = { timeoutMs: 3_000 };
    const interceptor = createPreviewInterceptor(
      scope as unknown as ServiceWorkerGlobalScope,
      hooks,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    await Promise.resolve();
    // Before the ready handshake the SW must NOT dispatch.
    expect(client.postMessage).not.toHaveBeenCalled();
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      client,
    );
    await flushPreviewDispatch();
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = client.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    interceptor.teardown();
  });

  it('responds 503 with the precise timeout message if ready never arrives', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('preview-bridge not ready within 3000ms');
    expect(client.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('drops a client from the ready set on goodbye', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      client,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_GOODBYE,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      client,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    interceptor.teardown();
  });

  it('refuses requests from a frame-version-mismatched client', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      { type: SW_PREVIEW_READY, frameVersion: '999', routingVersion: SW_ROUTING_VERSION },
      client,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('protocol version mismatch');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const r2 = await scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    expect(r2.status).toBe(503);
    // A second mismatched ready frame from the same client should not re-warn.
    scope.postMessage(
      { type: SW_PREVIEW_READY, frameVersion: '999', routingVersion: SW_ROUTING_VERSION },
      client,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    interceptor.teardown();
  });

  it('refuses requests from a routing-version-mismatched client (frame matches)', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    // Frame version is fine; routing version drifts. Both must match for the
    // ready frame to count — otherwise we'd silently honour a peer that
    // disagrees on URL shape or owner-fallback rules (ADR-0040).
    scope.postMessage(
      { type: SW_PREVIEW_READY, frameVersion: SW_FRAME_VERSION, routingVersion: '999' },
      client,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('protocol version mismatch');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning must spell out *which* contract drifted so a host can
    // distinguish a fresh SW + stale page (frame) from a misconfigured
    // `@riftydev/io` import (routing).
    const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(warnMessage).toContain('routing');
    warnSpy.mockRestore();
    interceptor.teardown();
  });

  it('routes a fetch with event.clientId to that client, not matchAll()[0]', async () => {
    // Two ready clients. matchAll() returns A first; the fetch event names B.
    // The SW must route to B — picking matchAll()[0] would misroute. ADR-0031.
    const clientA = makeMockClient('client-A');
    const clientB = makeMockClient('client-B');
    const scope = makeMockScope([clientA, clientB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      clientA,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      clientB,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-B' });
    await flushPreviewDispatch();
    expect(clientA.postMessage).not.toHaveBeenCalled();
    expect(clientB.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = clientB.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    interceptor.teardown();
  });

  it('routes worker-owned ports directly to the Worker even when a window bridge is ready', async () => {
    const windowClient = makeMockClient('window-A');
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([windowClient, workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ownerToken: 'owner-A',
      },
      windowClient,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [3000],
        ownerToken: 'owner-A',
      },
      workerClient,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', {
      clientId: 'window-A',
    });
    await flushPreviewDispatch();
    expect(windowClient.postMessage).not.toHaveBeenCalled();
    expect(workerClient.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = workerClient.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('routes a copied top-level preview URL to the window that advertised the port, not an arbitrary ready window', async () => {
    // Two ready windows. matchAll() returns B first; only A advertised port
    // 5174. The SW must route to A — picking matchAll()[0] (B) is the misroute
    // ADR-0160 closes (window owners are now port-keyed for falsy-clientId
    // preview traffic).
    const windowB = makeMockClient('window-B');
    const windowA = makeMockClient('window-A');
    const scope = makeMockScope([windowB, windowA]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [8080],
      },
      windowB,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
      },
      windowA,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'fresh-tab',
    });
    await flushPreviewDispatch();
    expect(windowB.postMessage).not.toHaveBeenCalled();
    expect(windowA.postMessage).toHaveBeenCalledTimes(1);
    const call = windowA.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number } };
    expect(message.request?.port).toBe(5174);
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('returns 503 when a ready window advertised other ports but not the requested one', async () => {
    const windowClient = makeMockClient('window-A');
    const scope = makeMockScope([windowClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
      },
      windowClient,
    );

    const responsePromise = scope.fetch('http://x/preview/4173/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'fresh-tab',
    });
    await flushPreviewDispatch();
    expect(windowClient.postMessage).not.toHaveBeenCalled();
    expect((await responsePromise).status).toBe(503);
    interceptor.teardown();
  });

  it('returns 503 for a bare page fetch when the page has not advertised that port', async () => {
    const windowClient = makeMockClient('window-A');
    const scope = makeMockScope([windowClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
      },
      windowClient,
    );

    const responsePromise = scope.fetch('http://x/preview/4173/', {
      clientId: 'window-A',
      destination: '',
    });
    await flushPreviewDispatch();
    expect(windowClient.postMessage).not.toHaveBeenCalled();
    expect((await responsePromise).status).toBe(503);
    interceptor.teardown();
  });

  it('returns 503 when multiple ready windows advertise the same port (isolation)', async () => {
    // Both windows advertise port 5174 — ambiguous, so route-preview 503s
    // before picking either, symmetric with the multi-worker isolation
    // (ADR-0123, now extended to windows by ADR-0160).
    const windowA = makeMockClient('window-A');
    const windowB = makeMockClient('window-B');
    const scope = makeMockScope([windowA, windowB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    for (const w of [windowA, windowB]) {
      scope.postMessage(
        {
          type: SW_PREVIEW_READY,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          ports: [5174],
        },
        w,
      );
    }

    const response = await scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'fresh-tab',
    });
    expect(response.status).toBe(503);
    expect(windowA.postMessage).not.toHaveBeenCalled();
    expect(windowB.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('routes to the sole ready window that advertised no ports (back-compat)', async () => {
    // Legacy page-owned dev mode posts ready with NO ports — the binding keeps
    // the legacy ready-preferring fallback (ADR-0160 keeps the no-ports path
    // unchanged).
    const windowClient = makeMockClient('window-A');
    const scope = makeMockScope([windowClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      windowClient,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'fresh-tab',
    });
    await flushPreviewDispatch();
    expect(windowClient.postMessage).toHaveBeenCalledTimes(1);
    const call = windowClient.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number } };
    expect(message.request?.port).toBe(5174);
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('rejects rifty:preview:ready from a clientId the SW served a preview document to (anti-hijack)', async () => {
    // A previewed app's window IS in the interceptor's previewFrameContexts map
    // (the SW served its /preview nav). Its ready frame must be rejected so it
    // cannot hijack the bridge (ADR-0160 anti-hijack, keyed on the SW-served-nav
    // fact, not client.url).
    const evil = makeMockClient('evil');
    const scope = makeMockScope([evil]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // FIRST: a preview navigation served to `evil` records it as a
    // preview-document client. No owner yet, so it never resolves — do NOT
    // await it.
    scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'evil',
    });
    await flushPreviewDispatch();

    // THEN: evil tries to become the bridge owner for port 5174.
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
      },
      evil,
    );

    // A fresh preview fetch must NOT route to evil (its ready was rejected) and
    // must 503 — no legit ready owner exists. Evil is never port-keyed and is
    // not in the ready set, so route-preview can only fall through to the
    // unready-window path and 503 on the handshake timeout.
    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'other',
    });
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(evil.postMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    interceptor.teardown();
  });

  it('keeps rejecting ready from an evicted-but-live preview-document client (anti-hijack survives frame-context eviction)', async () => {
    // ADR-0160: the anti-hijack membership must NOT depend on the routing
    // frame-context LRU (cap 256, insertion-order eviction). Evict `evil` from
    // that LRU with unrelated preview navigations, then let `evil` — still a
    // live client — post ready. It must STILL be rejected; otherwise eviction
    // re-exposes the hijack (preview-owner-window-auth residual).
    const evil = makeMockClient('evil');
    const scope = makeMockScope([evil]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // SW serves `evil` a preview document — records it as a preview-document client.
    void scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'evil',
    });
    // Evict `evil` from the routing frame-context LRU (cap 256) with unrelated navs.
    for (let i = 0; i < 260; i += 1) {
      void scope.fetch('http://x/preview/5174/', {
        requestMode: 'navigate',
        destination: 'document',
        resultingClientId: `tab-${i}`,
      });
    }
    await flushPreviewDispatch();

    // `evil` tries to claim the bridge after eviction.
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
      },
      evil,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'probe',
    });
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(evil.postMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    interceptor.teardown();
  });

  it('does not let a Worker claim the same port for another window owner', async () => {
    const windowA = makeMockClient('window-A');
    const windowB = makeMockClient('window-B');
    const workerB = makeMockClient('worker-B', 'worker');
    const scope = makeMockScope([windowA, windowB, workerB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ownerToken: 'owner-A',
      },
      windowA,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ownerToken: 'owner-B',
      },
      windowB,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [3000],
        ownerToken: 'owner-B',
      },
      workerB,
    );

    const responsePromise = scope.fetch('http://x/preview/3000/path', {
      clientId: 'window-A',
    });
    await flushPreviewDispatch();

    expect(workerB.postMessage).not.toHaveBeenCalled();
    expect(windowA.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = windowA.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('falls back to the window bridge when no Worker owns the requested port', async () => {
    const windowClient = makeMockClient('window-A');
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([windowClient, workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      windowClient,
    );
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5173],
        ownerToken: 'owner-A',
      },
      workerClient,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', {
      clientId: 'window-A',
    });
    await flushPreviewDispatch();
    expect(workerClient.postMessage).not.toHaveBeenCalled();
    expect(windowClient.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = windowClient.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('does not treat an unclaimed Worker clientId as the window fallback owner', async () => {
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5173],
        ownerToken: 'owner-A',
      },
      workerClient,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/path', {
      clientId: 'worker-A',
    });
    await flushPreviewDispatch();
    expect(workerClient.postMessage).not.toHaveBeenCalled();
    expect((await responsePromise).status).toBe(503);
    interceptor.teardown();
  });

  it('routes a copied top-level preview URL to the only Worker claiming that port', async () => {
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      },
      workerClient,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'preview-tab',
    });
    await flushPreviewDispatch();
    expect(workerClient.postMessage).toHaveBeenCalledTimes(1);
    const call = workerClient.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/');
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<div id="app">direct preview</div>'),
    });
    expect(await (await responsePromise).text()).toContain('direct preview');
    interceptor.teardown();
  });

  it('routes copied top-level preview subresources to the only Worker claiming that port', async () => {
    const previewTab = makeMockClient('preview-tab');
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([previewTab, workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      },
      workerClient,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/src/main.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'preview-tab',
    });
    await flushPreviewDispatch();
    expect(previewTab.postMessage).not.toHaveBeenCalled();
    expect(workerClient.postMessage).toHaveBeenCalledTimes(1);
    const call = workerClient.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/src/main.js');
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('document.getElementById("app").textContent = "direct"'),
    });
    expect(await (await responsePromise).text()).toContain('direct');
    interceptor.teardown();
  });

  it('routes preview-prefixed requests from a known top-level preview client even without destination', async () => {
    const previewTab = makeMockClient('preview-tab');
    const workerClient = makeMockClient('worker-A', 'worker');
    const scope = makeMockScope([previewTab, workerClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      },
      workerClient,
    );

    const documentResponse = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'preview-tab',
    });
    await flushPreviewDispatch();
    let call = workerClient.postMessage.mock.calls[0]!;
    let replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<script type="module" src="src/main.js"></script>'),
    });
    expect((await documentResponse).status).toBe(200);

    const scriptResponse = scope.fetch('http://x/preview/5174/src/main.js', {
      requestMode: 'cors',
      destination: '',
      clientId: 'preview-tab',
    });
    await flushPreviewDispatch();
    expect(previewTab.postMessage).not.toHaveBeenCalled();
    expect(workerClient.postMessage).toHaveBeenCalledTimes(2);
    call = workerClient.postMessage.mock.calls[1]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/src/main.js');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('document.getElementById("app").textContent = "direct"'),
    });
    expect(await (await scriptResponse).text()).toContain('direct');
    interceptor.teardown();
  });

  it('routes copied top-level preview URLs through a ready playground window before an unready preview tab', async () => {
    const previewTab = makeMockClient('preview-tab');
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([previewTab, pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ownerToken: 'owner-A',
      },
      pageClient,
    );

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'preview-tab',
    });
    await flushPreviewDispatch();
    expect(previewTab.postMessage).not.toHaveBeenCalled();
    expect(pageClient.postMessage).toHaveBeenCalledTimes(1);
    const call = pageClient.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/');
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<div id="app">page proxy</div>'),
    });
    expect(await (await responsePromise).text()).toContain('page proxy');
    interceptor.teardown();
  });

  it('does not route a copied top-level preview URL when multiple Workers claim the same port', async () => {
    const workerA = makeMockClient('worker-A', 'worker');
    const workerB = makeMockClient('worker-B', 'worker');
    const scope = makeMockScope([workerA, workerB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    for (const [worker, ownerToken] of [
      [workerA, 'owner-A'],
      [workerB, 'owner-B'],
    ] as const) {
      scope.postMessage(
        {
          type: SW_PREVIEW_READY,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          ports: [5174],
          ownerToken,
        },
        worker,
      );
    }

    const response = await scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'preview-tab',
    });
    expect(response.status).toBe(503);
    expect(workerA.postMessage).not.toHaveBeenCalled();
    expect(workerB.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('does not route a copied top-level preview URL through an arbitrary ready window when multiple Workers claim the same port', async () => {
    const previewTab = makeMockClient('preview-tab');
    const pageA = makeMockClient('page-A');
    const pageB = makeMockClient('page-B');
    const workerA = makeMockClient('worker-A', 'worker');
    const workerB = makeMockClient('worker-B', 'worker');
    const scope = makeMockScope([previewTab, pageA, pageB, workerA, workerB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    for (const [client, ownerToken, ports] of [
      [pageA, 'owner-A', undefined],
      [pageB, 'owner-B', undefined],
      [workerA, 'owner-A', [5174]],
      [workerB, 'owner-B', [5174]],
    ] as const) {
      scope.postMessage(
        {
          type: SW_PREVIEW_READY,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          ownerToken,
          ...(ports ? { ports } : {}),
        },
        client,
      );
    }

    const response = await scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'document',
      resultingClientId: 'preview-tab',
    });
    expect(response.status).toBe(503);
    expect(pageA.postMessage).not.toHaveBeenCalled();
    expect(pageB.postMessage).not.toHaveBeenCalled();
    expect(workerA.postMessage).not.toHaveBeenCalled();
    expect(workerB.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('keeps embedded iframe preview routing owner-scoped when multiple Workers claim the same port', async () => {
    const pageA = makeMockClient('page-A');
    const pageB = makeMockClient('page-B');
    const workerA = makeMockClient('worker-A', 'worker');
    const workerB = makeMockClient('worker-B', 'worker');
    const iframe = makeMockClient('iframe-A');
    const scope = makeMockScope([pageA, pageB, workerA, workerB, iframe]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    for (const [client, ownerToken, ports] of [
      [pageA, 'owner-A', undefined],
      [pageB, 'owner-B', undefined],
      [workerA, 'owner-A', [5174]],
      [workerB, 'owner-B', [5174]],
    ] as const) {
      scope.postMessage(
        {
          type: SW_PREVIEW_READY,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          ownerToken,
          ...(ports ? { ports } : {}),
        },
        client,
      );
    }

    const responsePromise = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'iframe-A',
    });
    await flushPreviewDispatch();
    expect(pageA.postMessage).not.toHaveBeenCalled();
    expect(pageB.postMessage).not.toHaveBeenCalled();
    expect(workerB.postMessage).not.toHaveBeenCalled();
    expect(workerA.postMessage).toHaveBeenCalledTimes(1);
    const call = workerA.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/');
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<div id="app">embedded</div>'),
    });
    expect(await (await responsePromise).text()).toContain('embedded');
    interceptor.teardown();
  });

  it('routes iframe document navigations to the controlling window, not resultingClientId', async () => {
    const owner = makeMockClient('window-A');
    const iframe = makeMockClient('iframe-client');
    const scope = makeMockScope([owner, iframe]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      owner,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'iframe-client',
    });
    await flushPreviewDispatch();
    expect(iframe.postMessage).not.toHaveBeenCalled();
    expect(owner.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = owner.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('routes iframe subresources to the controlling window, not iframe clientId', async () => {
    const owner = makeMockClient('window-A');
    const iframe = makeMockClient('iframe-client');
    const scope = makeMockScope([owner, iframe]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      owner,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/src/main.js', {
      clientId: 'iframe-client',
      destination: 'script',
    });
    await flushPreviewDispatch();
    expect(iframe.postMessage).not.toHaveBeenCalled();
    expect(owner.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = owner.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('keeps bare page fetch routing on the named client instead of first window fallback', async () => {
    const clientA = makeMockClient('client-A');
    const clientB = makeMockClient('client-B');
    const scope = makeMockScope([clientA, clientB]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    for (const client of [clientA, clientB]) {
      scope.postMessage(
        {
          type: SW_PREVIEW_READY,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
        },
        client,
      );
    }
    const responsePromise = scope.fetch('http://x/preview/3000/', {
      clientId: 'client-B',
      destination: '',
    });
    await flushPreviewDispatch();
    expect(clientA.postMessage).not.toHaveBeenCalled();
    expect(clientB.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = clientB.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await responsePromise).status).toBe(200);
    interceptor.teardown();
  });

  it('routes root-relative subresources from a preview iframe to the iframe port', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const navResponse = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    expect(pageClient.postMessage).toHaveBeenCalledTimes(1);
    let call = pageClient.postMessage.mock.calls[0]!;
    let message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/');
    let replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await navResponse).status).toBe(200);

    const scriptResponse = scope.fetch('http://x/src/main.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    expect(pageClient.postMessage).toHaveBeenCalledTimes(2);
    call = pageClient.postMessage.mock.calls[1]!;
    message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/src/main.js');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('console.log("preview script")'),
    });
    const response = await scriptResponse;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('console.log("preview script")');
    interceptor.teardown();
  });

  it('lets same-origin non-preview page assets fall through without respondWith', () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });

    const dispatch = dispatchFetchEvent(scope, 'http://x/assets/editor.worker.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'page-client',
    });

    expect(dispatch.responded).toBe(false);
    expect(scope.clients.get).not.toHaveBeenCalled();
    expect(pageClient.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('does not route cross-origin requests from a mapped preview iframe', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const navResponse = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    const call = pageClient.postMessage.mock.calls[0]!;
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await navResponse).status).toBe(200);

    await expect(
      scope.fetch('https://api.example.com/v1/me', {
        requestMode: 'cors',
        destination: '',
        clientId: 'preview-frame-1',
      }),
    ).rejects.toThrow('respondWith never called');
    expect(pageClient.postMessage).toHaveBeenCalledTimes(1);
    interceptor.teardown();
  });

  it('does not let cross-port preview subresources rebind an iframe root-relative context', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const initialResponse = scope.fetch('http://x/preview/5173/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    let call = pageClient.postMessage.mock.calls[0]!;
    let replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await initialResponse).status).toBe(200);

    const crossPortResponse = scope.fetch('http://x/preview/3000/api/ping', {
      requestMode: 'cors',
      destination: '',
      clientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[1]!;
    let message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(3000);
    expect(message.request?.url).toBe('http://localhost:3000/api/ping');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await crossPortResponse).status).toBe(200);

    const rootRelativeResponse = scope.fetch('http://x/src/main.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[2]!;
    message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5173);
    expect(message.request?.url).toBe('http://localhost:5173/src/main.js');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('console.log("root")'),
    });
    expect(await (await rootRelativeResponse).text()).toBe('console.log("root")');
    interceptor.teardown();
  });

  it('does not let page-owned preview subresources poison the page client context', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const imageResponse = scope.fetch('http://x/preview/5174/logo.png', {
      requestMode: 'no-cors',
      destination: 'image',
      clientId: 'page-client',
    });
    await flushPreviewDispatch();
    const call = pageClient.postMessage.mock.calls[0]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/logo.png');
    const replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect((await imageResponse).status).toBe(200);

    const dispatch = dispatchFetchEvent(scope, 'http://x/assets/monaco.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'page-client',
    });
    expect(dispatch.responded).toBe(false);
    expect(pageClient.postMessage).toHaveBeenCalledTimes(1);
    interceptor.teardown();
  });

  it('routes root-relative fetches and navigations from a preview iframe to the iframe port', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const initialResponse = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'iframe',
      resultingClientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    let call = pageClient.postMessage.mock.calls[0]!;
    let replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await initialResponse).status).toBe(200);

    const apiResponse = scope.fetch('http://x/api/config', {
      requestMode: 'cors',
      destination: '',
      clientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[1]!;
    let message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/api/config');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode('{"ok":true}'),
    });
    expect(await (await apiResponse).text()).toBe('{"ok":true}');

    const navResponse = scope.fetch('http://x/dashboard', {
      requestMode: 'navigate',
      destination: 'document',
      clientId: 'preview-frame-1',
      resultingClientId: 'preview-frame-2',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[2]!;
    message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/dashboard');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<div>dashboard</div>'),
    });
    expect(await (await navResponse).text()).toBe('<div>dashboard</div>');

    const chunkResponse = scope.fetch('http://x/assets/chunk.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'preview-frame-2',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[3]!;
    message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/assets/chunk.js');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('export default 1'),
    });
    expect(await (await chunkResponse).text()).toBe('export default 1');
    interceptor.teardown();
  });

  it('recovers preview port context from referrer after an iframe reload changes client id', async () => {
    const pageClient = makeMockClient('page-client');
    const scope = makeMockScope([pageClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const reloadResponse = scope.fetch('http://x/preview/5174/', {
      requestMode: 'navigate',
      destination: 'iframe',
      clientId: 'preview-frame-1',
    });
    await flushPreviewDispatch();
    let call = pageClient.postMessage.mock.calls[0]!;
    let replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    expect((await reloadResponse).status).toBe(200);

    const scriptResponse = scope.fetch('http://x/src/main.js', {
      requestMode: 'cors',
      destination: 'script',
      referrer: 'http://x/preview/5174/',
      clientId: 'preview-frame-2',
    });
    await flushPreviewDispatch();
    call = pageClient.postMessage.mock.calls[1]!;
    const message = call[0] as { request?: { port: number; url: string } };
    expect(message.request?.port).toBe(5174);
    expect(message.request?.url).toBe('http://localhost:5174/src/main.js');
    replyPort = (call[1] as MessagePort[])[0]!;
    replyPort.postMessage({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/javascript' },
      body: new TextEncoder().encode('console.log("after reload")'),
    });
    expect(await (await scriptResponse).text()).toBe('console.log("after reload")');
    interceptor.teardown();
  });

  it('does not recover preview port context from client url without referrer or known context', () => {
    const pageClient = makeMockClient('page-client');
    const frameClient = makeMockClient('preview-frame-2', 'window', 'http://x/preview/5174/');
    const scope = makeMockScope([pageClient, frameClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const dispatch = dispatchFetchEvent(scope, 'http://x/src/main.js', {
      requestMode: 'cors',
      destination: 'script',
      clientId: 'preview-frame-2',
    });

    expect(dispatch.responded).toBe(false);
    expect(scope.clients.get).not.toHaveBeenCalled();
    expect(pageClient.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });

  it('lets root-relative fetches with only a preview client url fall through', () => {
    const pageClient = makeMockClient('page-client');
    const frameClient = makeMockClient('preview-frame-2', 'window', 'http://x/preview/5174/');
    const scope = makeMockScope([pageClient, frameClient]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      pageClient,
    );

    const dispatch = dispatchFetchEvent(scope, 'http://x/api/config', {
      requestMode: 'cors',
      destination: '',
      clientId: 'preview-frame-2',
    });

    expect(dispatch.responded).toBe(false);
    expect(scope.clients.get).not.toHaveBeenCalled();
    expect(pageClient.postMessage).not.toHaveBeenCalled();
    interceptor.teardown();
  });
});

describe('SW-side body serialization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advertises content-length on serialized POST bodies', async () => {
    // fetch Request headers NEVER expose content-length (the network layer
    // adds it on the wire); without re-deriving it from the drained bytes the
    // worker-side server sees a length-less POST and body parsers
    // (express.json's typeis.hasBody) silently skip the body.
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      client,
    );
    const payload = JSON.stringify({ title: 'from the bridge' });
    const responsePromise = scope.fetch('http://x/preview/3000/api/todos', {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
      clientId: 'client-A',
    });
    // Body drain (request.arrayBuffer) may resolve via a FAKED timer on some
    // Node versions — advance fake time between microtask flushes.
    await flushPreviewDispatch();
    await vi.advanceTimersByTimeAsync(50);
    await flushPreviewDispatch();
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    const [message, transfer] = client.postMessage.mock.calls[0]!;
    const { request } = message as {
      request: { url: string; headers: Record<string, string>; body: Uint8Array | null };
    };
    const expectedLength = new TextEncoder().encode(payload).byteLength;
    expect(request.url).toBe('http://localhost:3000/api/todos');
    expect(request.body?.byteLength).toBe(expectedLength);
    expect(request.headers['content-length']).toBe(String(expectedLength));
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 201, statusText: 'Created', headers: {}, body: null });
    await responsePromise;
    interceptor.teardown();
  });

  it('does not override an explicitly forwarded content-length', async () => {
    const client = makeMockClient('client-A');
    const scope = makeMockScope([client]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    scope.postMessage(
      {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      client,
    );
    const responsePromise = scope.fetch('http://x/preview/3000/api/todos', {
      method: 'POST',
      body: 'abc',
      headers: { 'content-type': 'text/plain', 'content-length': '3' },
      clientId: 'client-A',
    });
    await flushPreviewDispatch();
    await vi.advanceTimersByTimeAsync(50);
    await flushPreviewDispatch();
    const [message, transfer] = client.postMessage.mock.calls[0]!;
    const { request } = message as { request: { headers: Record<string, string> } };
    expect(request.headers['content-length']).toBe('3');
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 201, statusText: 'Created', headers: {}, body: null });
    await responsePromise;
    interceptor.teardown();
  });
});
