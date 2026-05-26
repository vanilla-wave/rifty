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
import { setupPreviewBridge } from '../src/preview-bridge.ts';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_PREVIEW_REQUEST,
  SW_ROUTING_VERSION,
} from '../src/protocol.ts';

function installNavigator(): {
  controller: { postMessage: ReturnType<typeof vi.fn> };
  listeners: Record<string, ((event: unknown) => void)[]>;
  restore: () => void;
} {
  const controller = {
    postMessage: vi.fn<(message: unknown, transfer?: Transferable[]) => void>(),
  };
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const sw = {
    controller,
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
