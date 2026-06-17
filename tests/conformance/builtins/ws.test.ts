/**
 * Conformance tests for the in-process WebSocket layer in `@riftydev/net`.
 *
 * The browser's native `WebSocket` goes over TCP and is not interceptable by a
 * Service Worker. For HMR-in-the-browser we expose a `WebSocketServer` that
 * pairs in-process with `WebSocket` clients in the same JS realm — the API
 * mirrors RFC6455/Node `ws` so the dev-server author writes the same code we'd
 * keep if we ever proxy through a real socket later.
 *
 * The wire format isn't tested here (there's no wire) — the contract is:
 * messages sent on one end arrive on the other in order, close events fire on
 * both ends, and the URL routes to the right server.
 */
import { describe, expect, it } from 'vitest';
import {
  WebSocket,
  WebSocketServer,
  createCrossRealmBridge,
  portChannelNameFor,
} from '../../../packages/net/src/ws.ts';

describe('WebSocketServer', () => {
  it('accepts a connecting client and exchanges text messages', async () => {
    const server = new WebSocketServer({ port: 9001 });
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (data: unknown) => serverSeen.push(String(data)));
      sock.send('hello from server');
    });

    const ws = new WebSocket('ws://localhost:9001/');
    const clientSeen: string[] = [];
    ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    ws.send('hello from client');
    await new Promise((r) => setTimeout(r, 10));

    expect(serverSeen).toEqual(['hello from client']);
    expect(clientSeen).toEqual(['hello from server']);

    ws.close();
    server.close();
  });

  it('emits close on both ends when client closes', async () => {
    const server = new WebSocketServer({ port: 9002 });
    let serverClosed = false;
    server.on('connection', (sock) => {
      sock.on('close', () => {
        serverClosed = true;
      });
    });
    const ws = new WebSocket('ws://localhost:9002/');
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    let clientClosed = false;
    ws.addEventListener('close', () => {
      clientClosed = true;
    });
    ws.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(clientClosed).toBe(true);
    expect(serverClosed).toBe(true);
    server.close();
  });

  it('readyState transitions: CONNECTING → OPEN → CLOSED', async () => {
    const server = new WebSocketServer({ port: 9003 });
    server.on('connection', () => {});
    const ws = new WebSocket('ws://localhost:9003/');
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    server.close();
  });

  it('throws InvalidStateError when send() is called before OPEN', async () => {
    const server = new WebSocketServer({ port: 9005 });
    server.on('connection', () => {});
    const ws = new WebSocket('ws://localhost:9005/');

    expect(() => ws.send('too-early')).toThrow(/CONNECTING|InvalidStateError/);

    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    ws.close();
    server.close();
  });

  it('validates subprotocol tokens and close parameters', () => {
    expect(() => new WebSocket('ws://localhost:9006/', ['chat', 'chat'])).toThrow(
      /duplicated|SyntaxError/,
    );
    expect(() => new WebSocket('ws://localhost:9006/', ['bad token'])).toThrow(
      /invalid|SyntaxError/,
    );

    const ws = new WebSocket('ws://localhost:9006/');
    expect(() => ws.close(1006)).toThrow(/code|InvalidAccessError/);
    expect(() => ws.close(3000, 'x'.repeat(124))).toThrow(/123 bytes|SyntaxError/);
    ws.close();
  });

  it('fails to connect when no server is listening at that url', async () => {
    const ws = new WebSocket('ws://localhost:9999/missing');
    const err = await new Promise<Event>((r) =>
      ws.addEventListener('error', (e) => r(e), { once: true }),
    );
    expect(err.type).toBe('error');
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('broadcasts to all connected clients', async () => {
    const server = new WebSocketServer({ port: 9004 });
    server.on('connection', () => {});
    const a = new WebSocket('ws://localhost:9004/');
    const b = new WebSocket('ws://localhost:9004/');
    await Promise.all([
      new Promise<void>((r) => a.addEventListener('open', () => r(), { once: true })),
      new Promise<void>((r) => b.addEventListener('open', () => r(), { once: true })),
    ]);
    const aSeen: string[] = [];
    const bSeen: string[] = [];
    a.addEventListener('message', (e) => aSeen.push(String((e as MessageEvent).data)));
    b.addEventListener('message', (e) => bSeen.push(String((e as MessageEvent).data)));
    server.broadcast('ping');
    await new Promise((r) => setTimeout(r, 10));
    expect(aSeen).toEqual(['ping']);
    expect(bSeen).toEqual(['ping']);
    a.close();
    b.close();
    server.close();
  });
});

describe('cross-realm WebSocket bridge (ADR-0017 phase 1)', () => {
  /**
   * The bridge is BroadcastChannel-backed and intentionally has no shared
   * in-process registry — the connection is established purely through the
   * named channel. These tests verify that plumbing works without falling
   * back to the same-realm shim.
   */
  it('exchanges messages over BroadcastChannel with no shared registry', async () => {
    const { WebSocket: BWS, WebSocketServer: BWSS } = createCrossRealmBridge();
    const server = new BWSS('ws://playground/hmr');
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (data: unknown) => serverSeen.push(String(data)));
      sock.send('server-hello');
    });

    const ws = new BWS('ws://playground/hmr');
    const clientSeen: string[] = [];
    ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    ws.send('client-hello');
    await new Promise((r) => setTimeout(r, 20));

    expect(serverSeen).toEqual(['client-hello']);
    expect(clientSeen).toEqual(['server-hello']);

    ws.close();
    server.close();
  });

  it('propagates close across the bridge in both directions', async () => {
    const { WebSocket: BWS, WebSocketServer: BWSS } = createCrossRealmBridge();
    // Direction 1: client closes → server connection sees 'close'.
    const server1 = new BWSS('ws://playground/close-1');
    let server1Saw = false;
    server1.on('connection', (sock) => {
      sock.on('close', () => {
        server1Saw = true;
      });
    });
    const c1 = new BWS('ws://playground/close-1');
    await new Promise<void>((r) => c1.addEventListener('open', () => r(), { once: true }));
    let c1Saw = false;
    c1.addEventListener('close', () => {
      c1Saw = true;
    });
    c1.close(1000, 'bye-from-client');
    await new Promise((r) => setTimeout(r, 20));
    expect(c1Saw).toBe(true);
    expect(server1Saw).toBe(true);
    server1.close();

    // Direction 2: server closes connection → client sees 'close'.
    const server2 = new BWSS('ws://playground/close-2');
    server2.on('connection', (sock) => {
      // Close from the server side a moment after accept.
      setTimeout(() => sock.close(1001, 'bye-from-server'), 5);
    });
    const c2 = new BWS('ws://playground/close-2');
    await new Promise<void>((r) => c2.addEventListener('open', () => r(), { once: true }));
    const closeEvent = await new Promise<CloseEvent>((r) =>
      c2.addEventListener('close', (e) => r(e as CloseEvent), { once: true }),
    );
    expect(closeEvent.code).toBe(1001);
    expect(closeEvent.reason).toBe('bye-from-server');
    server2.close();
  });

  it('throws InvalidStateError when a bridged client sends before OPEN', async () => {
    const { WebSocket: BWS, WebSocketServer: BWSS } = createCrossRealmBridge();
    const server = new BWSS('ws://playground/too-early');
    server.on('connection', () => {});
    const ws = new BWS('ws://playground/too-early');

    expect(() => ws.send('too-early')).toThrow(/CONNECTING|InvalidStateError/);

    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    ws.close();
    server.close();
  });

  it('validates bridged subprotocol tokens and close parameters', () => {
    const { WebSocket: BWS } = createCrossRealmBridge();

    expect(() => new BWS('ws://playground/invalid-protocol', ['chat', 'chat'])).toThrow(
      /duplicated|SyntaxError/,
    );
    expect(() => new BWS('ws://playground/invalid-protocol', ['bad token'])).toThrow(
      /invalid|SyntaxError/,
    );

    const ws = new BWS('ws://playground/invalid-close', { connectTimeoutMs: 50 });
    expect(() => ws.close(1006)).toThrow(/code|InvalidAccessError/);
    expect(() => ws.close(3000, 'x'.repeat(124))).toThrow(/123 bytes|SyntaxError/);
    ws.close();
  });
});

describe('default WebSocket surface crosses realms', () => {
  it('lets a bridged client connect to the ordinary WebSocketServer surface', async () => {
    const server = new WebSocketServer({ port: 9010, path: '/hmr' });
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (data: unknown) => serverSeen.push(String(data)));
      sock.send('server-hello');
    });

    const { WebSocket: RealmWebSocket } = createCrossRealmBridge();
    const ws = new RealmWebSocket('ws://localhost:9010/hmr');
    const clientSeen: string[] = [];
    ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));
    await new Promise<void>((resolve) =>
      ws.addEventListener('open', () => resolve(), { once: true }),
    );
    ws.send('client-hello');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(serverSeen).toEqual(['client-hello']);
    expect(clientSeen).toEqual(['server-hello']);

    ws.close();
    server.close();
  });

  it('routes bridged clients through wildcard WebSocketServer hosts', async () => {
    const server = new WebSocketServer({ port: 9012, path: '/hmr' });
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (data: unknown) => serverSeen.push(String(data)));
      sock.send('server-hello');
    });

    const { WebSocket: RealmWebSocket } = createCrossRealmBridge();
    const ws = new RealmWebSocket('ws://preview.local:9012/hmr', { connectTimeoutMs: 50 });
    const clientSeen: string[] = [];
    ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));
    await new Promise<void>((resolve) =>
      ws.addEventListener('open', () => resolve(), { once: true }),
    );
    ws.send('client-hello');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(serverSeen).toEqual(['client-hello']);
    expect(clientSeen).toEqual(['server-hello']);

    ws.close();
    server.close();
  });

  it('rejects port-channel bridge opens that omit the target URL', async () => {
    const server = new WebSocketServer({ port: 9013, path: '/hmr' });
    let connections = 0;
    server.on('connection', () => {
      connections += 1;
    });
    const channel = new BroadcastChannel(portChannelNameFor('ws://preview.local:9013/hmr'));

    try {
      channel.postMessage({ type: 'open', cid: 'missing-url' });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(connections).toBe(0);
    } finally {
      channel.close();
      server.close();
    }
  });

  it('lets an ordinary WebSocket client connect to a bridged server', async () => {
    const { WebSocketServer: RealmWebSocketServer } = createCrossRealmBridge();
    const server = new RealmWebSocketServer('ws://localhost:9011/hmr');
    const serverSeen: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (data: unknown) => serverSeen.push(String(data)));
      sock.send('server-hello');
    });

    const ws = new WebSocket('ws://localhost:9011/hmr');
    const clientSeen: string[] = [];
    ws.addEventListener('message', (e) => clientSeen.push(String((e as MessageEvent).data)));
    await new Promise<void>((resolve) =>
      ws.addEventListener('open', () => resolve(), { once: true }),
    );
    ws.send('client-hello');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(serverSeen).toEqual(['client-hello']);
    expect(clientSeen).toEqual(['server-hello']);

    ws.close();
    server.close();
  });
});
