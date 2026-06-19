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
// Matches the browser shim and BridgedWebSocket defaults (1000 ms). A shorter
// window raced a slow page↔worker open into a false 1006 "connection refused".
const BRIDGE_CONNECT_TIMEOUT_MS = 1000;
// A client `close()` after OPEN waits for the server echo; if the peer realm is
// gone the echo never comes, so we mirror the connect timeout and end the
// handshake locally with 1006 instead of hanging in CLOSING forever.
const BRIDGE_CLOSE_TIMEOUT_MS = 1000;

interface BridgeFrame {
  type: 'open' | 'open-ack' | 'msg' | 'close';
  cid: string;
  data?: WsMessage;
  opcode?: number;
  code?: number;
  reason?: string;
  from?: 'client' | 'server';
  url?: string;
  protocols?: readonly string[];
  protocol?: string;
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
 * Emits `message`, `close`. Mirrors the subset of the `ws` library API that
 * real dev servers (Vite, Express ws middleware) actually use. There is no
 * wire, so no transport `'error'` is ever emitted.
 *
 * Reduced same-realm shim, NOT a full `ws` connection: no `terminate`/`ping`/
 * `pong`/`pause`/`resume`/`bufferedAmount`, and `send(data)` takes no completion
 * callback. Guest code that loads the real npm `ws` gets the real class instead.
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
    // Not OPEN → drop. There is no wire to surface an error on, and the only
    // caller path (server→client) never sends to a half-closed peer in
    // practice; mirrors a closed browser socket discarding the frame.
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
  private _acceptBridge(
    cid: string,
    channel: BroadcastChannel,
    protocols: readonly string[] = [],
  ): WebSocketConnection {
    const existing = this.bridgeClients.get(cid);
    if (existing) {
      channel.postMessage({ type: 'open-ack', cid, protocol: protocols[0] ?? '' });
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
    channel.postMessage({ type: 'open-ack', cid, protocol: protocols[0] ?? '' });
    queueMicrotask(() => this.emit('connection', conn));
    return conn;
  }

  private onBridgeMessage = (e: MessageEvent): void => {
    if (this.closed) return;
    const frame = e.data as BridgeFrame;
    const channel = this.channelFromEvent(e);
    if (!channel) return;
    if (frame.type === 'open') {
      const isPortChannel = this.bridgePortChannels.has(channel);
      if (isPortChannel && frame.url === undefined) return;
      if (frame.url !== undefined) {
        if (!isPortChannel) return;
        if (!this.matchesBridgeUrl(frame.url)) return;
      }
      this._acceptBridge(frame.cid, channel, frame.protocols);
      return;
    }
    if (frame.type === 'msg') {
      const conn = this.bridgeClients.get(frame.cid);
      if (conn && frame.data !== undefined && !isControlOpcode(frame.opcode)) {
        conn.emit('message', frame.data);
      }
      return;
    }
    if (frame.type === 'close' && frame.from === 'client') {
      const conn = this.bridgeClients.get(frame.cid);
      if (conn) {
        this.clients.delete(conn);
        this.bridgeClients.delete(frame.cid);
        channel.postMessage({
          type: 'close',
          cid: frame.cid,
          code: frame.code ?? 1000,
          reason: frame.reason ?? '',
          from: 'server',
        });
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

  // Instance copies of the readyState constants, like the browser `WebSocket`.
  readonly CONNECTING = State.CONNECTING;
  readonly OPEN = State.OPEN;
  readonly CLOSING = State.CLOSING;
  readonly CLOSED = State.CLOSED;

  readonly url: string;
  protocol = '';
  extensions = '';
  binaryType: BinaryType = 'blob';
  // Same-realm/bridge sends post directly with no JS-side queue, so an honest
  // bufferedAmount is always 0 (the browser property is always present).
  bufferedAmount = 0;
  readyState: number = State.CONNECTING;

  private readonly _handlers = new Map<string, EventListener>();
  get onopen(): EventListener | null {
    return this._handlers.get('open') ?? null;
  }
  set onopen(fn: EventListener | null) {
    this._setHandler('open', fn);
  }
  get onmessage(): EventListener | null {
    return this._handlers.get('message') ?? null;
  }
  set onmessage(fn: EventListener | null) {
    this._setHandler('message', fn);
  }
  get onclose(): EventListener | null {
    return this._handlers.get('close') ?? null;
  }
  set onclose(fn: EventListener | null) {
    this._setHandler('close', fn);
  }
  get onerror(): EventListener | null {
    return this._handlers.get('error') ?? null;
  }
  set onerror(fn: EventListener | null) {
    this._setHandler('error', fn);
  }
  private _setHandler(type: string, fn: EventListener | null): void {
    const prev = this._handlers.get(type);
    if (prev) this.removeEventListener(type, prev);
    if (fn) {
      this._handlers.set(type, fn);
      this.addEventListener(type, fn);
    } else {
      this._handlers.delete(type);
    }
  }
  /** @internal */
  _server: WebSocketConnection | null = null;
  private readonly bridgeChannels: BroadcastChannel[] = [];
  private activeBridgeChannel: BroadcastChannel | null = null;
  private bridgeCid = '';
  private bridgeConnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private bridgeCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, protocols?: string | readonly string[]) {
    super();
    this.url = url;
    const protocolList = normaliseProtocols(protocols);
    let parsed: { host: string; port: number; path: string };
    try {
      parsed = parseWsUrl(url);
    } catch (err) {
      queueMicrotask(() => {
        this.readyState = State.CLOSED;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(
          new CloseEventCtor('close', { code: 1006, reason: String(err), wasClean: false }),
        );
      });
      return;
    }
    queueMicrotask(() => {
      if (this.readyState !== State.CONNECTING) return;
      const server = findListener(parsed.host, parsed.port, parsed.path);
      if (!server) {
        this.openBridge(url, protocolList);
        return;
      }
      const conn = server._accept(this);
      this._server = conn;
      this.protocol = protocolList[0] ?? '';
      this.readyState = State.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: WsMessage): void {
    if (this.readyState === State.CONNECTING) {
      throw invalidStateError(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
      );
    }
    // CLOSING/CLOSED: the WHATWG WebSocket spec discards the frame silently
    // (only CONNECTING throws), so we intentionally drop it here too.
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
    validateCloseParams(code, reason);
    const wasConnecting = this.readyState === State.CONNECTING;
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
      if (wasConnecting) {
        this.readyState = State.CLOSED;
        this.dispatchEvent(new CloseEventCtor('close', { code, reason, wasClean: false }));
        this.cleanupBridge();
        return;
      }
      // Wait for the server's close echo, but never indefinitely: a vanished
      // peer realm would otherwise strand us in CLOSING and leak the channels.
      this.bridgeCloseTimeout = setTimeout(() => {
        if (this.readyState !== State.CLOSING) return;
        this.readyState = State.CLOSED;
        this.dispatchEvent(
          new CloseEventCtor('close', {
            code: 1006,
            reason: 'close handshake timeout',
            wasClean: false,
          }),
        );
        this.cleanupBridge();
      }, BRIDGE_CLOSE_TIMEOUT_MS);
      return;
    }
    if (wasConnecting && this._server === null) {
      this.readyState = State.CLOSED;
      this.dispatchEvent(new CloseEventCtor('close', { code, reason, wasClean: false }));
      return;
    }
    queueMicrotask(() => {
      this._server?._peerClosed(code, reason);
      this._peerClosed(code, reason);
    });
  }

  /** @internal — server delivered a message */
  _deliver(data: WsMessage): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: messageDataForBinaryType(data, this.binaryType) }),
    );
  }

  /** @internal — peer (server) closed first. */
  _peerClosed(code: number, reason: string): void {
    if (this.readyState === State.CLOSED) return;
    const wasClean = code !== 1006 && this.readyState !== State.CONNECTING;
    this.readyState = State.CLOSED;
    this.dispatchEvent(new CloseEventCtor('close', { code, reason, wasClean }));
  }

  private openBridge(url: string, protocols: readonly string[] = []): void {
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
      channel.postMessage({ type: 'open', cid: this.bridgeCid, url, protocols });
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
      this.protocol = frame.protocol ?? '';
      this.readyState = State.OPEN;
      this.dispatchEvent(new Event('open'));
      return;
    }
    if (frame.type === 'msg' && this.readyState === State.OPEN && frame.data !== undefined) {
      if (frame.opcode === 0x9) {
        // Browser WebSocket answers a server ping at the protocol layer without
        // exposing it; mirror that — pong back over the bridge, surface nothing.
        this.activeBridgeChannel?.postMessage({
          type: 'msg',
          cid: this.bridgeCid,
          data: frame.data,
          opcode: 0xa,
        });
        return;
      }
      if (isControlOpcode(frame.opcode)) return;
      this.dispatchEvent(
        new MessageEvent('message', {
          data: messageDataForBinaryType(frame.data, this.binaryType),
        }),
      );
      return;
    }
    if (frame.type === 'close' && frame.from === 'server') {
      if (this.readyState === State.CLOSED) return;
      const code = frame.code ?? 1000;
      const wasClean = code !== 1006 && this.readyState !== State.CONNECTING;
      if (this.readyState === State.CONNECTING) this.dispatchEvent(new Event('error'));
      this.readyState = State.CLOSED;
      this.dispatchEvent(
        new CloseEventCtor('close', { code, reason: frame.reason ?? '', wasClean }),
      );
      this.cleanupBridge();
    }
  };

  private failBridgeConnection(): void {
    this.readyState = State.CLOSED;
    this.dispatchEvent(new Event('error'));
    this.dispatchEvent(
      new CloseEventCtor('close', { code: 1006, reason: 'connection refused', wasClean: false }),
    );
    this.cleanupBridge();
  }

  private clearBridgeConnectTimeout(): void {
    if (!this.bridgeConnectTimeout) return;
    clearTimeout(this.bridgeConnectTimeout);
    this.bridgeConnectTimeout = null;
  }

  private cleanupBridge(): void {
    this.clearBridgeConnectTimeout();
    if (this.bridgeCloseTimeout) {
      clearTimeout(this.bridgeCloseTimeout);
      this.bridgeCloseTimeout = null;
    }
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

function normaliseProtocols(protocols: string | readonly string[] | undefined): readonly string[] {
  if (protocols === undefined) return [];
  const out = typeof protocols === 'string' ? [protocols] : protocols;
  const seen = new Set<string>();
  return out.map((protocol) => {
    if (!isValidProtocolToken(protocol)) {
      throw new DOMException(
        `Failed to construct 'WebSocket': The subprotocol '${protocol}' is invalid.`,
        'SyntaxError',
      );
    }
    if (seen.has(protocol)) {
      throw new DOMException(
        `Failed to construct 'WebSocket': The subprotocol '${protocol}' is duplicated.`,
        'SyntaxError',
      );
    }
    seen.add(protocol);
    return protocol;
  });
}

function isValidProtocolToken(protocol: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(protocol);
}

export function isControlOpcode(opcode: number | undefined): boolean {
  return opcode === 0x9 || opcode === 0xa;
}

function invalidStateError(message: string): Error {
  try {
    return new DOMException(message, 'InvalidStateError');
  } catch {
    const err = new Error(message);
    err.name = 'InvalidStateError';
    return err;
  }
}

function validateCloseParams(code: number, reason: string): void {
  if (code !== 1000 && (code < 3000 || code > 4999)) {
    throw new DOMException(
      "Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999.",
      'InvalidAccessError',
    );
  }
  if (new TextEncoder().encode(reason).byteLength > 123) {
    throw new DOMException(
      "Failed to execute 'close' on 'WebSocket': The message must not be greater than 123 bytes.",
      'SyntaxError',
    );
  }
}

function arrayBufferFromBinary(data: WsMessage): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    // Copy into a fresh ArrayBuffer (not the possibly-shared backing buffer).
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  return null;
}

/** Coerce a delivered binary frame to the client's `binaryType`, like the browser. */
export function messageDataForBinaryType(
  data: WsMessage,
  binaryType: BinaryType,
): WsMessage | Blob {
  const ab = arrayBufferFromBinary(data);
  if (!ab) return data;
  if (binaryType === 'arraybuffer') return ab;
  if (typeof Blob !== 'undefined') return new Blob([ab]);
  return ab;
}
