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
      this.channel.postMessage({ type: 'open-ack', cid: frame.cid });
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
  private readonly channels: BroadcastChannel[] = [];
  private activeChannel: BroadcastChannel | null = null;
  private readonly cid: string;
  private readonly connectTimeout: ReturnType<typeof setTimeout>;

  constructor(
    public readonly url: string,
    options: { connectTimeoutMs?: number } = {},
  ) {
    super();
    this.cid = nextCid();
    for (const channelName of new Set([channelNameFor(url), portChannelNameFor(url)])) {
      const channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', this.onMessage);
      this.channels.push(channel);
    }
    for (const channel of this.channels) {
      channel.postMessage({ type: 'open', cid: this.cid, url });
    }
    this.connectTimeout = setTimeout(() => {
      if (this.readyState !== State.CONNECTING) return;
      this.readyState = State.CLOSED;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new CloseEventCtor('close', { code: 1006, reason: 'connection refused' }));
      this.cleanup();
    }, options.connectTimeoutMs ?? 1000);
  }

  private onMessage = (e: MessageEvent): void => {
    const frame = e.data as BridgeFrame;
    if (frame.cid !== this.cid) return;
    if (frame.type === 'open-ack' && this.readyState === State.CONNECTING) {
      clearTimeout(this.connectTimeout);
      this.activeChannel = this.channelFromEvent(e);
      this.closeInactiveChannels();
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
      this.cleanup();
    }
  };

  send(data: WsMessage): void {
    if (this.readyState !== State.OPEN) return;
    this.activeChannel?.postMessage({ type: 'msg', cid: this.cid, data });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === State.CLOSED || this.readyState === State.CLOSING) return;
    this.readyState = State.CLOSING;
    const targets = this.activeChannel ? [this.activeChannel] : this.channels;
    for (const channel of targets) {
      channel.postMessage({ type: 'close', cid: this.cid, code, reason, from: 'client' });
    }
    this.readyState = State.CLOSED;
    this.dispatchEvent(new CloseEventCtor('close', { code, reason }));
    this.cleanup();
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
    for (const channel of this.channels) {
      channel.removeEventListener('message', this.onMessage);
      channel.close();
    }
    this.channels.length = 0;
    this.activeChannel = null;
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
