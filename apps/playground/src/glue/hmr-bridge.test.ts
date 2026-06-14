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
import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { BridgedWebSocket, channelNameFor } from '@riftydev/net';
import { describe, expect, it } from 'vitest';
import {
  createHmrBridgeToken,
  createHmrBridgeVitePlugin,
  createViteHmrBridgeChannel,
  hmrBridgeUrl,
  hmrClientScript,
  setupHmrBridge,
  viteHmrClientScript,
} from './hmr-bridge.ts';

describe('hmrBridgeUrl', () => {
  it('returns a deterministic ws URL keyed by port', () => {
    expect(hmrBridgeUrl(3000)).toBe(`ws://${PREVIEW_LOCAL_HOST}:3000/__hmr`);
    expect(hmrBridgeUrl(5174)).toBe(`ws://${PREVIEW_LOCAL_HOST}:5174/__hmr`);
  });

  it('scopes the ws URL by nonce when supplied', () => {
    expect(hmrBridgeUrl(3000, 'nonce-1')).toBe(`ws://${PREVIEW_LOCAL_HOST}:3000/__hmr/nonce-1`);
    expect(channelNameFor(hmrBridgeUrl(3000, 'nonce-1'))).not.toBe(
      channelNameFor(hmrBridgeUrl(3000)),
    );
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

  it('uses the same BroadcastChannel name the iframe client script would use', () => {
    // The wire-format check that protects the page ↔ iframe contract: the
    // server side derives its channel name from `hmrBridgeUrl(port)`, and the
    // inlined client script embeds the same channel name as a JSON-encoded
    // literal. If `channelNameFor` ever changes shape, this test breaks
    // before the iframe silently fails to connect in production.
    const port = 4200;
    const expectedChannel = channelNameFor(hmrBridgeUrl(port, 'shared'));
    const script = hmrClientScript(port, 'shared');
    expect(script).toContain(JSON.stringify(expectedChannel));
  });
});

describe('createViteHmrBridgeChannel', () => {
  it('speaks Vite HMR payloads over the cross-realm bridge', async () => {
    const channel = createViteHmrBridgeChannel({ port: 3150, token: 'vite' });
    channel.listen();
    try {
      const client = new BridgedWebSocket(hmrBridgeUrl(3150, 'vite'));
      const seen: string[] = [];
      client.addEventListener('message', (e) => seen.push(String((e as MessageEvent).data)));
      await new Promise<void>((r) => client.addEventListener('open', () => r(), { once: true }));
      await new Promise((r) => setTimeout(r, 20));

      expect(seen.map((payload) => JSON.parse(payload) as { type?: string })).toContainEqual({
        type: 'connected',
      });

      channel.send({
        type: 'update',
        updates: [
          {
            type: 'js-update',
            path: '/src/main.js',
            acceptedPath: '/src/main.js',
            timestamp: 1,
            explicitImportRequired: false,
            isWithinCircularImport: false,
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 20));

      const update = seen
        .map((payload) => JSON.parse(payload) as { type?: string; updates?: unknown[] })
        .find((payload) => payload.type === 'update');
      expect(update?.updates).toHaveLength(1);
      client.close();
    } finally {
      await channel.close();
    }
  });

  it('emits Vite custom events sent by the iframe client', async () => {
    const channel = createViteHmrBridgeChannel({ port: 3151, token: 'vite' });
    const invalidations: unknown[] = [];
    channel.on('vite:invalidate', (data) => invalidations.push(data));
    channel.listen();
    try {
      const client = new BridgedWebSocket(hmrBridgeUrl(3151, 'vite'));
      await new Promise<void>((r) => client.addEventListener('open', () => r(), { once: true }));
      client.send(
        JSON.stringify({
          type: 'custom',
          event: 'vite:invalidate',
          data: { path: '/src/main.js', message: 'accept boundary declined' },
        }),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(invalidations).toEqual([
        { path: '/src/main.js', message: 'accept boundary declined' },
      ]);
      client.close();
    } finally {
      await channel.close();
    }
  });
});

describe('createHmrBridgeVitePlugin', () => {
  it('injects the Vite HMR transport before @vite/client runs', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3200, token: 'plugin-token' });
    const html = '<!doctype html><html><body><div id="app"></div></body></html>';
    const transformed = plugin.transformIndexHtml(html);
    if (typeof transformed === 'string' || Array.isArray(transformed)) {
      throw new Error('expected a Vite tag transform object');
    }
    expect(transformed.html).toBe(html);
    expect(transformed.tags).toEqual([
      expect.objectContaining({
        tag: 'script',
        injectTo: 'head-prepend',
        attrs: expect.objectContaining({ 'data-rifty-hmr-bridge': '' }),
      }),
    ]);
    expect(String(transformed.tags?.[0]?.children)).toContain(
      channelNameFor(hmrBridgeUrl(3200, 'plugin-token')),
    );
  });

  it('is idempotent: running twice does not duplicate the script', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3201 });
    const html = '<html><body></body></html>';
    const once = plugin.transformIndexHtml(html);
    const renderedOnce =
      typeof once === 'string' || Array.isArray(once)
        ? String(once)
        : `${once.html}<script data-rifty-hmr-bridge>${once.tags?.[0]?.children}</script>`;
    const twice = plugin.transformIndexHtml(renderedOnce);
    expect(twice).toBe(renderedOnce);
  });

  it('does not ship the reload-only client for real Vite', () => {
    const plugin = createHmrBridgeVitePlugin({ port: 3202 });
    const transformed = plugin.transformIndexHtml('<div id="app"></div>');
    if (typeof transformed === 'string' || Array.isArray(transformed)) {
      throw new Error('expected a Vite tag transform object');
    }
    expect(String(transformed.tags?.[0]?.children)).not.toContain('location.reload()');
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

describe('viteHmrClientScript', () => {
  it('produces valid JS that installs a targeted vite-hmr WebSocket shim', () => {
    const script = viteHmrClientScript(3303, 'vite-token');
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('window.WebSocket');
    expect(script).toContain("'vite-hmr'");
    expect(script).toContain('this.OPEN = RiftyViteHmrWebSocket.OPEN');
    expect(script).toContain(channelNameFor(hmrBridgeUrl(3303, 'vite-token')));
    expect(script).not.toContain('location.reload()');
  });
});
