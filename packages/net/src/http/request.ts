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

import { Readable } from '@rifty/io';

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
      if (value && value.byteLength > 0) target.push(value);
    }
    target.push(null);
  } catch (err) {
    target.destroy(err as Error);
  } finally {
    reader.releaseLock();
  }
}

export class IncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  constructor(request: Request) {
    super({ objectMode: false });
    const u = new URL(request.url);
    this.method = request.method;
    this.url = u.pathname + u.search;
    this.headers = Object.fromEntries(request.headers);
    void pipeBodyStream(request.body, this);
  }
}

export class IncomingMessageFromFetch extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  httpVersion = '1.1';
  socket: IncomingMessageSocket = makeSocket();
  constructor(response: Response) {
    super({ objectMode: false });
    this.statusCode = response.status;
    this.statusMessage = response.statusText;
    this.headers = Object.fromEntries(response.headers);
    void pipeBodyStream(response.body, this);
  }
}
