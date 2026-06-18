/**
 * Cross-realm WebSocket bridge over `BroadcastChannel` (ADR-0017 phase 1).
 *
 * Compatibility facade for callers that explicitly want a bridge-only
 * `WebSocket` / `WebSocketServer` pair. The default WebSocket surface in
 * `./in-process.ts` now uses the same protocol as a cross-realm fallback.
 *
 * `BroadcastChannel` is the simplest browser primitive that does this: any
 * realm same-origin to the playground can open the same-named channel and
 * see each other's messages. The opt-in server keeps the original one-channel
 * per WS URL contract; clients also announce on a port discovery channel so
 * the default `WebSocketServer` can accept wildcard hosts across realms.
 *
 * The bridge speaks a tiny wire protocol:
 *   { type: 'open',  cid }
 *   { type: 'open-ack', cid }
 *   { type: 'msg',   cid, data }
 *   { type: 'close', cid, code, reason, from: 'client' | 'server' }
 *
 * Real TCP WebSocket is not in scope here; this is the same-origin browser
 * transport that keeps rifty-hosted dev servers reachable across realms.
 */

import { EventEmitter } from '@riftydev/io';
import { channelNameFor, portChannelNameFor } from './channel.ts';
import { CloseEventCtor } from './close-event.ts';
import { State, type WsMessage } from './in-process.ts';

interface BridgeFrame {
  type: 'open' | 'open-ack' | 'msg' | 'close';
  cid: string;
  data?: WsMessage;
  code?: number;
  reason?: string;
  from?: 'client' | 'server';
  url?: string;
  protocols?: readonly string[];
  protocol?: string;
}

interface BridgedWebSocketOptions {
  connectTimeoutMs?: number;
  protocols?: string | readonly string[];
}

let connectionCounter = 0;
function nextCid(): string {
  return `c${++connectionCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CrossRealmBridge {
  /** Tear down the bridge — both client and server stop listening. */
  close(): void;
}

/**
 * Bridged server endpoint, EventEmitter-shape (`message`, `close`, `error`).
 * One instance per accepted connection. Created by `BridgedWebSocketServer`.
 */
export class BridgedWebSocketConnection extends EventEmitter {
  state: State = State.OPEN;
  get readyState(): number {
    return this.state;
  }
  /** @internal */
  _send: (frame: BridgeFrame) => void;
  /** @internal */
  _cid: string;

  constructor(cid: string, send: (frame: BridgeFrame) => void) {
    super();
    this._cid = cid;
    this._send = send;
  }

  send(data: WsMessage): void {
    if (this.state !== State.OPEN) return;
    this._send({ type: 'msg', cid: this._cid, data });
  }

  close(code = 1000, reason = ''): void {
    if (this.state === State.CLOSED || this.state === State.CLOSING) return;
    this.state = State.CLOSING;
    this._send({ type: 'close', cid: this._cid, code, reason, from: 'server' });
    this.state = State.CLOSED;
    queueMicrotask(() => this.emit('close', code, reason));
  }

  /** @internal — peer closed first. */
  _peerClosed(code: number, reason: string): void {
    if (this.state === State.CLOSED) return;
    this.state = State.CLOSED;
    this.emit('close', code, reason);
  }
}

/**
 * Cross-realm `WebSocketServer` that listens on a `BroadcastChannel` derived
 * from `url`. Accepts connections from `BridgedWebSocket` clients in any
 * same-origin realm. Mirrors the same-realm `WebSocketServer` event surface.
 */
export class BridgedWebSocketServer extends EventEmitter {
  private readonly channel: BroadcastChannel;
  private readonly clients: Map<string, BridgedWebSocketConnection> = new Map();
  private closed = false;

  constructor(public readonly url: string) {
    super();
    this.channel = new BroadcastChannel(channelNameFor(url));
    this.channel.addEventListener('message', this.onMessage);
  }

  private onMessage = (e: MessageEvent): void => {
    const frame = e.data as BridgeFrame;
    if (frame.type === 'open') {
      const conn = new BridgedWebSocketConnection(frame.cid, (f) => this.channel.postMessage(f));
      this.clients.set(frame.cid, conn);
      this.channel.postMessage({
        type: 'open-ack',
        cid: frame.cid,
        protocol: frame.protocols?.[0] ?? '',
      });
      queueMicrotask(() => this.emit('connection', conn));
      return;
    }
    if (frame.type === 'msg') {
      const conn = this.clients.get(frame.cid);
      if (conn && frame.data !== undefined) conn.emit('message', frame.data);
      return;
    }
    if (frame.type === 'close' && frame.from === 'client') {
      const conn = this.clients.get(frame.cid);
      if (conn) {
        this.clients.delete(frame.cid);
        this.channel.postMessage({
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

  broadcast(data: WsMessage): void {
    for (const c of this.clients.values()) c.send(data);
  }

  close(cb?: () => void): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of [...this.clients.values()]) c.close();
    this.clients.clear();
    this.channel.removeEventListener('message', this.onMessage);
    this.channel.close();
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
  }
}

/**
 * Cross-realm `WebSocket` client. Connects to whichever
 * `BridgedWebSocketServer` is listening on the matching `BroadcastChannel`.
 * Mirrors the browser `WebSocket` event surface.
 *
 * Connection negotiation is asynchronous — the client posts `{type:'open'}`
 * and waits for `{type:'open-ack'}` before firing `open`. If no ack arrives
 * within `connectTimeoutMs` (default 1000 ms) the client fires `error` and
 * `close` with code 1006 (matches `WebSocket` "connection refused" semantics).
 */
export class BridgedWebSocket extends EventTarget {
  static readonly CONNECTING = State.CONNECTING;
  static readonly OPEN = State.OPEN;
  static readonly CLOSING = State.CLOSING;
  static readonly CLOSED = State.CLOSED;

  readyState: number = State.CONNECTING;
  protocol = '';
  extensions = '';
  binaryType: BinaryType = 'blob';
  private readonly channels: BroadcastChannel[] = [];
  private activeChannel: BroadcastChannel | null = null;
  private readonly cid: string;
  private readonly timeoutMs: number;
  private readonly connectTimeout: ReturnType<typeof setTimeout>;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly url: string,
    protocolsOrOptions: string | readonly string[] | BridgedWebSocketOptions = {},
  ) {
    super();
    const options = isBridgedWebSocketOptions(protocolsOrOptions) ? protocolsOrOptions : {};
    const protocols = isBridgedWebSocketOptions(protocolsOrOptions)
      ? normaliseProtocols(protocolsOrOptions.protocols)
      : normaliseProtocols(protocolsOrOptions);
    this.timeoutMs = options.connectTimeoutMs ?? 1000;
    this.cid = nextCid();
    for (const channelName of new Set([channelNameFor(url), portChannelNameFor(url)])) {
      const channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', this.onMessage);
      this.channels.push(channel);
    }
    for (const channel of this.channels) {
      channel.postMessage({ type: 'open', cid: this.cid, url, protocols });
    }
    this.connectTimeout = setTimeout(() => {
      if (this.readyState !== State.CONNECTING) return;
      this.readyState = State.CLOSED;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(
        new CloseEventCtor('close', { code: 1006, reason: 'connection refused', wasClean: false }),
      );
      this.cleanup();
    }, this.timeoutMs);
  }

  private onMessage = (e: MessageEvent): void => {
    const frame = e.data as BridgeFrame;
    if (frame.cid !== this.cid) return;
    if (frame.type === 'open-ack' && this.readyState === State.CONNECTING) {
      clearTimeout(this.connectTimeout);
      this.activeChannel = this.channelFromEvent(e);
      this.closeInactiveChannels();
      this.protocol = frame.protocol ?? '';
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
      const code = frame.code ?? 1000;
      const wasClean = code !== 1006 && this.readyState !== State.CONNECTING;
      if (this.readyState === State.CONNECTING) this.dispatchEvent(new Event('error'));
      this.readyState = State.CLOSED;
      this.dispatchEvent(
        new CloseEventCtor('close', { code, reason: frame.reason ?? '', wasClean }),
      );
      this.cleanup();
    }
  };

  send(data: WsMessage): void {
    if (this.readyState === State.CONNECTING) {
      throw invalidStateError(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
      );
    }
    if (this.readyState !== State.OPEN) return;
    this.activeChannel?.postMessage({ type: 'msg', cid: this.cid, data });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === State.CLOSED || this.readyState === State.CLOSING) return;
    validateCloseParams(code, reason);
    const wasConnecting = this.readyState === State.CONNECTING;
    this.readyState = State.CLOSING;
    const targets = this.activeChannel ? [this.activeChannel] : this.channels;
    for (const channel of targets) {
      channel.postMessage({ type: 'close', cid: this.cid, code, reason, from: 'client' });
    }
    if (wasConnecting) {
      this.readyState = State.CLOSED;
      this.dispatchEvent(new CloseEventCtor('close', { code, reason, wasClean: false }));
      this.cleanup();
      return;
    }
    // Bound the closing handshake: if the peer realm vanished, the server echo
    // never arrives — end locally with 1006 rather than hang in CLOSING.
    this.closeTimeout = setTimeout(() => {
      if (this.readyState !== State.CLOSING) return;
      this.readyState = State.CLOSED;
      this.dispatchEvent(
        new CloseEventCtor('close', {
          code: 1006,
          reason: 'close handshake timeout',
          wasClean: false,
        }),
      );
      this.cleanup();
    }, this.timeoutMs);
  }

  private channelFromEvent(e: MessageEvent): BroadcastChannel | null {
    const target = e.currentTarget;
    return (
      this.channels.find((channel) => channel === target) ??
      this.activeChannel ??
      this.channels[0] ??
      null
    );
  }

  private closeInactiveChannels(): void {
    for (const channel of [...this.channels]) {
      if (channel === this.activeChannel) continue;
      channel.removeEventListener('message', this.onMessage);
      channel.close();
      this.channels.splice(this.channels.indexOf(channel), 1);
    }
  }

  private cleanup(): void {
    clearTimeout(this.connectTimeout);
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
    for (const channel of this.channels) {
      channel.removeEventListener('message', this.onMessage);
      channel.close();
    }
    this.channels.length = 0;
    this.activeChannel = null;
  }
}

function isBridgedWebSocketOptions(
  value: string | readonly string[] | BridgedWebSocketOptions,
): value is BridgedWebSocketOptions {
  return typeof value === 'object' && !Array.isArray(value);
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

/**
 * Opt-in entry point: returns the cross-realm `WebSocket` / `WebSocketServer`
 * pair backed by `BroadcastChannel`. Use these when the client and server
 * live in different realms (iframe HMR client ↔ playground dev-server).
 *
 * The default same-realm shim in `./in-process.ts` remains the export of
 * `@riftydev/net` for the legacy code paths (tests, in-process dev-server).
 */
export function createCrossRealmBridge(): {
  WebSocket: typeof BridgedWebSocket;
  WebSocketServer: typeof BridgedWebSocketServer;
} {
  return { WebSocket: BridgedWebSocket, WebSocketServer: BridgedWebSocketServer };
}

export { channelNameFor, portChannelNameFor } from './channel.ts';
