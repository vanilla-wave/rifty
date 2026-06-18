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

  it('honors binaryType when delivering binary frames', async () => {
    const server = new WebSocketServer({ port: 9094 });
    server.on('connection', (sock) => sock.send(new Uint8Array([4, 5, 6])));

    const wsBlob = new WebSocket('ws://localhost:9094/');
    const blobMsg = await new Promise<MessageEvent>((r) =>
      wsBlob.addEventListener('message', (e) => r(e as MessageEvent), { once: true }),
    );
    expect(blobMsg.data).toBeInstanceOf(Blob);
    wsBlob.close();

    const wsAb = new WebSocket('ws://localhost:9094/');
    wsAb.binaryType = 'arraybuffer';
    const abMsg = await new Promise<MessageEvent>((r) =>
      wsAb.addEventListener('message', (e) => r(e as MessageEvent), { once: true }),
    );
    expect(abMsg.data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(abMsg.data as ArrayBuffer)]).toEqual([4, 5, 6]);
    wsAb.close();
    server.close();
  });

  it('exposes instance readyState constants and on* handler properties', async () => {
    const server = new WebSocketServer({ port: 9093 });
    server.on('connection', (sock) => sock.send('hi'));
    const ws = new WebSocket('ws://localhost:9093/');
    expect(ws.CONNECTING).toBe(0);
    expect(ws.OPEN).toBe(1);
    expect(ws.CLOSING).toBe(2);
    expect(ws.CLOSED).toBe(3);

    const got: string[] = [];
    ws.onopen = () => got.push('open');
    ws.onmessage = (e) => got.push(`msg:${(e as MessageEvent).data}`);
    await new Promise((r) => setTimeout(r, 20));

    expect(got[0]).toBe('open');
    expect(got).toContain('msg:hi');
    ws.close();
    server.close();
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

/**
 * A cross-realm peer that completes the open handshake and then goes silent —
 * it never echoes the client's close frame. Models a terminated realm (closed
 * iframe / killed worker). Without a close-handshake timeout the client would
 * sit in CLOSING forever, never fire `close`, and leak its channels.
 */
function spawnSilentClosePeer(channelName: string): { dispose(): void } {
  const peer = new BroadcastChannel(channelName);
  const onMessage = (e: MessageEvent): void => {
    const frame = e.data as { type?: string; cid?: string };
    if (frame?.type === 'open') {
      peer.postMessage({ type: 'open-ack', cid: frame.cid, protocol: '' });
    }
    // intentionally no 'close' handling — the peer realm is gone
  };
  peer.addEventListener('message', onMessage);
  return {
    dispose(): void {
      peer.removeEventListener('message', onMessage);
      peer.close();
    },
  };
}

async function raceCloseEvent(target: EventTarget): Promise<CloseEvent | null> {
  return Promise.race([
    new Promise<CloseEvent | null>((resolve) =>
      target.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
}

describe('clients expose bufferedAmount and honor binaryType', () => {
  it('default WebSocket exposes bufferedAmount === 0', async () => {
    const server = new WebSocketServer({ port: 9092 });
    server.on('connection', () => {});
    const ws = new WebSocket('ws://localhost:9092/');
    expect(ws.bufferedAmount).toBe(0);
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    expect(ws.bufferedAmount).toBe(0);
    ws.close();
    server.close();
  });

  it('BridgedWebSocket exposes bufferedAmount === 0 and honors binaryType', async () => {
    const { WebSocket: BWS, WebSocketServer: BWSS } = createCrossRealmBridge();
    const server = new BWSS('ws://playground/bin');
    server.on('connection', (sock) => sock.send(new Uint8Array([7, 8, 9])));
    const ws = new BWS('ws://playground/bin');
    ws.binaryType = 'arraybuffer';
    expect(ws.bufferedAmount).toBe(0);
    const msg = await new Promise<MessageEvent>((r) =>
      ws.addEventListener('message', (e) => r(e as MessageEvent), { once: true }),
    );
    expect(msg.data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(msg.data as ArrayBuffer)]).toEqual([7, 8, 9]);
    ws.close();
    server.close();
  });
});

describe('close events carry a faithful wasClean flag', () => {
  it('default WebSocket: a clean server-initiated close reports wasClean=true', async () => {
    const server = new WebSocketServer({ port: 9096 });
    server.on('connection', (sock) => sock.close(1001, 'going away'));
    const ws = new WebSocket('ws://localhost:9096/');
    const closeEvent = await new Promise<CloseEvent>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
    );
    expect(closeEvent.code).toBe(1001);
    expect(closeEvent.wasClean).toBe(true);
    server.close();
  });

  it('default WebSocket: an abnormal (1006) close reports wasClean=false', async () => {
    const ws = new WebSocket('ws://localhost:9095/missing');
    const closeEvent = await new Promise<CloseEvent>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
    );
    expect(closeEvent.code).toBe(1006);
    expect(closeEvent.wasClean).toBe(false);
  });

  it('BridgedWebSocket: a clean server-initiated close reports wasClean=true', async () => {
    const { WebSocket: BWS, WebSocketServer: BWSS } = createCrossRealmBridge();
    const server = new BWSS('ws://playground/clean-close');
    server.on('connection', (sock) => setTimeout(() => sock.close(1000, 'bye'), 5));
    const ws = new BWS('ws://playground/clean-close');
    const closeEvent = await new Promise<CloseEvent>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true }),
    );
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.wasClean).toBe(true);
    server.close();
  });
});

describe('client close() never hangs when the peer realm disappears', () => {
  it('default WebSocket client fires close(1006) after the close handshake times out', async () => {
    const peer = spawnSilentClosePeer('rifty:ws:localhost:9098/dead');
    try {
      const ws = new WebSocket('ws://localhost:9098/dead');
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      ws.close(3002, 'client-done');
      const closeEvent = await raceCloseEvent(ws);

      expect(closeEvent, 'close must fire even when the peer never echoes').not.toBeNull();
      expect((closeEvent as CloseEvent).code).toBe(1006);
      expect((closeEvent as CloseEvent).wasClean).toBe(false);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      peer.dispose();
    }
  });

  it('BridgedWebSocket client fires close(1006) after the close handshake times out', async () => {
    const { WebSocket: BWS } = createCrossRealmBridge();
    const peer = spawnSilentClosePeer('rifty:ws:playground/dead-bridge');
    try {
      const ws = new BWS('ws://playground/dead-bridge');
      await new Promise<void>((resolve) =>
        ws.addEventListener('open', () => resolve(), { once: true }),
      );

      ws.close(3003, 'client-done');
      const closeEvent = await raceCloseEvent(ws);

      expect(closeEvent, 'close must fire even when the peer never echoes').not.toBeNull();
      expect((closeEvent as CloseEvent).code).toBe(1006);
      expect((closeEvent as CloseEvent).wasClean).toBe(false);
      expect(ws.readyState).toBe(BWS.CLOSED);
    } finally {
      peer.dispose();
    }
  });
});
