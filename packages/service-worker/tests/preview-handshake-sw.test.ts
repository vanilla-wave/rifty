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
  postMessage: ReturnType<typeof vi.fn>;
}

interface MockScope {
  clients: { matchAll: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  listeners: Record<string, ((event: unknown) => void)[]>;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  fetch: (url: string, init?: RequestInit & { clientId?: string }) => Promise<Response>;
  postMessage: (data: unknown, source: MockClient) => void;
}

function makeMockClient(id: string): MockClient {
  return {
    id,
    postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>(),
  };
}

function makeMockScope(clients: MockClient[]): MockScope {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    clients: {
      matchAll: vi.fn(async () => clients),
      get: vi.fn(async (id: string) => clients.find((c) => c.id === id)),
    },
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
      const fetchListeners = listeners.fetch ?? [];
      let response: Promise<Response> | undefined;
      const { clientId, ...requestInit } = init ?? {};
      const event = {
        request: new Request(url, requestInit),
        clientId: clientId ?? '',
        resultingClientId: '',
        respondWith(p: Promise<Response>): void {
          response = p;
        },
      };
      for (const fn of fetchListeners) fn(event);
      if (!response) throw new Error('respondWith never called');
      return response;
    },
    postMessage(data, source): void {
      const messageListeners = listeners.message ?? [];
      const event = { data, source };
      for (const fn of messageListeners) fn(event);
    },
  };
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
    await Promise.resolve();
    await Promise.resolve();
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(clientA.postMessage).not.toHaveBeenCalled();
    expect(clientB.postMessage).toHaveBeenCalledTimes(1);
    const [, transfer] = clientB.postMessage.mock.calls[0]!;
    const replyPort = (transfer as MessagePort[])[0]!;
    replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    interceptor.teardown();
  });
});
