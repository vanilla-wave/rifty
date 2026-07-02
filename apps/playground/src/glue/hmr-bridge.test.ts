/**
 * Unit tests for the cross-realm HMR bridge (ADR-0017 phase 1) — mini-dev's
 * explicit broadcaster half only. The vite plugin/client-script half died with
 * ADR-0189 (the preview path injects the generic bridge into every text/html
 * response; stock vite HMR rides it).
 *
 * These tests prove the wiring contract:
 *   1. `setupHmrBridge` exposes the ordinary WebSocketServer surface that a
 *      cross-realm client can connect to using `hmrBridgeUrl(port)`.
 *   2. `broadcast()` from the page side reaches the client.
 */
import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { BridgedWebSocket } from '@riftydev/net';
import { describe, expect, it } from 'vitest';
import {
  createHmrBridgeToken,
  hmrBridgeUrl,
  hmrClientScript,
  setupHmrBridge,
} from './hmr-bridge.ts';

describe('hmrBridgeUrl', () => {
  it('returns a deterministic ws URL keyed by port', () => {
    expect(hmrBridgeUrl(3000)).toBe(`ws://${PREVIEW_LOCAL_HOST}:3000/__hmr`);
    expect(hmrBridgeUrl(5174)).toBe(`ws://${PREVIEW_LOCAL_HOST}:5174/__hmr`);
  });

  it('scopes the ws URL by nonce when supplied', () => {
    expect(hmrBridgeUrl(3000, 'nonce-1')).toBe(`ws://${PREVIEW_LOCAL_HOST}:3000/__hmr/nonce-1`);
    expect(hmrBridgeUrl(3000, 'nonce-1')).not.toBe(hmrBridgeUrl(3000));
  });
});

describe('setupHmrBridge', () => {
  it('creates per-server tokens for HMR bridge channels', () => {
    expect(createHmrBridgeToken()).not.toBe(createHmrBridgeToken());
  });

  it('accepts a BridgedWebSocket client on the per-port channel', async () => {
    const bridge = setupHmrBridge({ port: 3100 });
    try {
      const client = new BridgedWebSocket(bridge.url);
      await new Promise<void>((resolve) =>
        client.addEventListener('open', () => resolve(), { once: true }),
      );
      expect(client.readyState).toBe(BridgedWebSocket.OPEN);
      client.close();
    } finally {
      bridge.close();
    }
  });

  it('broadcasts payloads to every connected iframe HMR client', async () => {
    const bridge = setupHmrBridge({ port: 3101 });
    try {
      const c1 = new BridgedWebSocket(bridge.url);
      const c2 = new BridgedWebSocket(bridge.url);
      await Promise.all([
        new Promise<void>((r) => c1.addEventListener('open', () => r(), { once: true })),
        new Promise<void>((r) => c2.addEventListener('open', () => r(), { once: true })),
      ]);

      const seen1: string[] = [];
      const seen2: string[] = [];
      c1.addEventListener('message', (e) => seen1.push(String((e as MessageEvent).data)));
      c2.addEventListener('message', (e) => seen2.push(String((e as MessageEvent).data)));

      bridge.broadcast(JSON.stringify({ type: 'update', path: '/src/main.js' }));
      await new Promise((r) => setTimeout(r, 20));

      expect(seen1).toEqual([JSON.stringify({ type: 'update', path: '/src/main.js' })]);
      expect(seen2).toEqual([JSON.stringify({ type: 'update', path: '/src/main.js' })]);

      c1.close();
      c2.close();
    } finally {
      bridge.close();
    }
  });

  it('does not expose a tokenized bridge on the predictable port-only channel', () => {
    const bridge = setupHmrBridge({ port: 3102, token: 'secret' });
    try {
      expect(bridge.url).toBe(hmrBridgeUrl(3102, 'secret'));
      expect(bridge.url).not.toBe(hmrBridgeUrl(3102));
    } finally {
      bridge.close();
    }
  });

  it('opens the same HMR URL from the iframe client script', () => {
    const port = 4200;
    const script = hmrClientScript(port, 'shared');
    expect(script).toContain(`new WebSocket(${JSON.stringify(hmrBridgeUrl(port, 'shared'))})`);
    expect(script).toContain('__riftyWebSocketBridgeInstalled');
  });
});

describe('hmrClientScript', () => {
  it('produces valid JS (parses without SyntaxError)', () => {
    const script = hmrClientScript(3300);
    // new Function throws SyntaxError on invalid source.
    expect(() => new Function(script)).not.toThrow();
  });

  it('installs the generic WebSocket bridge and opens the HMR URL', () => {
    const script = hmrClientScript(3301);
    expect(script).toContain('__riftyWebSocketBridgeInstalled');
    expect(script).toContain(`new WebSocket(${JSON.stringify(hmrBridgeUrl(3301))})`);
  });

  it('keeps mini-dev reload semantics out of the generic bridge shim', () => {
    const script = hmrClientScript(3302);
    expect(script).toContain('location.reload()');
    expect(script).toContain('var eventPrefix = "rifty:hmr"');
  });
});
