/**
 * Node-compatible `node:stream.Duplex` — owned by `@riftydev/io` per ADR-0012.
 *
 * Per ADR-0034, `Duplex` extends `Readable` and embeds a dedicated `Writable`
 * for the writable side. All public methods live on the prototype — NO
 * per-instance rebinding in the constructor — so subclassing via `super({...})`
 * is safe and `Object.getPrototypeOf(duplex).write === Duplex.prototype.write`
 * matches Node.
 *
 * Subclasses inside `@riftydev/io` (e.g. `Transform`) customise the writable side
 * via a factory passed through the {@link INTERNAL_WRITABLE_SIDE} symbol, which is
 * not exported via `src/index.ts`. Outside subclasses cannot construct it, making
 * the wall between public option bag and internal hook real — not a `_`-prefixed
 * field any cast can pass through.
 */

import { acquireDuplexFromWeb } from './from-web-validation.ts';
import { Readable, type ReadableOptions } from './readable.ts';
import {
  Writable,
  type WritableOptions,
  type WritableState,
  streamDestroyedError,
} from './writable.ts';

type WriteOverride = (
  this: Duplex,
  chunk: unknown,
  encoding: string,
  cb: (err?: Error | null) => void,
) => void;

type FinalOverride = (this: Duplex, cb: (err?: Error | null) => void) => void;
type DuplexEndCallback = (error?: Error | null) => void;

function ownFunction(target: object, name: '_write' | '_final'): unknown {
  if (!Object.prototype.hasOwnProperty.call(target, name)) return undefined;
  return (target as Record<string, unknown>)[name];
}

export function ownWriteOverride(target: Duplex): WriteOverride | null {
  const value = ownFunction(target, '_write');
  return typeof value === 'function' ? (value as WriteOverride) : null;
}

export function ownFinalOverride(target: Duplex): FinalOverride | null {
  const value = ownFunction(target, '_final');
  return typeof value === 'function' ? (value as FinalOverride) : null;
}

/**
 * Internal subclass hook key. Symbol-keyed so it cannot appear in the public
 * `ReadableOptions & WritableOptions` shape — outside subclasses can't construct
 * it, so they can't inject a custom writable side. {@link Transform} imports it directly.
 */
export const INTERNAL_WRITABLE_SIDE: unique symbol = Symbol('rifty/io:duplex-internal-writable');

/** Carrier for the symbol-keyed factory hook. Internal to `@riftydev/io`; not in `src/index.ts`. */
export interface DuplexInternalOptions {
  [INTERNAL_WRITABLE_SIDE]?: (opts: ReadableOptions & WritableOptions, owner: Duplex) => Writable;
}

/** The WHATWG pair returned by `Duplex.toWeb`. */
export interface DuplexWebPair {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
}

/** The `allowHalfOpen` option (and the WHATWG-pair shape) layered onto Duplex. */
export interface DuplexOptions extends ReadableOptions, WritableOptions {
  /**
   * When `false`, the readable side ending auto-ends the writable side (Node's
   * socket-like coupling). Defaults to `true` for a bare `new Duplex()` (Node
   * parity); `Duplex.fromWeb` deliberately defaults it to `false`.
   */
  allowHalfOpen?: boolean;
}

export interface DuplexFromWebOptions {
  allowHalfOpen?: boolean;
  highWaterMark?: number;
  objectMode?: boolean;
  encoding?: string;
  decodeStrings?: boolean;
}

/**
 * Keep runtime inheritance exactly `Readable` while declaring Duplex's three
 * Node-specific statics on its own side. Their signatures intentionally differ
 * from Readable's; exposing them through one TS static side makes emitted d.ts
 * consumers fail TS2417.
 */
type ReadableDuplexBaseConstructor = Omit<typeof Readable, 'from' | 'fromWeb' | 'toWeb'> &
  (new (
    options?: ReadableOptions,
  ) => Readable);
const ReadableForDuplex: ReadableDuplexBaseConstructor = Readable;

export class Duplex extends ReadableForDuplex {
  /** Internal `Writable` side. Exposed for tests/debugging only — drive the duplex via `d.write`/`d.end`. */
  readonly writableSide: Writable;
  /** Node's `allowHalfOpen` — see {@link DuplexOptions}. */
  readonly allowHalfOpen: boolean;

  constructor(opts: DuplexOptions = {}) {
    super(opts);
    this.allowHalfOpen = opts.allowHalfOpen ?? true;
    // Symbol-keyed factory is the only override path; public callers can't reach
    // the Symbol. `Transform` injects it via `super({...})` — see `transform.ts`.
    const factory = (opts as DuplexInternalOptions)[INTERNAL_WRITABLE_SIDE];
    const writeOpt = opts.write;
    const finalOpt = opts.final;
    this.writableSide = factory
      ? factory(opts, this)
      : new Writable({
          ...opts,
          write: (chunk, encoding, cb): void => {
            const override = ownWriteOverride(this);
            if (override) {
              override.call(this, chunk, encoding, cb);
              return;
            }
            if (writeOpt) {
              writeOpt.call(this.writableSide, chunk, encoding, cb);
              return;
            }
            cb();
          },
          final: (cb): void => {
            const override = ownFinalOverride(this);
            if (override) {
              override.call(this, cb);
              return;
            }
            if (finalOpt) {
              finalOpt.call(this.writableSide, cb);
              return;
            }
            cb();
          },
        });
    this.writableSide.on('finish', () => {
      this.emit('finish');
    });
    this.writableSide.on('prefinish', () => {
      this.emit('prefinish');
    });
    this.writableSide.on('error', (err) => {
      if (this._readableState.destroyed) return;
      // Writable owns the deferred public completion stack. Close the readable
      // half on that same stack: write errors have already published end
      // callbacks, while final errors publish them after this public close.
      this._readableState.errored = err as Error;
      this._readableState.destroyed = true;
      this._readableState.disturbed = true;
      this.emit('error', err);
      this.emit('close');
    });
    this.writableSide.on('drain', () => {
      this.emit('drain');
    });
    // Half-open coupling (Node parity): when `allowHalfOpen` is false, the
    // readable side ending auto-ends the writable side — a socket-shaped Duplex
    // and `Duplex.fromWeb` rely on this (a closed web-readable ends the writer).
    if (!this.allowHalfOpen) {
      this.once('end', () => {
        if (!this.writableSide.writableEnded) this.writableSide.end();
      });
    }
  }

  /**
   * Expose `_writableState` for Node's `d._writableState.{destroyed,length,…}`
   * introspection pattern. Read-only in practice; mutate via the public methods.
   */
  get _writableState(): WritableState {
    return this.writableSide._writableState;
  }

  // Public accessors mirroring Node's Writable getters on a Duplex.

  get writable(): boolean {
    return this.writableSide.writable;
  }

  get writableHighWaterMark(): number {
    return this.writableSide.writableHighWaterMark;
  }

  get writableObjectMode(): boolean {
    return this.writableSide.writableObjectMode;
  }

  get writableLength(): number {
    return this.writableSide.writableLength;
  }

  get writableEnded(): boolean {
    return this.writableSide.writableEnded;
  }

  get writableFinished(): boolean {
    return this.writableSide.writableFinished;
  }

  /**
   * Forward writes to the embedded writable side. Per Node, `Duplex.write` is a
   * single prototype function — subclasses can `super.write(chunk, ...)`.
   */
  write(
    chunk: unknown,
    encoding?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    return this.writableSide.write(chunk, encoding, cb);
  }

  /** Signal end-of-writable. Delegates to the writable side. */
  end(cb?: DuplexEndCallback): this;
  end(chunk: unknown, cb?: DuplexEndCallback): this;
  end(chunk: unknown, encoding?: string, cb?: DuplexEndCallback): this;
  end(
    chunkOrCb?: unknown,
    encodingOrCb?: string | DuplexEndCallback,
    cb?: DuplexEndCallback,
  ): this {
    const state = this.writableSide._writableState;
    if (state.destroyed && !state.finished) {
      const cbFinal =
        typeof chunkOrCb === 'function'
          ? (chunkOrCb as DuplexEndCallback)
          : typeof encodingOrCb === 'function'
            ? encodingOrCb
            : cb;
      if (cbFinal && state.errored) {
        const publish = (): void => cbFinal(streamDestroyedError());
        if (state.closed) queueMicrotask(publish);
        else this.once('close', publish);
      }
      return this;
    }
    if (typeof encodingOrCb === 'function') this.writableSide.end(chunkOrCb, encodingOrCb);
    else this.writableSide.end(chunkOrCb, encodingOrCb, cb);
    return this;
  }

  /**
   * Destroying a Duplex destroys BOTH halves (Node behaviour) — readable stops
   * pushing; writable errors queued writes.
   */
  override destroy(err?: Error): this {
    // Writable first so its pending callbacks error before readable's close fires. Both idempotent.
    this.writableSide.destroy(err);
    super.destroy(err);
    return this;
  }

  /**
   * Convert this Duplex into a WHATWG `{ readable, writable }` pair (Node's
   * `Duplex.toWeb`, v17): the readable side becomes a `ReadableStream` and the
   * writable side a `WritableStream`, reusing `Readable.toWeb` / `Writable.toWeb`.
   */
  static toWeb(duplex: Duplex): DuplexWebPair {
    return {
      readable: Readable.toWeb(duplex),
      writable: Writable.toWeb(duplex),
    };
  }

  /**
   * Compose a Node `Duplex` over a WHATWG `{ readable, writable }` pair (Node's
   * `Duplex.fromWeb`, v17). The Duplex's readable side is fed by reading the web
   * `readable`; its writable side pumps into the web `writable`'s writer (with
   * backpressure via the write callback), `_final` → `writer.close`. Terminal
   * reason/order, one-sided teardown, settlement, locks, and signal behavior
   * remain tracked separately.
   *
   * Defaults `allowHalfOpen` to `false` — deliberately the OPPOSITE of a bare
   * `new Duplex()` (Node parity); `{ allowHalfOpen: true }` is honored. A
   * non-WHATWG pair throws a synchronous `TypeError` (`ERR_INVALID_ARG_TYPE`).
   */
  static fromWeb(
    pair: { readable: ReadableStream<unknown>; writable: WritableStream<unknown> },
    options: DuplexFromWebOptions = {},
  ): Duplex {
    const { reader, writer, config } = acquireDuplexFromWeb(pair, options);
    let writeAborted = false;
    let readClosed = false;

    const d = new Duplex({
      allowHalfOpen: config.allowHalfOpen,
      highWaterMark: config.highWaterMark,
      objectMode: config.objectMode,
      encoding: config.encoding,
      decodeStrings: config.decodeStrings,
      read(): void {
        void reader.read().then(
          ({ done, value }) => {
            if (done) {
              readClosed = true;
              reader.releaseLock();
              this.push(null);
              return;
            }
            this.push(value);
          },
          (error: unknown) => {
            readClosed = true;
            try {
              reader.releaseLock();
            } catch {
              // A rejected read can coincide with an externally released lock.
            }
            if (!this.destroyed) this.destroy(error as Error);
          },
        );
      },
      write(chunk, _encoding, cb): void {
        writer.write(chunk).then(
          () => cb(),
          (err) => cb(err as Error),
        );
      },
      final(cb): void {
        writer.close().then(
          () => cb(),
          (err) => cb(err as Error),
        );
      },
    });
    // Web write-side erroring (`controller.error`) rejects the writer's `closed`;
    // mirror it onto the Duplex.
    writer.closed.catch((err: unknown) => {
      writeAborted = true;
      if (!d.destroyed) d.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    // destroy → tear down BOTH web sides (abort the writer with the reason,
    // cancel the reader), guarding against a double-abort from the closed-catch.
    d.on('close', () => {
      if (!writeAborted) {
        writeAborted = true;
        void writer.abort(d._writableState.errored ?? undefined).catch(() => {});
      }
      if (!readClosed) {
        readClosed = true;
        void reader.cancel().catch(() => {});
      }
    });
    return d;
  }

  /**
   * `Duplex.from(src)` (Node v16) — build a `Duplex` from one of several source
   * shapes (no silent coercion: an unknown shape throws `ERR_INVALID_ARG_TYPE`):
   *   - a `{ readable, writable }` pair → a Duplex bridging both (read from
   *     `readable`, write to `writable`);
   *   - a function `(source) => asyncIterable` (e.g. an async generator) → a
   *     Duplex whose written chunks become `source`, the body's yields the read
   *     side (the "duplexify a body" shape `compose` also uses);
   *   - any iterable / async-iterable / string / Promise → a readable-driven
   *     Duplex over `Readable.from(src)`. The current intermediate bridge and
   *     discard-writable divergence are explicit in the source-ownership backlog.
   *
   * Returns an `instanceof Duplex` (Node's internal `Duplexify` class NAME is
   * deliberately NOT replicated — out of scope).
   */
  static from(src: unknown, options: DuplexOptions = {}): Duplex {
    // `{ readable, writable }` pair (Node stream halves, not WHATWG).
    if (isStreamHalvesPair(src)) {
      return duplexFromHalves(src.readable, src.writable, options);
    }
    if (isWebReadableStream(src)) {
      return duplexFromReadable(Readable.fromWeb(src, options), options);
    }
    // A body function `(source) => asyncIterable` (async generator or any fn
    // returning an async-iterable). This is the write+read duplexify shape.
    if (typeof src === 'function') {
      return duplexFromBody(src as DuplexBodyFn, options);
    }
    // Iterable / async-iterable / string / Promise → readable-driven Duplex.
    if (isReadableSource(src)) {
      return duplexFromReadableSource(src, options);
    }
    const err = new TypeError(
      `The "src" argument must be of type function, AsyncIterable, Iterable, ReadableStream, or { readable, writable }. Received ${src === null ? 'null' : typeof src}`,
    ) as TypeError & { code?: string };
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
}

/** Node `{ readable, writable }` halves (each a stream with the right state bag). */
function isStreamHalvesPair(src: unknown): src is { readable: Readable; writable: Writable } {
  if (src === null || typeof src !== 'object') return false;
  const r = (src as { readable?: unknown }).readable;
  const w = (src as { writable?: unknown }).writable;
  // Duck-type on the Node stream surface (not WHATWG `getReader`/`getWriter`,
  // which `fromWeb` handles): a readable has `pipe`/`on`, a writable `write`/`on`.
  const looksReadable =
    r != null &&
    typeof (r as { on?: unknown }).on === 'function' &&
    typeof (r as { pipe?: unknown }).pipe === 'function';
  const looksWritable =
    w != null &&
    typeof (w as { on?: unknown }).on === 'function' &&
    typeof (w as { write?: unknown }).write === 'function';
  return looksReadable && looksWritable;
}

/** Iterable / async-iterable / string / Promise — accepted by `Readable.from`. */
function isReadableSource(
  src: unknown,
): src is Iterable<unknown> | AsyncIterable<unknown> | Promise<unknown> | string {
  if (typeof src === 'string') return true;
  if (src === null || typeof src !== 'object') return false;
  return (
    typeof (src as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function' ||
    typeof (src as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' ||
    typeof (src as { then?: unknown }).then === 'function'
  );
}

function isWebReadableStream(src: unknown): src is ReadableStream<unknown> {
  return (
    src !== null &&
    typeof src === 'object' &&
    typeof (src as { getReader?: unknown }).getReader === 'function'
  );
}

/** A `Duplex.from`/`compose` body: written chunks → `source`; its yields → read side. */
export type DuplexBodyFn = (
  source: AsyncGenerator<unknown>,
) => AsyncIterable<unknown> | Iterable<unknown> | Promise<unknown> | undefined;

/**
 * Bridge a Duplex's writable side into an async-iterable `source`: each `write`
 * enqueues a chunk (its callback fires once the body has pulled it, applying
 * backpressure), `end` closes the queue. Returns the source generator + the
 * writable-side `_write`/`_final` handlers.
 */
function makeWriteSourceQueue(): {
  source: AsyncGenerator<unknown>;
  onWrite: (chunk: unknown, cb: (err?: Error | null) => void) => void;
  onFinal: (cb: (err?: Error | null) => void) => void;
  fail: (err: unknown) => void;
} {
  const queue: Array<{ chunk: unknown; cb: (err?: Error | null) => void }> = [];
  let pullResolve: (() => void) | null = null;
  let ended = false;
  let failure: unknown = null;

  const wake = (): void => {
    if (pullResolve) {
      const r = pullResolve;
      pullResolve = null;
      r();
    }
  };

  async function* source(): AsyncGenerator<unknown> {
    for (;;) {
      if (failure) throw failure;
      if (queue.length > 0) {
        const entry = queue.shift() as { chunk: unknown; cb: (err?: Error | null) => void };
        // Releasing the writer's callback AFTER the body pulled the chunk is the
        // backpressure: a slow body holds the writable side.
        entry.cb();
        yield entry.chunk;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        pullResolve = resolve;
      });
    }
  }

  return {
    source: source(),
    onWrite: (chunk, cb): void => {
      queue.push({ chunk, cb });
      wake();
    },
    onFinal: (cb): void => {
      ended = true;
      wake();
      cb();
    },
    fail: (err): void => {
      failure = err;
      wake();
    },
  };
}

/** `Duplex.from(fn)` — duplexify a body function `(source) => asyncIterable`. */
function duplexFromBody(fn: DuplexBodyFn, options: DuplexOptions): Duplex {
  const bridge = makeWriteSourceQueue();
  // Run the body once, the first time the readable side is pulled (Node defers
  // the generator until read). `read()` fires on the first consumer demand.
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    void (async () => {
      try {
        const result = fn(bridge.source);
        if (result != null && typeof result === 'object') {
          const it = result as AsyncIterable<unknown> | Iterable<unknown>;
          if (
            typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function' ||
            typeof (it as Iterable<unknown>)[Symbol.iterator] === 'function'
          ) {
            for await (const value of it as AsyncIterable<unknown>) {
              if (d.destroyed) break;
              d.push(value);
            }
          }
        }
        if (!d.destroyed) d.push(null);
      } catch (err) {
        bridge.fail(err);
        if (!d.destroyed) d.destroy(err as Error);
      }
    })();
  };
  const d = new Duplex({
    ...options,
    objectMode: true,
    read(): void {
      // First demand starts the body pump; subsequent `read()`s are no-ops (the
      // pump is push-driven, gated by the readable side's own backpressure).
      start();
    },
    write(chunk, _encoding, cb): void {
      bridge.onWrite(chunk, cb);
    },
    final(cb): void {
      bridge.onFinal(cb);
    },
  });
  return d;
}

/** `Duplex.from(iterable|string|promise)` — readable side from the source, writable discards. */
function duplexFromReadableSource(
  src: Iterable<unknown> | AsyncIterable<unknown> | Promise<unknown> | string,
  options: DuplexOptions,
): Duplex {
  // TODO(backlog: runtime-js/duplex-from-source-ownership)
  // A Promise resolves to a single value; an iterable/string streams its items.
  const iterable: Iterable<unknown> | AsyncIterable<unknown> =
    typeof (src as { then?: unknown }).then === 'function'
      ? (async function* () {
          yield await (src as Promise<unknown>);
        })()
      : (src as Iterable<unknown> | AsyncIterable<unknown>);
  return duplexFromReadable(
    Readable.from(iterable, { objectMode: options.objectMode ?? true }),
    options,
  );
}

function duplexFromReadable(readable: Readable, options: DuplexOptions): Duplex {
  const d = new Duplex({
    ...options,
    objectMode: options.objectMode ?? readable.readableObjectMode,
    read(): void {
      /* push-driven from the readable pump below */
    },
    write(_chunk, _encoding, cb): void {
      // Current rifty divergence: no destination is represented by a
      // success-discarding hook; Node returns a write-disabled Duplex.
      cb();
    },
  });
  readable.on('data', (chunk) => {
    if (!d.destroyed) d.push(chunk);
  });
  readable.once('end', () => {
    if (!d.destroyed) d.push(null);
  });
  readable.once('error', (err) => {
    if (!d.destroyed) d.destroy(err as Error);
  });
  return d;
}

/** `Duplex.from({ readable, writable })` — bridge two Node stream halves. */
function duplexFromHalves(readable: Readable, writable: Writable, options: DuplexOptions): Duplex {
  const d = new Duplex({
    ...options,
    objectMode: options.objectMode ?? true,
    read(): void {
      /* push-driven from the readable below */
    },
    write(chunk, encoding, cb): void {
      writable.write(chunk, encoding, cb);
    },
    final(cb): void {
      writable.end();
      cb();
    },
  });
  readable.on('data', (chunk) => {
    if (!d.destroyed) d.push(chunk);
  });
  readable.once('end', () => {
    if (!d.destroyed) d.push(null);
  });
  readable.once('error', (err) => {
    if (!d.destroyed) d.destroy(err as Error);
  });
  writable.on('error', (err) => {
    if (!d.destroyed) d.destroy(err as Error);
  });
  return d;
}
