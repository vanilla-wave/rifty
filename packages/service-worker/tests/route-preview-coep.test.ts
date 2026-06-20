/**
 * Phase 1 of cross-tab-preview-routing: every preview ERROR response (503/502)
 * must carry CORP+COEP just like the success path, or a foreign tab embedding
 * the preview under page COEP credentialless (D-001) sees
 * ERR_BLOCKED_BY_RESPONSE instead of an honest 503 page.
 *
 * Mirrors the mock SW harness in `preview-handshake-sw.test.ts`: no ready owner
 * → route-preview 503s on the handshake timeout. The error response must expose
 * the same Cross-Origin-Embedder-Policy + Cross-Origin-Resource-Policy headers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewInterceptor } from '../src/preview-bridge.ts';

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
  fetch: (url: string, init?: { clientId?: string }) => Promise<Response>;
  postMessage: (data: unknown, source: MockClient) => void;
}

function dispatchFetchEvent(
  scope: MockScope,
  url: string,
  init?: { clientId?: string },
): Promise<Response> | undefined {
  const fetchListeners = scope.listeners.fetch ?? [];
  let response: Promise<Response> | undefined;
  const { clientId, ...requestInit } = init ?? {};
  const request = new Request(url, requestInit);
  const event = {
    request,
    clientId: clientId ?? '',
    resultingClientId: '',
    respondWith(p: Promise<Response>): void {
      response = p;
    },
  };
  for (const fn of fetchListeners) fn(event);
  return response;
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
      const response = dispatchFetchEvent(this, url, init);
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

describe('preview error responses carry CORP + COEP', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('503 (no ready owner) response sets COEP credentialless + CORP cross-origin', async () => {
    // No ready owner: the named client never posts rifty:preview:ready, so
    // route-preview 503s on the handshake timeout. A foreign tab loading this
    // 503 under page COEP credentialless must NOT get ERR_BLOCKED_BY_RESPONSE.
    const scope = makeMockScope([{ id: 'client-A', type: 'window', postMessage: vi.fn() }]);
    const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    const responsePromise = scope.fetch('http://x/preview/3000/path', { clientId: 'client-A' });
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    interceptor.teardown();
  });
});
