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

import { Buffer, EventEmitter, NotImplementedError, Readable } from '@riftydev/io';

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
function materializeHeaders(src: Headers, syntheticHost?: string): Record<string, string> {
  const value = Object.fromEntries(src);
  if (syntheticHost && value.host === undefined) value.host = syntheticHost;
  return value;
}

function materializeRawHeaders(src: Headers, syntheticHost?: string): string[] {
  const pairs: string[] = [];
  let sawHost = false;
  for (const [key, value] of src) {
    if (key.toLowerCase() === 'host') sawHost = true;
    pairs.push(key, value);
  }
  if (syntheticHost && !sawHost) pairs.unshift('host', syntheticHost);
  return pairs;
}

function defineLazyHeaders(
  target: { headers: Record<string, string>; rawHeaders?: string[] },
  src: Headers,
  syntheticHost?: string,
): void {
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
      const value = materializeHeaders(src, syntheticHost);
      materialise(value);
      return value;
    },
    set(value: Record<string, string>): void {
      materialise(value);
    },
  });
  Object.defineProperty(target, 'rawHeaders', {
    value: materializeRawHeaders(src, syntheticHost),
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Node-compatible attachment surface for `req.socket`. Real TCP addresses and
 * teardown are not owned by the port-registry request object, but middleware
 * still attaches socket listeners (`on-finished` uses `error`/`close`).
 */
export interface IncomingMessageSocket extends EventEmitter {
  remoteAddress: string;
  localAddress: string;
  remotePort: number;
  localPort: number;
  readable: boolean;
  writable: boolean;
  destroyed: boolean;
  destroy(err?: Error): this;
}

class PortRegistrySocket extends EventEmitter implements IncomingMessageSocket {
  readonly remoteAddress = '127.0.0.1';
  readonly localAddress = '127.0.0.1';
  readonly remotePort = 0;
  readonly localPort = 0;
  readable = true;
  writable = true;
  destroyed = false;

  destroy(_err?: Error): this {
    throw new NotImplementedError(
      'http.IncomingMessage.socket.destroy',
      'the per-request port-registry view cannot tear down its shared fetch/preview transport',
    );
  }
}

function makeSocket(): IncomingMessageSocket {
  return new PortRegistrySocket();
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
  onComplete: () => void,
): Promise<void> {
  if (body === null) {
    let pushedEnd = false;
    let completed = false;
    const complete = (): void => {
      if (completed) return;
      completed = true;
      onComplete();
    };
    const pushEnd = (): void => {
      if (pushedEnd) return;
      pushedEnd = true;
      complete();
      target.push(null);
    };
    const armEnd = (): void => {
      target.off('newListener', onNewListener);
      target.off('resume', onResume);
      queueMicrotask(pushEnd);
    };
    const onNewListener = (event: unknown): void => {
      if (event !== 'data' && event !== 'readable' && event !== 'end') return;
      armEnd();
    };
    // `req.resume()` (the canonical "discard an unread body" idiom) attaches no
    // data/readable/end listener, so it must also drive EOF — else 'end' never
    // fires and a consumer that drains-without-listening hangs (Node ends).
    const onResume = (): void => armEnd();
    target.on('newListener', onNewListener);
    target.on('resume', onResume);
    queueMicrotask(complete);
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
    onComplete();
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
  complete = false;
  // Installed lazily (writable data property) by defineLazyHeaders — no field
  // initializer, which would clobber the accessor at construction.
  declare headers: Record<string, string>;
  declare rawHeaders: string[];
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  /** `pipeBodyStream` pushes independently of pull demand. */
  override _read(): void {}
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
    defineLazyHeaders(this, headers, u.host);
    void pipeBodyStream(init.body ?? null, this, () => {
      this.complete = true;
    });
  }
}

export class IncomingMessageFromFetch extends Readable {
  statusCode: number;
  statusMessage: string;
  complete = false;
  declare headers: Record<string, string>;
  declare rawHeaders: string[];
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  /** `pipeBodyStream` pushes independently of pull demand. */
  override _read(): void {}
  constructor(response: Response) {
    super({ objectMode: false });
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    defineLazyHeaders(this, response.headers);
    void pipeBodyStream(response.body, this, () => {
      this.complete = true;
    });
  }
}
