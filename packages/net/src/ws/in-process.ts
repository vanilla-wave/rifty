/**
 * In-process WebSocket layer.
 *
 * Browser `WebSocket` opens a real TCP connection that Service Workers can't
 * intercept, so the port-registry trick that powers `http` doesn't apply here.
 * Instead this pairs a `WebSocketServer` with a `new WebSocket('ws://host:port/path')`
 * via URL-keyed same-realm lookup, then falls back to a `BroadcastChannel`
 * bridge when client and server live in different same-origin realms. API
 * mirrors the browser/Node `ws` surface so dev-server code can use honest
 * WebSocket semantics without playground-only registries.
 */

import { EventEmitter } from '@riftydev/io';
import { channelNameFor, portChannelNameFor } from './channel.ts';
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
const BRIDGE_CONNECT_TIMEOUT_MS = 100;

interface BridgeFrame {
  type: 'open' | 'open-ack' | 'msg' | 'close';
  cid: string;
  data?: WsMessage;
  code?: number;
  reason?: string;
  from?: 'client' | 'server';
  url?: string;
}

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

function routeMatches(
  listenerHost: string,
  listenerPort: number,
  listenerPath: string,
  host: string,
  port: number,
  path: string,
): boolean {
  if (listenerPort !== port) return false;
  if (listenerHost !== '*' && listenerHost !== host) return false;
  if (listenerPath !== '*' && listenerPath !== path) return false;
  return true;
}

function findListener(host: string, port: number, path: string): WebSocketServer | null {
  for (const l of listeners) {
    if (!routeMatches(l.host, l.port, l.path, host, port, path)) continue;
    return l.server;
  }
  return null;
}

function bridgeUrlFor(host: string, port: number, path: string): string {
  const bridgeHost = host === '*' ? 'localhost' : host;
  const bridgePath = path === '*' ? '/' : path.startsWith('/') ? path : `/${path}`;
  return `ws://${bridgeHost}:${port}${bridgePath}`;
}

let connectionCounter = 0;
function nextCid(): string {
  return `c${++connectionCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Server-side endpoint for a single connected client.
 *
 * Emits `message`, `close`, `error`. Mirrors the subset of the `ws` library
 * API that real dev servers (Vite, Express ws middleware) actually use.
 */
export class WebSocketConnection extends EventEmitter {
  state: State = State.OPEN;
  /** Browser-style alias for `state` matching the `WebSocket` constants. */
  get readyState(): number {
    return this.state;
  }
  /** @internal */
  _peer: WebSocket | null = null;
  /** @internal */
  _bridgeSend: ((frame: BridgeFrame) => void) | null = null;
  /** @internal */
  _bridgeCid = '';

  send(data: WsMessage): void {
    if (this.state !== State.OPEN) return;
    if (this._bridgeSend) {
      this._bridgeSend({ type: 'msg', cid: this._bridgeCid, data });
      return;
    }
    queueMicrotask(() => {
      this._peer?._deliver(data);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.state === State.CLOSED || this.state === State.CLOSING) return;
    this.state = State.CLOSING;
    if (this._bridgeSend) {
      this._bridgeSend({ type: 'close', cid: this._bridgeCid, code, reason, from: 'server' });
      this.state = State.CLOSED;
      queueMicrotask(() => this.emit('close', code, reason));
      return;
    }
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
  private readonly bridgeChannels: BroadcastChannel[] = [];
  private readonly bridgePortChannels: Set<BroadcastChannel> = new Set();
  private readonly bridgeClients: Map<string, WebSocketConnection> = new Map();
  private closed = false;

  constructor(options: { port: number; host?: string; path?: string }) {
    super();
    this.port = options.port;
    this.host = options.host ?? '*';
    this.path = options.path ?? '*';
    listeners.push({ host: this.host, port: this.port, path: this.path, server: this });
    if (typeof BroadcastChannel !== 'undefined') {
      const url = bridgeUrlFor(this.host, this.port, this.path);
      const portChannelName = portChannelNameFor(url);
      for (const channelName of new Set([channelNameFor(url), portChannelName])) {
        const channel = new BroadcastChannel(channelName);
        channel.addEventListener('message', this.onBridgeMessage);
        this.bridgeChannels.push(channel);
        if (channelName === portChannelName) this.bridgePortChannels.add(channel);
      }
    }
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

  /** @internal — accepts a connection arriving over the cross-realm bridge. */
  private _acceptBridge(cid: string, channel: BroadcastChannel): WebSocketConnection {
    const existing = this.bridgeClients.get(cid);
    if (existing) {
      channel.postMessage({ type: 'open-ack', cid });
      return existing;
    }
    const conn = new WebSocketConnection();
    conn._bridgeCid = cid;
    conn._bridgeSend = (frame) => channel.postMessage(frame);
    this.clients.add(conn);
    this.bridgeClients.set(cid, conn);
    conn.on('close', () => {
      this.clients.delete(conn);
      this.bridgeClients.delete(cid);
    });
    channel.postMessage({ type: 'open-ack', cid });
    queueMicrotask(() => this.emit('connection', conn));
    return conn;
  }

  private onBridgeMessage = (e: MessageEvent): void => {
    if (this.closed) return;
    const frame = e.data as BridgeFrame;
    const channel = this.channelFromEvent(e);
    if (!channel) return;
    if (frame.type === 'open') {
      if (frame.url !== undefined) {
        if (!this.bridgePortChannels.has(channel)) return;
        if (!this.matchesBridgeUrl(frame.url)) return;
      }
      this._acceptBridge(frame.cid, channel);
      return;
    }
    if (frame.type === 'msg') {
      const conn = this.bridgeClients.get(frame.cid);
      if (conn && frame.data !== undefined) conn.emit('message', frame.data);
      return;
    }
    if (frame.type === 'close' && frame.from === 'client') {
      const conn = this.bridgeClients.get(frame.cid);
      if (conn) {
        this.clients.delete(conn);
        this.bridgeClients.delete(frame.cid);
        conn._peerClosed(frame.code ?? 1000, frame.reason ?? '');
      }
    }
  };

  private channelFromEvent(e: MessageEvent): BroadcastChannel | null {
    const target = e.currentTarget;
    return this.bridgeChannels.find((channel) => channel === target) ?? null;
  }

  private matchesBridgeUrl(url: string): boolean {
    try {
      const parsed = parseWsUrl(url);
      return routeMatches(this.host, this.port, this.path, parsed.host, parsed.port, parsed.path);
    } catch {
      return false;
    }
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
    for (const channel of this.bridgeChannels) {
      channel.removeEventListener('message', this.onBridgeMessage);
      channel.close();
    }
    this.bridgeChannels.length = 0;
    this.bridgePortChannels.clear();
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
  }
}

/**
 * Client side. Mimics the browser `WebSocket` interface (events: `open`,
 * `message`, `close`, `error`); pairs with a same-realm `WebSocketServer`.
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
  private readonly bridgeChannels: BroadcastChannel[] = [];
  private activeBridgeChannel: BroadcastChannel | null = null;
  private bridgeCid = '';
  private bridgeConnectTimeout: ReturnType<typeof setTimeout> | null = null;

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
        this.openBridge(url);
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
    if (this.activeBridgeChannel) {
      this.activeBridgeChannel.postMessage({ type: 'msg', cid: this.bridgeCid, data });
      return;
    }
    queueMicrotask(() => {
      this._server?.emit('message', data);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === State.CLOSED || this.readyState === State.CLOSING) return;
    this.readyState = State.CLOSING;
    if (this.bridgeChannels.length > 0) {
      const targets = this.activeBridgeChannel ? [this.activeBridgeChannel] : this.bridgeChannels;
      for (const channel of targets) {
        channel.postMessage({
          type: 'close',
          cid: this.bridgeCid,
          code,
          reason,
          from: 'client',
        });
      }
      this.readyState = State.CLOSED;
      this.dispatchEvent(new CloseEventCtor('close', { code, reason }));
      this.cleanupBridge();
      return;
    }
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

  private openBridge(url: string): void {
    if (typeof BroadcastChannel === 'undefined') {
      this.failBridgeConnection();
      return;
    }
    this.bridgeCid = nextCid();
    for (const channelName of new Set([channelNameFor(url), portChannelNameFor(url)])) {
      const channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', this.onBridgeMessage);
      this.bridgeChannels.push(channel);
    }
    for (const channel of this.bridgeChannels) {
      channel.postMessage({ type: 'open', cid: this.bridgeCid, url });
    }
    this.bridgeConnectTimeout = setTimeout(() => {
      if (this.readyState !== State.CONNECTING) return;
      this.failBridgeConnection();
    }, BRIDGE_CONNECT_TIMEOUT_MS);
  }

  private onBridgeMessage = (e: MessageEvent): void => {
    const frame = e.data as BridgeFrame;
    if (frame.cid !== this.bridgeCid) return;
    if (frame.type === 'open-ack' && this.readyState === State.CONNECTING) {
      this.clearBridgeConnectTimeout();
      this.activeBridgeChannel = this.bridgeChannelFromEvent(e);
      this.closeInactiveBridgeChannels();
      this.readyState = State.OPEN;
      this.dispatchEvent(new Event('open'));
      return;
    }
    if (frame.type === 'msg' && this.readyState === State.OPEN && frame.data !== undefined) {
      this.dispatchEvent(new MessageEvent('message', { data: frame.data }));
      return;
    }
    if (frame.type === 'close' && frame.from === 'server') {
      if (this.readyState === State.CLOSED) return;
      this.readyState = State.CLOSED;
      this.dispatchEvent(
        new CloseEventCtor('close', { code: frame.code ?? 1000, reason: frame.reason ?? '' }),
      );
      this.cleanupBridge();
    }
  };

  private failBridgeConnection(): void {
    this.readyState = State.CLOSED;
    this.dispatchEvent(new Event('error'));
    this.dispatchEvent(new CloseEventCtor('close', { code: 1006, reason: 'connection refused' }));
    this.cleanupBridge();
  }

  private clearBridgeConnectTimeout(): void {
    if (!this.bridgeConnectTimeout) return;
    clearTimeout(this.bridgeConnectTimeout);
    this.bridgeConnectTimeout = null;
  }

  private cleanupBridge(): void {
    this.clearBridgeConnectTimeout();
    for (const channel of this.bridgeChannels) {
      channel.removeEventListener('message', this.onBridgeMessage);
      channel.close();
    }
    this.bridgeChannels.length = 0;
    this.activeBridgeChannel = null;
  }

  private bridgeChannelFromEvent(e: MessageEvent): BroadcastChannel | null {
    const target = e.currentTarget;
    return (
      this.bridgeChannels.find((channel) => channel === target) ??
      this.activeBridgeChannel ??
      this.bridgeChannels[0] ??
      null
    );
  }

  private closeInactiveBridgeChannels(): void {
    for (const channel of [...this.bridgeChannels]) {
      if (channel === this.activeBridgeChannel) continue;
      channel.removeEventListener('message', this.onBridgeMessage);
      channel.close();
      this.bridgeChannels.splice(this.bridgeChannels.indexOf(channel), 1);
    }
  }
}
