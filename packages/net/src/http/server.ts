/**
 * HTTP `Server` + `request()` client over the port registry.
 *
 * Server: registers a handler that builds `IncomingMessage` + streaming
 * `ServerResponse` for each request and returns the response (a fetch
 * `Response` whose body is the streaming `ReadableStream` written by user
 * code).
 *
 * Client: `http.request()` loops back through the registry for registered local
 * ports; loopback ports with no listener fail with Node-shaped `ECONNREFUSED`;
 * everything else (external hosts, non-http protocols) issues through the host
 * `fetch`. The returned emitter carries `'response'` with an
 * `IncomingMessageFromFetch`.
 *
 * Scope gotcha: the port registry is realm-local (per Worker process). A server
 * listening in another Worker is NOT reachable via loopback here — see
 * docs/backlog/net/cross-realm-http-loopback.
 */

import { Buffer, EventEmitter, NotImplementedError } from '@riftydev/io';
import {
  addrInUseError,
  dispatchToPort,
  getHandler,
  isPortBound,
  registerPort,
  unregisterPort,
} from '../registry.ts';
import { channelNameFor, portChannelNameFor, portChannelNameForPort } from '../ws/channel.ts';
import type { WsMessage } from '../ws/in-process.ts';
import { IncomingMessage, IncomingMessageFromFetch } from './request.ts';
import { ServerResponse } from './response.ts';
import { STATUS_CODES } from './status-codes.ts';
import {
  type WebSocketBridgeFrame,
  WebSocketClientSocket,
  WebSocketUpgradeSocket,
  createWebSocketAccept,
  createWebSocketKey,
  createWebSocketUpgradeHeaders,
} from './upgrade-socket.ts';

// Shared one-shot utf8 encoder for request-body string chunks (stateless).
const UTF8_ENCODER = new TextEncoder();

/**
 * Subset of Node's `net.ListenOptions` accepted by {@link HttpServer.listen}.
 * Only `port` is honoured; `host` is ignored (rifty is loopback-only — see
 * `request.ts`), and `backlog`/`exclusive` are accepted-but-unused for
 * Node-shape parity.
 */
export interface ListenOptions {
  port?: number;
  host?: string;
  backlog?: number;
  exclusive?: boolean;
}

export class HttpServer extends EventEmitter {
  private port: number | null = null;
  private readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
  private readonly upgradeChannels: BroadcastChannel[] = [];
  private readonly upgradeSockets: Map<string, WebSocketUpgradeSocket> = new Map();

  constructor(handler: (req: IncomingMessage, res: ServerResponse) => void = () => {}) {
    super();
    this.handler = handler;
  }

  /**
   * Bind the server to a port and register it in the port registry.
   *
   * Accepts Node's two principal `Server.listen` shapes:
   *   - bare number: `listen(port, hostnameOrCb?, cb?)`
   *   - options object: `listen({ port, host }, cb?)`
   *
   * The options form is required by `@effect/platform-node`'s
   * `NodeHttpServer.layer`, which always calls `listen({ port, host }, cb)`.
   * Both forms extract a numeric port; `host` is ignored (loopback-only).
   *
   * TODO(backlog: net/http-listen-options-overload)
   */
  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this;
  listen(options: ListenOptions, cb?: () => void): this;
  listen(
    portOrOptions: number | ListenOptions,
    hostnameOrCb?: string | (() => void),
    cb?: () => void,
  ): this {
    const port = typeof portOrOptions === 'number' ? portOrOptions : (portOrOptions.port ?? 0);
    // Both call shapes: callback is whichever of the two trailing args is a function.
    const callback = (typeof hostnameOrCb === 'function' ? hostnameOrCb : cb) as
      | (() => void)
      | undefined;
    // Port already bound in this realm → Node emits an async `'error'` EADDRINUSE
    // (NOT a sync throw): the server is returned, `'listening'` never fires, and an
    // unhandled `'error'` on an EventEmitter throws (faithful, ADR-0157 review C3).
    if (isPortBound(port)) {
      queueMicrotask(() => this.emit('error', addrInUseError('127.0.0.1', port)));
      return this;
    }
    this.port = port;
    registerPort(port, (request) => {
      if (isWebSocketUpgradeRequest(request)) {
        return new Response('WebSocket upgrade requires the rifty WebSocket bridge transport', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'text/plain' },
        });
      }
      const req = new IncomingMessage(request);
      const res = new ServerResponse();
      this.handler(req, res);
      this.emit('request', req, res);
      return res.toResponse();
    });
    this.listenForWebSocketUpgrades(port);
    queueMicrotask(() => {
      this.emit('listening');
      callback?.();
    });
    return this;
  }

  address(): { port: number } | null {
    return this.port === null ? null : { port: this.port };
  }

  close(cb?: () => void): this {
    if (this.port !== null) {
      unregisterPort(this.port);
      this.port = null;
    }
    for (const socket of this.upgradeSockets.values()) socket.destroy();
    this.upgradeSockets.clear();
    for (const channel of this.upgradeChannels) {
      channel.removeEventListener('message', this.onWebSocketBridgeMessage);
      channel.close();
    }
    this.upgradeChannels.length = 0;
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
    return this;
  }

  private listenForWebSocketUpgrades(port: number): void {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(portChannelNameForPort(port));
    channel.addEventListener('message', this.onWebSocketBridgeMessage);
    this.upgradeChannels.push(channel);
  }

  private onWebSocketBridgeMessage = (event: MessageEvent): void => {
    const frame = event.data as WebSocketBridgeFrame;
    const channel = this.upgradeChannels.find((candidate) => candidate === event.currentTarget);
    if (!channel || this.port === null) return;
    if (frame.type === 'open') {
      this.acceptUpgradeOpenFrame(channel, frame);
      return;
    }
    const socket = this.upgradeSockets.get(frame.cid);
    if (!socket) return;
    if (frame.type === 'msg' && frame.data !== undefined) {
      socket._receiveBridgeMessage(frame.data, frame.opcode);
      return;
    }
    if (frame.type === 'close' && frame.from === 'client') {
      socket._receiveBridgeClose(frame.code ?? 1000, frame.reason ?? '');
    }
  };

  private acceptUpgradeOpenFrame(channel: BroadcastChannel, frame: WebSocketBridgeFrame): void {
    if (this.port === null) return;
    if (this.listenerCount('upgrade') === 0) return;
    if (frame.url === undefined) return;
    let url: URL;
    try {
      url = new URL(frame.url);
    } catch {
      channel.postMessage({
        type: 'close',
        cid: frame.cid,
        code: 1006,
        reason: 'invalid websocket url',
        from: 'server',
      } satisfies WebSocketBridgeFrame);
      return;
    }
    if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || portForWsUrl(url) !== this.port) {
      return;
    }
    const key = isValidWebSocketKey(frame.key) ? frame.key : createWebSocketKey();
    const protocols = normaliseProtocols(frame.protocols);
    const socket = new WebSocketUpgradeSocket({
      cid: frame.cid,
      url: frame.url,
      protocols,
      encrypted: url.protocol === 'wss:',
      sendBridgeFrame: (reply) => channel.postMessage(reply),
    });
    socket._setRequestKey(key);
    this.upgradeSockets.set(frame.cid, socket);
    socket.once('close', () => this.upgradeSockets.delete(frame.cid));
    const req = new IncomingMessage({
      method: 'GET',
      url: `http://${url.host}${url.pathname}${url.search}`,
      headers: createWebSocketUpgradeHeaders({
        host: url.host,
        key,
        protocols,
      }),
      body: null,
      socket,
    });
    this.emit('upgrade', req, socket, Buffer.alloc(0));
  }
}

export function createServer(
  handler?: (req: IncomingMessage, res: ServerResponse) => void,
): HttpServer {
  return new HttpServer(handler);
}

interface RequestOptions {
  method?: string;
  host?: string;
  hostname?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
  protocol?: string;
}

export type ClientRequest = EventEmitter & {
  write(chunk: Uint8Array | string): boolean;
  end(chunkOrCb?: Uint8Array | string | (() => void), cb?: () => void): void;
  abort(): void;
  destroy(err?: Error): void;
  setTimeout(timeout: number, cb?: () => void): ClientRequest;
};
export type ClientResponse = IncomingMessageFromFetch;

const LOOPBACK_HOSTS = new Set(['localhost', '0.0.0.0', '::1', '[::1]']);

// Whole 127.0.0.0/8 block is loopback (Node connects any 127.x.y.z locally).
function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(lower)) return true;
  return /^127(\.\d{1,3}){3}$/.test(lower);
}

function bracketIpv6Host(host: string): string {
  if (host.startsWith('[')) return host;
  const colonCount = host.split(':').length - 1;
  return colonCount > 1 ? `[${host}]` : host;
}

function buildRequestUrl(opts: RequestOptions): string {
  const protocol = opts.protocol ?? 'http:';
  const path = opts.path ?? '/';
  if (opts.hostname !== undefined) {
    const host = bracketIpv6Host(opts.hostname);
    const port = opts.port === undefined ? '' : `:${opts.port}`;
    return `${protocol}//${host}${port}${path}`;
  }
  if (opts.host !== undefined) {
    const host = bracketIpv6Host(opts.host);
    const port = opts.port === undefined ? '' : `:${opts.port}`;
    return `${protocol}//${host}${port}${path}`;
  }
  const port = opts.port === undefined ? '' : `:${opts.port}`;
  return `${protocol}//localhost${port}${path}`;
}

type ClientRoute =
  | { kind: 'local'; port: number }
  | { kind: 'refused'; address: string; port: number }
  | { kind: 'fetch' };

/**
 * Route an outgoing client request. `http:` + loopback host: a registered port
 * dispatches in-process; an unregistered one is a dead end (the registry is the
 * realm's whole network namespace), surfaced as Node-shaped `ECONNREFUSED`
 * instead of leaking to the host machine's real loopback. Anything else
 * (external hosts, `https:`) keeps real `fetch` egress.
 */
function routeClientRequest(url: string): ClientRoute {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'fetch' };
  }
  if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) return { kind: 'fetch' };
  const port = parsed.port === '' ? 80 : Number(parsed.port);
  if (!Number.isInteger(port)) return { kind: 'fetch' };
  if (getHandler(port) !== null) return { kind: 'local', port };
  const address = parsed.hostname.includes(':') ? '::1' : '127.0.0.1';
  return { kind: 'refused', address, port };
}

function connRefusedError(address: string, port: number): Error {
  return Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
    code: 'ECONNREFUSED',
    errno: -111,
    syscall: 'connect',
    address,
    port,
  });
}

function streamWriteAfterEndError(): Error {
  return Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' });
}

function portForWsUrl(url: URL): number {
  if (url.port !== '') return Number.parseInt(url.port, 10);
  return url.protocol === 'wss:' ? 443 : 80;
}

function normaliseProtocols(protocols: readonly string[] | undefined): readonly string[] {
  if (!protocols) return [];
  return protocols.filter((protocol) => typeof protocol === 'string' && protocol.length > 0);
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  const upgrade = request.headers.get('upgrade');
  if (upgrade?.toLowerCase() !== 'websocket') return false;
  const connection = request.headers.get('connection');
  return connectionHasToken(connection, 'upgrade');
}

function isWebSocketUpgradeHeaders(headers: Record<string, string>): boolean {
  return (
    headerValue(headers, 'upgrade')?.toLowerCase() === 'websocket' &&
    connectionHasToken(headerValue(headers, 'connection'), 'upgrade')
  );
}

function connectionHasToken(value: string | null | undefined, token: string): boolean {
  return value
    ? value
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .includes(token)
    : false;
}

/**
 * `http.request(url | opts[, opts][, cb])` — registered local loopback ports
 * route through the in-process registry; unregistered loopback ports emit
 * `ECONNREFUSED`; everything else falls through to the host's `fetch`. The
 * callback receives an `IncomingMessage` once the response arrives. Local
 * outgoing bodies are sent as a live `ReadableStream`, so `req.write()` chunk
 * boundaries are preserved through to the server-side `IncomingMessage`.
 */
export function request(
  urlOrOpts: string | RequestOptions,
  optsOrCb?: RequestOptions | ((res: ClientResponse) => void),
  maybeCb?: (res: ClientResponse) => void,
): ClientRequest {
  // Node's 3-arg form `request(url, options, cb)`: options override URL parts.
  const overrides = typeof optsOrCb === 'object' ? optsOrCb : undefined;
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
  let url: string;
  if (typeof urlOrOpts === 'string') {
    url = overrides ? buildRequestUrl({ ...optionsFromUrl(urlOrOpts), ...overrides }) : urlOrOpts;
  } else {
    url = buildRequestUrl(urlOrOpts);
  }
  const base = typeof urlOrOpts === 'string' ? undefined : urlOrOpts;
  const method = overrides?.method ?? base?.method ?? 'GET';
  const headers = overrides?.headers ?? base?.headers ?? {};

  const emitter = new EventEmitter();
  let finished = false;
  let aborted = false;
  let dispatchStarted = false;
  let bodyClosed = false;
  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let requestBody: ReadableStream<Uint8Array> | null = null;
  let needDrain = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let upgradeCleanup: (() => void) | undefined;
  let upgradeSocket: WebSocketClientSocket | undefined;
  const abortController = new AbortController();

  const ensureBodyStream = (): ReadableStream<Uint8Array> => {
    if (requestBody !== null) return requestBody;
    requestBody = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
      pull() {
        if (!needDrain) return;
        needDrain = false;
        queueMicrotask(() => emitter.emit('drain'));
      },
      cancel() {
        bodyClosed = true;
      },
    });
    return requestBody;
  };

  const enqueueBodyChunk = (chunk: Uint8Array | string): boolean => {
    const stream = ensureBodyStream();
    void stream;
    const ctrl = bodyController;
    if (ctrl === null || bodyClosed) return false;
    const buf = typeof chunk === 'string' ? UTF8_ENCODER.encode(chunk) : chunk;
    if (buf.byteLength === 0) return true;
    const desiredSize = ctrl.desiredSize;
    ctrl.enqueue(buf);
    if (desiredSize !== null && desiredSize <= 0) {
      needDrain = true;
      return false;
    }
    return true;
  };

  const closeBodyStream = (): void => {
    if (bodyClosed) return;
    bodyClosed = true;
    bodyController?.close();
  };

  const failBodyStream = (err: Error): void => {
    if (bodyClosed) return;
    bodyClosed = true;
    try {
      bodyController?.error(err);
    } catch {
      /* controller already closed */
    }
  };

  const startDispatch = (): void => {
    if (dispatchStarted) return;
    dispatchStarted = true;
    void (async () => {
      // Defer one microtask so listeners attached AFTER write()/end() — the
      // standard Node pattern — still see 'finish'/'error'/'response'.
      await Promise.resolve();
      if (aborted) return;
      const route = routeClientRequest(url);
      if (isWebSocketUpgradeHeaders(headers)) {
        if (route.kind === 'local') {
          try {
            const opened = openWebSocketClientUpgrade({
              url,
              headers,
              port: route.port,
              emitter,
              isAborted: () => aborted,
            });
            upgradeCleanup = opened.cleanup;
            upgradeSocket = opened.socket;
          } catch (err) {
            emitter.emit('error', err);
          }
          return;
        }
        if (route.kind === 'refused') {
          emitter.emit('error', connRefusedError(route.address, route.port));
          return;
        }
        try {
          const opened = openNativeWebSocketClientUpgrade({
            url,
            headers,
            emitter,
            isAborted: () => aborted,
          });
          upgradeCleanup = opened.cleanup;
          upgradeSocket = opened.socket;
        } catch (err) {
          emitter.emit('error', err);
        }
        return;
      }
      if (requestBody !== null && (method === 'GET' || method === 'HEAD')) {
        const err = new TypeError(`Request with ${method} method cannot have a body`);
        failBodyStream(err);
        emitter.emit('error', err);
        return;
      }
      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
        signal: abortController.signal,
      };
      if (requestBody !== null) {
        init.body = requestBody as unknown as BodyInit;
        init.duplex = 'half';
      }
      if (route.kind === 'refused') {
        emitter.emit('error', connRefusedError(route.address, route.port));
        return;
      }
      try {
        const response =
          route.kind === 'local'
            ? await dispatchToPort(route.port, new Request(url, init))
            : await fetch(url, init);
        const incoming = new IncomingMessageFromFetch(response);
        cb?.(incoming);
        emitter.emit('response', incoming);
      } catch (err) {
        emitter.emit('error', err);
      }
    })();
  };

  const req = Object.assign(emitter, {
    write(chunk: Uint8Array | string): boolean {
      if (finished) {
        queueMicrotask(() => emitter.emit('error', streamWriteAfterEndError()));
        return false;
      }
      const ok = enqueueBodyChunk(chunk);
      startDispatch();
      return ok;
    },
    end(chunkOrCb?: Uint8Array | string | (() => void), endCb?: () => void): void {
      const finishCb = typeof chunkOrCb === 'function' ? chunkOrCb : endCb;
      const chunk = typeof chunkOrCb === 'function' ? undefined : chunkOrCb;
      if (finished) {
        // Node: data after end errors; a bare repeated end() is a no-op.
        if (chunk !== undefined) {
          queueMicrotask(() => emitter.emit('error', streamWriteAfterEndError()));
        }
        return;
      }
      finished = true;
      if (chunk !== undefined) enqueueBodyChunk(chunk);
      closeBodyStream();
      if (finishCb) emitter.once('finish', finishCb);
      void Promise.resolve().then(() => emitter.emit('finish'));
      startDispatch();
    },
    abort(): void {
      req.destroy();
    },
    destroy(err?: Error): void {
      if (aborted) return;
      aborted = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      abortController.abort();
      failBodyStream(err ?? new Error('request destroyed'));
      upgradeCleanup?.();
      upgradeSocket?.destroy(err);
      if (err) queueMicrotask(() => emitter.emit('error', err));
    },
    setTimeout(timeout: number, cb?: () => void): ClientRequest {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (cb) emitter.once('timeout', cb);
      timeoutId = setTimeout(() => {
        emitter.emit('timeout');
      }, timeout);
      return req;
    },
  });
  return req;
}

function openWebSocketClientUpgrade(opts: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly port: number;
  readonly emitter: EventEmitter;
  readonly isAborted: () => boolean;
}): { readonly socket: WebSocketClientSocket; readonly cleanup: () => void } {
  const wsUrl = toWebSocketUrl(opts.url);
  const cid = `http-ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const key = headerValue(opts.headers, 'sec-websocket-key');
  if (!isValidWebSocketKey(key)) {
    throw new Error('WebSocket client upgrade missing a valid Sec-WebSocket-Key header');
  }
  const protocols = splitHeaderList(headerValue(opts.headers, 'sec-websocket-protocol'));
  const channels = [...new Set([channelNameFor(wsUrl), portChannelNameFor(wsUrl)])].map(
    (name) => new BroadcastChannel(name),
  );
  let activeChannel: BroadcastChannel | null = null;
  let opened = false;
  let closed = false;
  const connectTimer = setTimeout(() => {
    if (opened || opts.isAborted()) return;
    cleanup();
    opts.emitter.emit('error', connRefusedError('127.0.0.1', opts.port));
  }, 1000);

  const post = (frame: WebSocketBridgeFrame): void => {
    const targets = activeChannel ? [activeChannel] : channels;
    for (const channel of targets) channel.postMessage(frame);
  };
  const socket = new WebSocketClientSocket({ cid, sendBridgeFrame: post });

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    for (const channel of channels) {
      channel.removeEventListener('message', onMessage);
      channel.close();
    }
  };

  const closeInactiveChannels = (): void => {
    for (const channel of channels) {
      if (channel === activeChannel) continue;
      channel.removeEventListener('message', onMessage);
      channel.close();
    }
  };

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as WebSocketBridgeFrame;
    if (!frame || frame.cid !== cid || opts.isAborted()) return;
    if (frame.type === 'open-ack' && !opened) {
      opened = true;
      clearTimeout(connectTimer);
      activeChannel =
        channels.find((channel) => channel === event.currentTarget) ??
        activeChannel ??
        channels[0] ??
        null;
      closeInactiveChannels();
      const responseHeaders: Record<string, string> = {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-accept': createWebSocketAccept(key),
      };
      if (frame.protocol) responseHeaders['sec-websocket-protocol'] = frame.protocol;
      opts.emitter.emit(
        'upgrade',
        {
          statusCode: 101,
          statusMessage: 'Switching Protocols',
          headers: responseHeaders,
        },
        socket,
        Buffer.alloc(0),
      );
      return;
    }
    if (frame.type === 'msg' && opened && frame.data !== undefined) {
      socket._receiveBridgeMessage(frame.data);
      return;
    }
    if (frame.type === 'close' && frame.from === 'server') {
      if (!opened) {
        cleanup();
        opts.emitter.emit('error', new Error(frame.reason || 'websocket upgrade rejected'));
        return;
      }
      socket._receiveBridgeClose(frame.code ?? 1000, frame.reason ?? '');
      cleanup();
    }
  };

  for (const channel of channels) channel.addEventListener('message', onMessage);
  post({
    type: 'open',
    cid,
    url: wsUrl,
    key,
    protocols,
  });
  socket.once('close', cleanup);
  return { socket, cleanup };
}

function openNativeWebSocketClientUpgrade(opts: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly emitter: EventEmitter;
  readonly isAborted: () => boolean;
}): { readonly socket: WebSocketClientSocket; readonly cleanup: () => void } {
  if (typeof WebSocket === 'undefined') {
    throw new NotImplementedError(
      'net.websocket.native-client',
      'external WebSocket egress requires the browser/worker WebSocket primitive',
    );
  }
  const wsUrl = toWebSocketUrl(opts.url);
  const key = headerValue(opts.headers, 'sec-websocket-key');
  if (!isValidWebSocketKey(key)) {
    throw new Error('WebSocket client upgrade missing a valid Sec-WebSocket-Key header');
  }
  const protocols = splitHeaderList(headerValue(opts.headers, 'sec-websocket-protocol'));
  const cid = `http-native-ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let opened = false;
  let closed = false;
  const native = new WebSocket(wsUrl, [...protocols]);
  native.binaryType = 'arraybuffer';

  const sendNative = (frame: WebSocketBridgeFrame): void => {
    if (closed) return;
    if (frame.type === 'msg') {
      if (frame.opcode === 0x9 || frame.opcode === 0xa) {
        const err = new NotImplementedError(
          'net.websocket.native-client-control-frame',
          'browser WebSocket egress cannot originate ping/pong control frames',
        );
        queueMicrotask(() => socket.destroy(err));
        return;
      }
      if (native.readyState !== WebSocket.OPEN) return;
      if (frame.data !== undefined) native.send(toNativeWebSocketPayload(frame.data));
      return;
    }
    if (frame.type === 'close' && frame.from === 'client') {
      try {
        if (frame.code === undefined || frame.code === 1005 || frame.code === 1006) {
          native.close();
        } else {
          native.close(frame.code, frame.reason ?? '');
        }
      } catch (err) {
        queueMicrotask(() => socket.destroy(err as Error));
      }
    }
  };
  const socket = new WebSocketClientSocket({ cid, sendBridgeFrame: sendNative });

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    native.removeEventListener('open', onOpen);
    native.removeEventListener('message', onMessage);
    native.removeEventListener('close', onClose);
    native.removeEventListener('error', onError);
    if (native.readyState === WebSocket.CONNECTING || native.readyState === WebSocket.OPEN) {
      try {
        native.close();
      } catch {
        /* already closing/closed */
      }
    }
  };

  const onOpen = (): void => {
    if (opts.isAborted()) {
      cleanup();
      return;
    }
    opened = true;
    const responseHeaders: Record<string, string> = {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-accept': createWebSocketAccept(key),
    };
    if (native.protocol) responseHeaders['sec-websocket-protocol'] = native.protocol;
    opts.emitter.emit(
      'upgrade',
      {
        statusCode: 101,
        statusMessage: 'Switching Protocols',
        headers: responseHeaders,
      },
      socket,
      Buffer.alloc(0),
    );
  };

  const onMessage = (event: MessageEvent): void => {
    if (opts.isAborted()) return;
    void normaliseNativeWebSocketMessage(event.data).then(
      (data) => socket._receiveBridgeMessage(data),
      (err) => socket.destroy(err as Error),
    );
  };

  const onClose = (event: CloseEvent): void => {
    socket._receiveBridgeClose(event.code, event.reason);
    cleanup();
  };

  const onError = (): void => {
    const err = new Error('WebSocket connection failed');
    if (!opened) {
      cleanup();
      opts.emitter.emit('error', err);
      return;
    }
    socket.destroy(err);
  };

  native.addEventListener('open', onOpen);
  native.addEventListener('message', onMessage);
  native.addEventListener('close', onClose);
  native.addEventListener('error', onError);
  socket.once('close', cleanup);
  return { socket, cleanup };
}

function toNativeWebSocketPayload(data: WsMessage): string | ArrayBuffer {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function normaliseNativeWebSocketMessage(data: unknown): Promise<WsMessage> {
  if (typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return data as WsMessage;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.arrayBuffer();
  }
  return String(data);
}

function toWebSocketUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.href;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function splitHeaderList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isValidWebSocketKey(key: string | undefined): key is string {
  if (!key) return false;
  try {
    return Buffer.from(key, 'base64').byteLength === 16;
  } catch {
    return false;
  }
}

function optionsFromUrl(url: string): RequestOptions {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      ...(parsed.port === '' ? {} : { port: Number(parsed.port) }),
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return {};
  }
}

export function get(
  urlOrOpts: string | RequestOptions,
  optsOrCb?: RequestOptions | ((res: ClientResponse) => void),
  maybeCb?: (res: ClientResponse) => void,
): ClientRequest {
  const req = request(urlOrOpts, optsOrCb, maybeCb);
  req.end();
  return req;
}

const http = {
  createServer,
  request,
  get,
  Server: HttpServer,
  IncomingMessage,
  ServerResponse,
  STATUS_CODES,
};
export default http;
