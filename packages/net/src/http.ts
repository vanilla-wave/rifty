/**
 * `node:http` over the registry.
 *
 * Express/Koa/Fastify all see this as a regular Node `http.Server`. We bypass
 * the line-by-line parsing in `net.ts` for HTTP-specific code paths: the
 * registry's handler builds `IncomingMessage` and `ServerResponse` objects
 * directly from the `Request`.
 */

import { Buffer, EventEmitter, Readable } from '@rifty/runtime-js/builtins';
import { registerPort, unregisterPort } from './registry.ts';

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  socket = {};
  constructor(request: Request) {
    super({ objectMode: false });
    const u = new URL(request.url);
    this.method = request.method;
    this.url = u.pathname + u.search;
    this.headers = Object.fromEntries(request.headers);
    void this.populate(request);
  }
  private async populate(request: Request): Promise<void> {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) this.push(new Uint8Array(body));
    this.push(null);
  }
}

export class ServerResponse extends EventEmitter {
  statusCode = 200;
  statusMessage = 'OK';
  private readonly chunks: Uint8Array[] = [];
  private readonly _headers: Record<string, string | string[]> = {};
  private resolveResp!: (res: Response) => void;
  private readonly responsePromise: Promise<Response>;
  private finished = false;

  constructor() {
    super();
    this.responsePromise = new Promise<Response>((r) => {
      this.resolveResp = r;
    });
  }

  setHeader(name: string, value: string | string[] | number): this {
    this._headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value;
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this._headers[name.toLowerCase()];
  }

  writeHead(
    status: number,
    statusMessage?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): this {
    this.statusCode = status;
    if (typeof statusMessage === 'string') {
      this.statusMessage = statusMessage;
      if (headers) {
        for (const k of Object.keys(headers)) this.setHeader(k, headers[k]!);
      }
    } else if (statusMessage) {
      for (const k of Object.keys(statusMessage)) this.setHeader(k, statusMessage[k]!);
    }
    return this;
  }

  write(chunk: Uint8Array | string): boolean {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.chunks.push(buf);
    return true;
  }

  end(chunk?: Uint8Array | string): this {
    if (chunk !== undefined) this.write(chunk);
    if (this.finished) return this;
    this.finished = true;
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const body = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      body.set(c, off);
      off += c.length;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(this._headers)) {
      if (Array.isArray(v)) for (const item of v) headers.append(k, item);
      else headers.set(k, v as string);
    }
    this.resolveResp(
      new Response(body, { status: this.statusCode, statusText: this.statusMessage, headers }),
    );
    queueMicrotask(() => this.emit('finish'));
    return this;
  }

  /** Internal: get the eventual fetch-Response. */
  toResponse(): Promise<Response> {
    return this.responsePromise;
  }
}

export class HttpServer extends EventEmitter {
  private port: number | null = null;
  private readonly handler: (req: IncomingMessage, res: ServerResponse) => void;

  constructor(handler: (req: IncomingMessage, res: ServerResponse) => void = () => {}) {
    super();
    this.handler = handler;
  }

  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this {
    const callback = (typeof hostnameOrCb === 'function' ? hostnameOrCb : cb) as
      | (() => void)
      | undefined;
    this.port = port;
    registerPort(port, async (request) => {
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
  hostname?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
  protocol?: string;
}

/**
 * `http.request(opts, cb)` — issued through the host's `fetch`. The callback
 * receives an `IncomingMessage` once the response arrives. Outgoing body is
 * sent via `req.write()` / `req.end()`.
 */
export function request(
  opts: string | RequestOptions,
  cb?: (res: IncomingMessage) => void,
): EventEmitter & {
  write(chunk: Uint8Array | string): void;
  end(chunk?: Uint8Array | string): void;
} {
  const url =
    typeof opts === 'string'
      ? opts
      : `${opts.protocol ?? 'http:'}//${opts.hostname ?? 'localhost'}:${opts.port ?? 80}${opts.path ?? '/'}`;
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
              : bodyChunks.map((c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c));
          const response = await fetch(url, {
            method,
            headers,
            body: body ? new Blob(body as unknown as BlobPart[]) : undefined,
          });
          const incoming = new IncomingMessageFromFetch(response);
          cb?.(incoming as unknown as IncomingMessage);
          emitter.emit('response', incoming);
        } catch (err) {
          emitter.emit('error', err);
        }
      })();
    },
  });
  return req;
}

class IncomingMessageFromFetch extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  constructor(response: Response) {
    super({ objectMode: false });
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    this.headers = Object.fromEntries(response.headers);
    void this.populate(response);
  }
  private async populate(response: Response): Promise<void> {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > 0) this.push(buf);
    this.push(null);
  }
}

const http = { createServer, request, Server: HttpServer, IncomingMessage, ServerResponse };
export default http;
