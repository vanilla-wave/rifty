/**
 * Tests for the main-thread side of the preview-bridge handshake — verifying
 * that `setupPreviewBridge`:
 *   1. posts `rifty:preview:ready` (with both frame and routing versions) to
 *      the active SW controller on init, and `rifty:preview:goodbye` on
 *      teardown;
 *   2. stamps both versions onto outgoing response frames the SW will
 *      consume;
 *   3. rejects mismatched frame OR routing version independently (ADR-0040).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInterceptor, setupPreviewBridge } from '../src/preview-bridge.ts';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_PREVIEW_REQUEST,
  SW_ROUTING_VERSION,
} from '../src/protocol.ts';

interface MockSwClient {
  id: string;
  type: ClientTypes;
  postMessage: ReturnType<typeof vi.fn>;
}

interface MockSwScope {
  clients: { matchAll: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  listeners: Record<string, ((event: unknown) => void)[]>;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  fetch: (url: string, init?: RequestInit & { clientId?: string }) => Promise<Response>;
  postMessage: (data: unknown, source: MockSwClient) => void;
}

function makeSwScope(clients: MockSwClient[]): MockSwScope {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    clients: {
      matchAll: vi.fn(async (opts?: { type?: ClientTypes }) => {
        if (!opts?.type) return clients;
        return clients.filter((c) => c.type === opts.type);
      }),
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
      for (const fn of listeners.message ?? []) fn({ data, source });
    },
  };
}

function installNavigator(): {
  setController: (controller: { postMessage: ReturnType<typeof vi.fn> }) => void;
  controller: { postMessage: ReturnType<typeof vi.fn> };
  listeners: Record<string, ((event: unknown) => void)[]>;
  restore: () => void;
} {
  const controller = {
    postMessage: vi.fn<(message: unknown, transfer?: Transferable[]) => void>(),
  };
  let currentController = controller;
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const sw = {
    get controller(): { postMessage: ReturnType<typeof vi.fn> } {
      return currentController;
    },
    addEventListener: vi.fn((type: string, fn: (event: unknown) => void) => {
      const arr = listeners[type] ?? [];
      arr.push(fn);
      listeners[type] = arr;
    }),
    removeEventListener: vi.fn((type: string, fn: (event: unknown) => void) => {
      const arr = listeners[type];
      if (arr) arr.splice(arr.indexOf(fn), 1);
    }),
  };
  const originalNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker: sw },
  });
  return {
    controller,
    setController(next): void {
      currentController = next;
    },
    listeners,
    restore(): void {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    },
  };
}

describe('main-thread setupPreviewBridge handshake', () => {
  it('posts rifty:preview:ready with frame+routing versions on init and goodbye on teardown', () => {
    const env = installNavigator();
    try {
      const teardown = setupPreviewBridge(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      expect(env.controller.postMessage).toHaveBeenCalledTimes(1);
      expect(env.controller.postMessage).toHaveBeenCalledWith({
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
      teardown();
      expect(env.controller.postMessage).toHaveBeenCalledTimes(2);
      expect(env.controller.postMessage).toHaveBeenNthCalledWith(2, {
        type: SW_PREVIEW_GOODBYE,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
    } finally {
      env.restore();
    }
  });

  it('reposts rifty:preview:ready when a new service worker takes control', () => {
    const env = installNavigator();
    try {
      const teardown = setupPreviewBridge(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      expect(env.controller.postMessage).toHaveBeenCalledTimes(1);
      const controllerChange = env.listeners.controllerchange?.[0];
      expect(controllerChange).toBeDefined();
      const nextController = {
        postMessage: vi.fn<(message: unknown, transfer?: Transferable[]) => void>(),
      };
      env.setController(nextController);
      controllerChange!({});
      expect(env.controller.postMessage).toHaveBeenCalledTimes(1);
      expect(nextController.postMessage).toHaveBeenCalledTimes(1);
      expect(nextController.postMessage).toHaveBeenCalledWith({
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
      teardown();
      // Teardown posts goodbye once and removes the controllerchange listener.
      expect(nextController.postMessage).toHaveBeenCalledTimes(2);
      expect(env.listeners.controllerchange ?? []).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('keeps advertising readiness so a restarted service worker global can rebuild state', () => {
    vi.useFakeTimers();
    const env = installNavigator();
    try {
      const teardown = setupPreviewBridge(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      expect(env.controller.postMessage).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(env.controller.postMessage).toHaveBeenCalledTimes(2);
      expect(env.controller.postMessage).toHaveBeenNthCalledWith(2, {
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
      teardown();
      vi.advanceTimersByTime(3_000);
      expect(env.controller.postMessage).toHaveBeenCalledTimes(3);
    } finally {
      env.restore();
      vi.useRealTimers();
    }
  });

  it('heartbeat repopulates a fresh SW interceptor registry after global restart', async () => {
    vi.useFakeTimers();
    const pageClient: MockSwClient = {
      id: 'page-A',
      type: 'window',
      postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>(),
    };
    let activeScope = makeSwScope([pageClient]);
    const controller = {
      postMessage: vi.fn((message: unknown) => {
        activeScope.postMessage(message, pageClient);
      }),
    };
    const env = installNavigator();
    env.setController(controller);
    let interceptor = createPreviewInterceptor(activeScope as unknown as ServiceWorkerGlobalScope, {
      timeoutMs: 3_000,
    });
    try {
      const teardown = setupPreviewBridge(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      try {
        expect(controller.postMessage).toHaveBeenCalledTimes(1);
        // Simulate browser restarting the SW global: old in-memory ready
        // registry disappears, page bridge remains mounted.
        interceptor.teardown();
        activeScope = makeSwScope([pageClient]);
        interceptor = createPreviewInterceptor(activeScope as unknown as ServiceWorkerGlobalScope, {
          timeoutMs: 3_000,
        });
        const responsePromise = activeScope.fetch('http://x/preview/3000/path', {
          clientId: 'page-A',
        });
        await Promise.resolve();
        expect(pageClient.postMessage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        await Promise.resolve();
        expect(pageClient.postMessage).toHaveBeenCalledTimes(1);
        const [, transfer] = pageClient.postMessage.mock.calls[0]!;
        const replyPort = (transfer as MessagePort[])[0]!;
        replyPort.postMessage({ status: 200, statusText: 'OK', headers: {}, body: null });
        expect((await responsePromise).status).toBe(200);
      } finally {
        teardown();
      }
    } finally {
      interceptor.teardown();
      env.restore();
      vi.useRealTimers();
    }
  });

  it('includes claimed ports and owner token on ready, heartbeat, controllerchange, and goodbye', () => {
    vi.useFakeTimers();
    const env = installNavigator();
    try {
      const teardown = setupPreviewBridge(
        async () => ({
          status: 200,
          statusText: 'OK',
          headers: {},
          body: null,
        }),
        { ports: [5174], ownerToken: 'owner-A' },
      );
      expect(env.controller.postMessage).toHaveBeenLastCalledWith({
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      });
      vi.advanceTimersByTime(1_000);
      expect(env.controller.postMessage).toHaveBeenLastCalledWith({
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      });
      env.listeners.controllerchange?.[0]?.({});
      expect(env.controller.postMessage).toHaveBeenLastCalledWith({
        type: SW_PREVIEW_READY,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      });
      teardown();
      expect(env.controller.postMessage).toHaveBeenLastCalledWith({
        type: SW_PREVIEW_GOODBYE,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        ports: [5174],
        ownerToken: 'owner-A',
      });
    } finally {
      env.restore();
      vi.useRealTimers();
    }
  });

  it('echoes both frame and routing versions in dispatched response frames', async () => {
    const env = installNavigator();
    try {
      let received: unknown = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e): void => {
        received = e.data;
      };
      const teardown = setupPreviewBridge(async () => ({
        status: 201,
        statusText: 'Created',
        headers: { 'x-test': '1' },
        body: new Uint8Array([1, 2, 3]),
      }));
      const messageFn = env.listeners.message?.[0];
      expect(messageFn).toBeDefined();
      messageFn!({
        data: {
          type: SW_PREVIEW_REQUEST,
          requestId: 1,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          request: { port: 3000, url: 'http://preview.local/', method: 'GET', headers: {} },
        },
        ports: [channel.port2],
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(received).toBeTruthy();
      const r = received as { status: number; frameVersion: string; routingVersion: string };
      expect(r.status).toBe(201);
      expect(r.frameVersion).toBe(SW_FRAME_VERSION);
      expect(r.routingVersion).toBe(SW_ROUTING_VERSION);
      channel.port1.close();
      channel.port2.close();
      teardown();
    } finally {
      env.restore();
    }
  });

  it('does not let a port-scoped bridge answer requests for another port', async () => {
    const env = installNavigator();
    try {
      let received: unknown = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e): void => {
        received = e.data;
      };
      const handler = vi.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      const teardown = setupPreviewBridge(handler, { ports: [5174] });
      const messageFn = env.listeners.message?.[0];
      expect(messageFn).toBeDefined();
      messageFn!({
        data: {
          type: SW_PREVIEW_REQUEST,
          requestId: 1,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: SW_ROUTING_VERSION,
          request: { port: 4173, url: 'http://preview.local/', method: 'GET', headers: {} },
        },
        ports: [channel.port2],
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(handler).not.toHaveBeenCalled();
      expect(received).toBeNull();
      channel.port1.close();
      channel.port2.close();
      teardown();
    } finally {
      env.restore();
    }
  });

  it('rejects a SW_PREVIEW_REQUEST with mismatched frame version without calling the handler', async () => {
    const env = installNavigator();
    try {
      let received: unknown = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e): void => {
        received = e.data;
      };
      const handler = vi.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      const teardown = setupPreviewBridge(handler);
      const messageFn = env.listeners.message?.[0];
      expect(messageFn).toBeDefined();
      messageFn!({
        data: {
          type: SW_PREVIEW_REQUEST,
          requestId: 1,
          frameVersion: '999',
          routingVersion: SW_ROUTING_VERSION,
          request: { port: 3000, url: 'http://preview.local/', method: 'GET', headers: {} },
        },
        ports: [channel.port2],
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(handler).not.toHaveBeenCalled();
      expect(received).toBeTruthy();
      const r = received as {
        error?: {
          kind?: string;
          expected?: { frame: string; routing: string };
          got?: { frame: string; routing: string };
        };
      };
      expect(r.error).toBeDefined();
      expect(r.error?.kind).toBe('PROTOCOL_VERSION_MISMATCH');
      expect(r.error?.expected).toEqual({
        frame: SW_FRAME_VERSION,
        routing: SW_ROUTING_VERSION,
      });
      expect(r.error?.got).toEqual({ frame: '999', routing: SW_ROUTING_VERSION });
      channel.port1.close();
      channel.port2.close();
      teardown();
    } finally {
      env.restore();
    }
  });

  it('rejects a SW_PREVIEW_REQUEST with mismatched routing version only (frame matches)', async () => {
    const env = installNavigator();
    try {
      let received: unknown = null;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e): void => {
        received = e.data;
      };
      const handler = vi.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: null,
      }));
      const teardown = setupPreviewBridge(handler);
      const messageFn = env.listeners.message?.[0];
      expect(messageFn).toBeDefined();
      messageFn!({
        data: {
          type: SW_PREVIEW_REQUEST,
          requestId: 1,
          frameVersion: SW_FRAME_VERSION,
          routingVersion: '999',
          request: { port: 3000, url: 'http://preview.local/', method: 'GET', headers: {} },
        },
        ports: [channel.port2],
      });
      await new Promise((r) => setTimeout(r, 5));
      expect(handler).not.toHaveBeenCalled();
      expect(received).toBeTruthy();
      const r = received as {
        error?: {
          kind?: string;
          expected?: { frame: string; routing: string };
          got?: { frame: string; routing: string };
        };
      };
      expect(r.error).toBeDefined();
      expect(r.error?.kind).toBe('PROTOCOL_VERSION_MISMATCH');
      expect(r.error?.expected).toEqual({
        frame: SW_FRAME_VERSION,
        routing: SW_ROUTING_VERSION,
      });
      expect(r.error?.got).toEqual({ frame: SW_FRAME_VERSION, routing: '999' });
      channel.port1.close();
      channel.port2.close();
      teardown();
    } finally {
      env.restore();
    }
  });
});
