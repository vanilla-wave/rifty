/**
 * In-process WebSocket layer.
 *
 * Browser `WebSocket` opens a real TCP connection — Service Workers can't
 * intercept it, so we can't reuse the port-registry trick that powers `http`.
 * Instead this module pairs a `WebSocketServer.listen(port)` with a `new
 * WebSocket('ws://host:port/path')` constructor in the same JS realm via a
 * URL-keyed lookup. The API mirrors the browser/Node `ws` surface — `send`,
 * `'message'` / `'open'` / `'close'` events, `readyState` constants — so the
 * dev-server code we write today survives unchanged the day we wire it to a
 * real socket.
 *
 * For cross-frame HMR (iframe ↔ Worker) see `./bridge.ts` for the
 * `BroadcastChannel`-backed transport. Real TCP WebSocket is **not** in
 * scope (ADR-0017 §Decision).
 */

import { EventEmitter } from '@riftydev/io';
import { CloseEventCtor } from './close-event.ts';

export type WsMessage = string | ArrayBufferView | ArrayBuffer;

export enum State {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

interface ListenerEntry {
  host: string;
  port: number;
  path: string;
  server: WebSocketServer;
}

const listeners: ListenerEntry[] = [];

function parseWsUrl(url: string): { host: string; port: number; path: string } {
  const u = new URL(url);
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:')
    throw new TypeError(`WebSocket url must be ws:/wss:, got ${u.protocol}`);
  return {
    host: u.hostname,
    port: Number.parseInt(u.port || (u.protocol === 'wss:' ? '443' : '80'), 10),
    path: u.pathname || '/',
  };
}

function findListener(host: string, port: number, path: string): WebSocketServer | null {
  for (const l of listeners) {
    if (l.port !== port) continue;
    if (l.host !== '*' && l.host !== host) continue;
    if (l.path !== '*' && l.path !== path) continue;
    return l.server;
  }
  return null;
}

/**
 * Server-side endpoint for a single connected client.
 *
 * Inherits EventEmitter — emits `message`, `close`, `error`. Mirrors the
 * subset of the `ws` library API that real dev servers (Vite, Express ws
 * middleware, etc.) actually use.
 */
export class WebSocketConnection extends EventEmitter {
  state: State = State.OPEN;
  /** Browser-style alias for `state` matching the `WebSocket` constants. */
  get readyState(): number {
    return this.state;
  }
  /** @internal */
  _peer: WebSocket | null = null;

  send(data: WsMessage): void {
    if (this.state !== State.OPEN) return;
    queueMicrotask(() => {
      this._peer?._deliver(data);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.state === State.CLOSED || this.state === State.CLOSING) return;
    this.state = State.CLOSING;
    queueMicrotask(() => {
      this._peer?._peerClosed(code, reason);
      this.state = State.CLOSED;
      this.emit('close', code, reason);
    });
  }

  /** @internal — peer closed first. */
  _peerClosed(code: number, reason: string): void {
    if (this.state === State.CLOSED) return;
    this.state = State.CLOSED;
    this.emit('close', code, reason);
  }
}

/**
 * Server: registers a listener under `{port, path}` and pairs each incoming
 * `new WebSocket(...)` with a `WebSocketConnection`.
 */
export class WebSocketServer extends EventEmitter {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  private readonly clients: Set<WebSocketConnection> = new Set();
  private closed = false;

  constructor(options: { port: number; host?: string; path?: string }) {
    super();
    this.port = options.port;
    this.host = options.host ?? '*';
    this.path = options.path ?? '*';
    listeners.push({ host: this.host, port: this.port, path: this.path, server: this });
  }

  /** @internal — called by WebSocket constructor when it finds us */
  _accept(client: WebSocket): WebSocketConnection {
    const conn = new WebSocketConnection();
    conn._peer = client;
    this.clients.add(conn);
    conn.on('close', () => this.clients.delete(conn));
    queueMicrotask(() => this.emit('connection', conn));
    return conn;
  }

  broadcast(data: WsMessage): void {
    for (const c of this.clients) c.send(data);
  }

  close(cb?: () => void): void {
    if (this.closed) return;
    this.closed = true;
    const idx = listeners.findIndex((l) => l.server === this);
    if (idx >= 0) listeners.splice(idx, 1);
    for (const c of [...this.clients]) c.close();
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
  }
}

/**
 * Client side. Mimics the browser `WebSocket` interface (events: `open`,
 * `message`, `close`, `error`). Pairs with a same-realm `WebSocketServer`.
 */
export class WebSocket extends EventTarget {
  static readonly CONNECTING = State.CONNECTING;
  static readonly OPEN = State.OPEN;
  static readonly CLOSING = State.CLOSING;
  static readonly CLOSED = State.CLOSED;

  readonly url: string;
  readyState: number = State.CONNECTING;
  /** @internal */
  _server: WebSocketConnection | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    let parsed: { host: string; port: number; path: string };
    try {
      parsed = parseWsUrl(url);
    } catch (err) {
      queueMicrotask(() => {
        this.readyState = State.CLOSED;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(new CloseEventCtor('close', { code: 1006, reason: String(err) }));
      });
      return;
    }
    queueMicrotask(() => {
      const server = findListener(parsed.host, parsed.port, parsed.path);
      if (!server) {
        this.readyState = State.CLOSED;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(
          new CloseEventCtor('close', { code: 1006, reason: 'connection refused' }),
        );
        return;
      }
      const conn = server._accept(this);
      this._server = conn;
      this.readyState = State.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: WsMessage): void {
    if (this.readyState !== State.OPEN) return;
    queueMicrotask(() => {
      this._server?.emit('message', data);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === State.CLOSED || this.readyState === State.CLOSING) return;
    this.readyState = State.CLOSING;
    queueMicrotask(() => {
      this._server?._peerClosed(code, reason);
      this.readyState = State.CLOSED;
      this.dispatchEvent(new CloseEventCtor('close', { code, reason }));
    });
  }

  /** @internal — server delivered a message */
  _deliver(data: WsMessage): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  /** @internal — peer (server) closed first. */
  _peerClosed(code: number, reason: string): void {
    if (this.readyState === State.CLOSED) return;
    this.readyState = State.CLOSED;
    this.dispatchEvent(new CloseEventCtor('close', { code, reason }));
  }
}
