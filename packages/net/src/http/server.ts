/**
 * HTTP `Server` + `request()` client over the port registry.
 *
 * Server: registers a handler that builds `IncomingMessage` + streaming
 * `ServerResponse` for each request and returns the response (a fetch
 * `Response` whose body is the streaming `ReadableStream` written by user
 * code).
 *
 * Client: `http.request()` loops back through the registry for registered local
 * ports, otherwise issues through the host `fetch`. The returned emitter
 * carries `'response'` with an `IncomingMessageFromFetch`.
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
  write(chunk: Uint8Array | string): void;
  end(chunk?: Uint8Array | string): void;
};
export type ClientResponse = IncomingMessageFromFetch;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

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

function loopbackRegisteredPort(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const port = parsed.port === '' ? 80 : Number(parsed.port);
  if (!Number.isInteger(port)) return null;
  return getHandler(port) === null ? null : port;
}

/**
 * `http.request(opts, cb)` — registered local loopback ports route through the
 * in-process registry; everything else falls through to the host's `fetch`.
 * The callback receives an `IncomingMessage` once the response arrives.
 * Outgoing body is sent via `req.write()` / `req.end()`.
 */
export function request(
  opts: string | RequestOptions,
  cb?: (res: ClientResponse) => void,
): ClientRequest {
  const url = typeof opts === 'string' ? opts : buildRequestUrl(opts);
  const method = typeof opts === 'string' ? 'GET' : (opts.method ?? 'GET');
  const headers = typeof opts === 'string' ? {} : (opts.headers ?? {});

  const emitter = new EventEmitter();
  const bodyChunks: (Uint8Array | string)[] = [];

  const req = Object.assign(emitter, {
    write(chunk: Uint8Array | string) {
      bodyChunks.push(chunk);
    },
    end(chunk?: Uint8Array | string) {
      if (chunk !== undefined) bodyChunks.push(chunk);
      void (async () => {
        try {
          const body =
            bodyChunks.length === 0
              ? undefined
              : bodyChunks.map((c) => (typeof c === 'string' ? UTF8_ENCODER.encode(c) : c));
          const init = {
            method,
            headers,
            body: body ? new Blob(body as unknown as BlobPart[]) : undefined,
          };
          const localPort = loopbackRegisteredPort(url);
          const response =
            localPort === null
              ? await fetch(url, init)
              : await dispatchToPort(localPort, new Request(url, init));
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

export function get(
  opts: string | RequestOptions,
  cb?: (res: ClientResponse) => void,
): ClientRequest {
  const req = request(opts, cb);
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
