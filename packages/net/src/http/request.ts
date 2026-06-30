/**
 * `IncomingMessage` types for server-side request handlers and client-side
 * response objects (`http.request`). Both wrap a fetch `Request`/`Response`
 * into a Node-shape `Readable`.
 *
 * Per ADR-0017 phase 1, the request body is no longer materialised through
 * `arrayBuffer()` before delivery — instead, the underlying
 * `ReadableStream<Uint8Array>` is drained chunk-by-chunk and each chunk is
 * pushed individually so chunked uploads work end-to-end.
 */

import { Buffer, Readable } from '@riftydev/io';

/**
 * Install `headers` as a lazy, WRITABLE data property (#9, gate G2).
 *
 * `Object.fromEntries(src)` is deferred to first read, then the accessor
 * replaces itself with a plain writable+enumerable+configurable data property.
 * Writability is load-bearing: Express reassigns `req.headers = {...}`
 * (trust-proxy / body-parser), which a getter-only accessor would break. The
 * setter handles the write-before-read path (a reassign before any read drops
 * the lazy getter and honours the value).
 */
function defineLazyHeaders(target: { headers: Record<string, string> }, src: Headers): void {
  const materialise = (value: Record<string, string>): void => {
    Object.defineProperty(target, 'headers', {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  Object.defineProperty(target, 'headers', {
    configurable: true,
    enumerable: true,
    get(): Record<string, string> {
      const value = Object.fromEntries(src);
      materialise(value);
      return value;
    },
    set(value: Record<string, string>): void {
      materialise(value);
    },
  });
}

/**
 * Minimal Node-compatible shape for `req.socket`. Real TCP fields aren't
 * meaningful in the browser/Service-Worker port-registry model, so we expose
 * loopback placeholders rather than `{}`. `destroy()` is a no-op since there
 * is no socket lifecycle to manage on a per-request basis.
 */
export interface IncomingMessageSocket {
  remoteAddress: string;
  localAddress: string;
  remotePort: number;
  localPort: number;
  destroy(): void;
}

function makeSocket(): IncomingMessageSocket {
  return {
    remoteAddress: '127.0.0.1',
    localAddress: '127.0.0.1',
    remotePort: 0,
    localPort: 0,
    destroy(): void {
      /* no-op — there's no TCP socket behind this request */
    },
  };
}

export interface IncomingMessageInit {
  readonly method: string;
  readonly url: string;
  readonly headers?: HeadersInit;
  readonly body?: ReadableStream<Uint8Array> | null;
  readonly socket?: IncomingMessageSocket;
}

function isIncomingMessageInit(value: Request | IncomingMessageInit): value is IncomingMessageInit {
  return !(value instanceof Request);
}

/**
 * Drain a fetch `ReadableStream<Uint8Array>` into a Node-shape `Readable`,
 * pushing each chunk separately. The `Readable.from`-style coalescing path is
 * deliberately avoided — callers depend on chunk boundaries (SSE frames,
 * NDJSON, chunked uploads).
 */
async function pipeBodyStream(
  body: ReadableStream<Uint8Array> | null,
  target: Readable,
): Promise<void> {
  if (body === null) {
    target.push(null);
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Push a `Buffer`, not the raw `Uint8Array`: Node delivers `IncomingMessage`
      // body chunks as `Buffer`s, so the canonical `let b=''; res.on('data', c => b
      // += c)` client idiom decodes utf8 — a bare `Uint8Array` would stringify to
      // CSV byte values. `Buffer.from` over the chunk (a fresh per-read view) is safe.
      if (value && value.byteLength > 0 && !target.push(Buffer.from(value))) {
        await waitForReadableDemand(target);
      }
    }
    target.push(null);
  } catch (err) {
    target.destroy(err as Error);
  } finally {
    reader.releaseLock();
  }
}

function waitForReadableDemand(target: Readable): Promise<void> {
  if (target.destroyed || target.readableLength < target.readableHighWaterMark) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      target.off('data', onProgress);
      target.off('readable', onProgress);
      target.off('end', onProgress);
      target.off('close', onClose);
      target.off('error', onError);
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const onProgress = (): void => {
      if (
        target.destroyed ||
        target.readableLength < target.readableHighWaterMark ||
        target.readableEnded
      ) {
        done();
      }
    };
    const onClose = (): void => {
      done();
    };
    const onError = (err: unknown): void => {
      cleanup();
      reject(err);
    };
    target.on('data', onProgress);
    target.on('readable', onProgress);
    target.on('end', onProgress);
    target.on('close', onClose);
    target.on('error', onError);
    queueMicrotask(onProgress);
  });
}

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  // Installed lazily (writable data property) by defineLazyHeaders — no field
  // initializer, which would clobber the accessor at construction.
  declare headers: Record<string, string>;
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  constructor(request: Request | IncomingMessageInit) {
    super({ objectMode: false });
    const init = isIncomingMessageInit(request)
      ? request
      : {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body,
        };
    const u = new URL(init.url, 'http://localhost/');
    this.method = init.method;
    this.url = u.pathname + u.search;
    if (init.socket) this.socket = init.socket;
    // Node never delivers a bodied request with NEITHER content-length NOR
    // transfer-encoding, but fetch Requests rebuilt across the preview bridge
    // lose content-length (forbidden request header in browsers). Present the
    // honest equivalent — chunked (length unknown, body present) — so
    // typeis-style hasBody() checks (express.json) read the body.
    let headers = new Headers(init.headers);
    if (init.body && !headers.has('content-length') && !headers.has('transfer-encoding')) {
      headers = new Headers(headers);
      headers.set('transfer-encoding', 'chunked');
    }
    defineLazyHeaders(this, headers);
    void pipeBodyStream(init.body ?? null, this);
  }
}

export class IncomingMessageFromFetch extends Readable {
  statusCode: number;
  statusMessage: string;
  declare headers: Record<string, string>;
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  constructor(response: Response) {
    super({ objectMode: false });
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    defineLazyHeaders(this, response.headers);
    void pipeBodyStream(response.body, this);
  }
}
