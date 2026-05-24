/**
 * Conformance tests for the in-process WebSocket layer in `@rifty/net`.
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
import { WebSocket, WebSocketServer } from '../../../packages/net/src/ws.ts';

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
