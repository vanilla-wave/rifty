/**
 * Streaming `ServerResponse` for `@riftydev/net`.
 *
 * Per ADR-0017 phase 1, the response body is a `ReadableStream<Uint8Array>`
 * that the SW bridge can transfer across realms. The class still satisfies
 * the parts of Node's `http.ServerResponse` surface that user code depends on
 * — `setHeader`, `getHeader`, `writeHead`, `write`, `end`, `'finish'` event —
 * but the body is no longer buffered into a single string before delivery.
 *
 * Mode of operation:
 *   - `res.write(chunk)` enqueues into an internal `ReadableStream` controller.
 *     The first `write` flushes the headers (they become locked) and adds
 *     `Transfer-Encoding: chunked` unless `Content-Length` is set.
 *   - `res.end(chunk?)` writes the final chunk (if any) and closes the stream.
 *   - If neither `write` nor `end(body)` was called, the stream stays empty
 *     and the response is a zero-body response (still streamed for shape
 *     consistency with downstream consumers).
 *
 * `toResponse()` returns a Promise<Response> that resolves once headers are
 * flushed — the body of that Response is the streaming `ReadableStream`.
 * `bodyText()` is a convenience for tests that want the whole buffer; it
 * waits for `end()`.
 */

import { Buffer, EventEmitter } from '@riftydev/io';

type Chunk = Uint8Array | string;

export class ServerResponse extends EventEmitter {
  statusCode = 200;
  statusMessage = 'OK';

  private readonly _headers: Record<string, string | string[]> = {};
  private _headersSent = false;
  private _finished = false;

  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly body: ReadableStream<Uint8Array>;
  private resolveResp!: (res: Response) => void;
  private readonly responsePromise: Promise<Response>;
  /**
   * FIFO of waiters parked because `controller.desiredSize <= 0` at write time.
   * Each entry resolves on the next `pull()` invocation, in order. See `write`.
   */
  private readonly pendingPulls: Array<() => void> = [];
  /**
   * Set true only when a `write()` returned the backpressure Promise (i.e. the
   * queue was full). Gates the Node-style `'drain'` emission in `pull()` so we
   * never fire a spurious `'drain'` before any backpressure occurred. See
   * `write` and the `ReadableStream` `pull` callback.
   */
  private _needDrain = false;

  constructor() {
    super();
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      pull: () => {
        // Parked writes already enqueued their chunks; just unblock their
        // awaits. Drain the whole FIFO on a single pull, else back-to-back
        // backpressured writes deadlock — `pull` only fires once per "queue
        // empty" when no further enqueues happen inside the handler.
        while (this.pendingPulls.length > 0) {
          const next = this.pendingPulls.shift();
          next?.();
        }
        // Node `Writable` parity: emit `'drain'` so consumers that park on
        // `res.on('drain')` and ignore `write()`'s return (e.g.
        // @effect/platform-node's write loop) resume. Gated by `_needDrain`
        // so we never emit a spurious `'drain'` before backpressure.
        if (this._needDrain) {
          this._needDrain = false;
          this.emit('drain');
        }
      },
    });
    this.responsePromise = new Promise<Response>((r) => {
      this.resolveResp = r;
    });
  }

  get headersSent(): boolean {
    return this._headersSent;
  }

  get writableEnded(): boolean {
    return this._finished;
  }

  setHeader(name: string, value: string | string[] | number): this {
    if (this._headersSent) {
      throw new Error(`Cannot set headers after they are sent: ${name}`);
    }
    this._headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value;
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this._headers[name.toLowerCase()];
  }

  removeHeader(name: string): void {
    if (this._headersSent) {
      throw new Error(`Cannot remove headers after they are sent: ${name}`);
    }
    delete this._headers[name.toLowerCase()];
  }

  writeHead(
    status: number,
    statusMessage?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): this {
    if (this._headersSent) {
      throw new Error('Cannot writeHead after headers are sent');
    }
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

  /**
   * Flush headers and resolve `responsePromise`. Subsequent `setHeader` calls
   * throw. Called automatically on first `write` or on `end`.
   */
  flushHeaders(): void {
    if (this._headersSent) return;
    this._headersSent = true;
    const headers = new Headers();
    for (const [k, v] of Object.entries(this._headers)) {
      if (Array.isArray(v)) for (const item of v) headers.append(k, item);
      else headers.set(k, v);
    }
    // Null-body statuses (RFC 9110: 204/205/304; fetch spec list incl. 1xx):
    // the Response constructor THROWS on any body, and Node sends none — drop
    // the stream, the chunked framing, AND any content-length `end(chunk)`
    // stamped for the now-dropped body (Node omits it entirely).
    const nullBody =
      this.statusCode === 204 ||
      this.statusCode === 205 ||
      this.statusCode === 304 ||
      (this.statusCode >= 100 && this.statusCode < 200);
    if (nullBody) {
      headers.delete('content-length');
    }
    // Per RFC 7230 §3.3.1, Content-Length wins; otherwise streaming responses
    // must be chunked. We never know the length up front in streaming mode,
    // so default to chunked when neither is set.
    if (!nullBody && !headers.has('content-length') && !headers.has('transfer-encoding')) {
      headers.set('transfer-encoding', 'chunked');
    }
    this.resolveResp(
      new Response(nullBody ? null : this.body, {
        status: this.statusCode,
        statusText: this.statusMessage,
        headers,
      }),
    );
  }

  /**
   * Enqueue a chunk into the streaming body.
   *
   * Returns `true` synchronously when the controller's `desiredSize` indicates
   * there is still room in the queue (or when `desiredSize` is `null`, meaning
   * the stream gives no backpressure signal). When `desiredSize <= 0`, the
   * chunk is enqueued but a `Promise<true>` is returned, resolving only after
   * the next `pull()` is invoked by the consumer. Waiters are drained in FIFO
   * order so multiple back-to-back writes preserve their delivery order.
   *
   * This widening of the Node `Writable.write()` return type to
   * `boolean | Promise<boolean>` is intentional — callers that ignore the
   * return continue to work, callers that `await` it get true backpressure.
   */
  write(chunk: Chunk): boolean | Promise<boolean> {
    if (this._finished) {
      this.emit('error', new Error('write after end'));
      return false;
    }
    if (!this._headersSent) this.flushHeaders();
    const buf = normalise(chunk);
    if (buf.byteLength === 0) return true;
    // controller is set in the ReadableStream start callback (synchronous per
    // spec) before flushHeaders can run, so it is non-null here.
    const ctrl = this.controller;
    if (ctrl === null) return true;
    // Snapshot desiredSize BEFORE the enqueue so the very first write (when
    // the queue is empty at HWM=1 and ds=1) returns true synchronously. The
    // post-enqueue state would falsely flag that case as backpressured.
    const dsBefore = ctrl.desiredSize;
    ctrl.enqueue(buf);
    if (dsBefore !== null && dsBefore <= 0) {
      // Backpressured: arm the Node-style `'drain'` that fires on next `pull()`.
      this._needDrain = true;
      return new Promise<boolean>((resolve) => {
        this.pendingPulls.push(() => resolve(true));
      });
    }
    return true;
  }

  end(chunk?: Chunk): this {
    if (this._finished) return this;
    if (chunk !== undefined) {
      // Not yet flushed and this is the only chunk: set Content-Length so
      // downstream caches and the SW can skip chunked transfer encoding.
      if (!this._headersSent) {
        const buf = normalise(chunk);
        if (!('content-length' in this._headers) && !('transfer-encoding' in this._headers)) {
          this._headers['content-length'] = String(buf.byteLength);
        }
        this.flushHeaders();
        if (buf.byteLength > 0) this.controller?.enqueue(buf);
      } else {
        const buf = normalise(chunk);
        if (buf.byteLength > 0) this.controller?.enqueue(buf);
      }
    } else if (!this._headersSent) {
      // Zero-body response: declare it explicitly so chunked encoding doesn't
      // get applied by `flushHeaders`.
      if (!('content-length' in this._headers) && !('transfer-encoding' in this._headers)) {
        this._headers['content-length'] = '0';
      }
      this.flushHeaders();
    }
    this._finished = true;
    this.controller?.close();
    // Stream is closing, no more `pull()` will fire: resolve parked waiters so
    // awaited `write()` promises don't hang. No `'drain'` here — Node doesn't
    // emit it after `end()` — and clear the gate to avoid a stale flag.
    this._needDrain = false;
    while (this.pendingPulls.length > 0) {
      const next = this.pendingPulls.shift();
      next?.();
    }
    queueMicrotask(() => this.emit('finish'));
    return this;
  }

  /** Internal: get the eventual fetch-Response. */
  toResponse(): Promise<Response> {
    return this.responsePromise;
  }

  /**
   * Convenience for tests: await the full body as a string. Returns once
   * `end()` has been called and the stream drained.
   */
  async bodyText(): Promise<string> {
    const resp = await this.responsePromise;
    return resp.clone().text();
  }
}

function normalise(chunk: Chunk): Uint8Array {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return chunk;
}
