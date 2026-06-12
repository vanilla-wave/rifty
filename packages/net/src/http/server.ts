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

import { EventEmitter } from '@riftydev/io';
import { dispatchToPort, getHandler, registerPort, unregisterPort } from '../registry.ts';
import { IncomingMessage, IncomingMessageFromFetch } from './request.ts';
import { ServerResponse } from './response.ts';
import { STATUS_CODES } from './status-codes.ts';

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
    this.port = port;
    registerPort(port, (request) => {
      const req = new IncomingMessage(request);
      const res = new ServerResponse();
      this.handler(req, res);
      this.emit('request', req, res);
      return res.toResponse();
    });
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
    queueMicrotask(() => {
      this.emit('close');
      cb?.();
    });
    return this;
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

/**
 * `http.request(url | opts[, opts][, cb])` — registered local loopback ports
 * route through the in-process registry; unregistered loopback ports emit
 * `ECONNREFUSED`; everything else falls through to the host's `fetch`. The
 * callback receives an `IncomingMessage` once the response arrives. Outgoing
 * body is sent via `req.write()` / `req.end()` (buffered whole — see
 * docs/backlog/net/client-request-body-streaming).
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
  const bodyChunks: (Uint8Array | string)[] = [];
  let finished = false;

  const req = Object.assign(emitter, {
    write(chunk: Uint8Array | string): boolean {
      if (finished) {
        queueMicrotask(() => emitter.emit('error', streamWriteAfterEndError()));
        return false;
      }
      bodyChunks.push(chunk);
      // Buffered in memory — no backpressure, so never ask the caller to wait.
      return true;
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
      if (chunk !== undefined) bodyChunks.push(chunk);
      if (finishCb) emitter.once('finish', finishCb);
      void (async () => {
        // Defer one microtask so listeners attached AFTER end() — the standard
        // Node pattern with http.get(url, cb); req.on('error', …) — still see
        // 'finish'/'error'. Node never emits these synchronously from end().
        await Promise.resolve();
        const body =
          bodyChunks.length === 0
            ? undefined
            : bodyChunks.map((c) => (typeof c === 'string' ? UTF8_ENCODER.encode(c) : c));
        const init = {
          method,
          headers,
          body: body ? new Blob(body as unknown as BlobPart[]) : undefined,
        };
        emitter.emit('finish');
        const route = routeClientRequest(url);
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
    },
  });
  return req;
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
