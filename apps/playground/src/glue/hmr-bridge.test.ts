/**
 * Unit tests for the cross-realm HMR bridge (ADR-0017 phase 1).
 *
 * These tests prove the wiring contract:
 *   1. `setupHmrBridge` instantiates a `BridgedWebSocketServer` that a
 *      `BridgedWebSocket` client (representing the iframe HMR client) can
 *      connect to using `hmrBridgeUrl(port)` as the shared URL.
 *   2. `broadcast()` from the page side reaches the client.
 *   3. The Vite plugin `transformIndexHtml` injects the client script once
 *      (idempotent across reload cycles).
 *
 * The full browser HMR roundtrip is covered by the e2e spec
 * (`tests/e2e/m10-hmr.spec.ts`), which exercises the iframe-loaded HMR
 * client end-to-end. Here we run the bridge in a single Node realm — the
 * `BridgedWebSocket` client suffices to prove the wire format the inlined
 * iframe script speaks (both ride the same `BroadcastChannel`).
 */
import { BridgedWebSocket, channelNameFor } from '@riftydev/net';
import { describe, expect, it } from 'vitest';
import {
  createHmrBridgeVitePlugin,
  hmrBridgeUrl,
  hmrClientScript,
  setupHmrBridge,
} from './hmr-bridge.ts';

describe('hmrBridgeUrl', () => {
  it('returns a deterministic ws URL keyed by port', () => {
    expect(hmrBridgeUrl(3000)).toBe('ws://preview.local:3000/__hmr');
    expect(hmrBridgeUrl(5174)).toBe('ws://preview.local:5174/__hmr');
  });
});

describe('setupHmrBridge', () => {
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

  it('uses the same BroadcastChannel name the iframe client script would use', () => {
    // The wire-format check that protects the page ↔ iframe contract: the
    // server side derives its channel name from `hmrBridgeUrl(port)`, and the
    // inlined client script embeds the same channel name as a JSON-encoded
    // literal. If `channelNameFor` ever changes shape, this test breaks
    // before the iframe silently fails to connect in production.
    const port = 4200;
    const expectedChannel = channelNameFor(hmrBridgeUrl(port));
    const script = hmrClientScript(port);
    expect(script).toContain(JSON.stringify(expectedChannel));
  });
});

describe('createHmrBridgeVitePlugin', () => {
  it('injects the HMR client script before </body>', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3200 });
    const html = '<!doctype html><html><body><div id="app"></div></body></html>';
    const transformed = plugin.transformIndexHtml(html);
    expect(transformed).toContain('data-rifty-hmr-bridge');
    expect(transformed).toContain(channelNameFor(hmrBridgeUrl(3200)));
    // Body content preserved.
    expect(transformed).toContain('<div id="app"></div>');
    // Script lands inside the body, just before </body>.
    expect(transformed.indexOf('data-rifty-hmr-bridge')).toBeLessThan(
      transformed.indexOf('</body>'),
    );
  });

  it('is idempotent: running twice does not duplicate the script', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3201 });
    const html = '<html><body></body></html>';
    const once = plugin.transformIndexHtml(html);
    const twice = plugin.transformIndexHtml(once);
    expect(twice).toBe(once);
    // Single occurrence of the marker attribute.
    expect(twice.match(/data-rifty-hmr-bridge/g)?.length).toBe(1);
  });

  it('appends the script when no </body> exists (fragment HTML)', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3202 });
    const fragment = '<div id="app"></div>';
    const transformed = plugin.transformIndexHtml(fragment);
    expect(transformed.startsWith('<div id="app"></div>')).toBe(true);
    expect(transformed).toContain('data-rifty-hmr-bridge');
  });
});

describe('hmrClientScript', () => {
  it('produces valid JS (parses without SyntaxError)', () => {
    const script = hmrClientScript(3300);
    // new Function throws SyntaxError on invalid source.
    expect(() => new Function(script)).not.toThrow();
  });

  it('uses BroadcastChannel and posts an open frame matching the bridge protocol', () => {
    const script = hmrClientScript(3301);
    expect(script).toContain('new BroadcastChannel');
    expect(script).toContain("type: 'open'");
    expect(script).toContain('open-ack');
  });

  it('only accepts per-client bridged messages after the open handshake', () => {
    const script = hmrClientScript(3302);
    expect(script).not.toContain("f.type === 'broadcast'");
    expect(script).toContain("f.type === 'msg' && open");
  });
});
