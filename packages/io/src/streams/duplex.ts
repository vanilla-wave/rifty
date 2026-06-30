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

import { Readable, type ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions, type WritableState } from './writable.ts';

type WriteOverride = (
  this: Duplex,
  chunk: unknown,
  encoding: string,
  cb: (err?: Error | null) => void,
) => void;

type FinalOverride = (this: Duplex, cb: (err?: Error | null) => void) => void;

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

/** The `allowHalfOpen` option (and the WHATWG-pair shape) layered onto Duplex. */
export interface DuplexOptions extends ReadableOptions, WritableOptions {
  /**
   * When `false`, the readable side ending auto-ends the writable side (Node's
   * socket-like coupling). Defaults to `true` for a bare `new Duplex()` (Node
   * parity); `Duplex.fromWeb` deliberately defaults it to `false`.
   */
  allowHalfOpen?: boolean;
}

export class Duplex extends Readable {
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
    this.writableSide.on('error', (err) => {
      this.emit('error', err);
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
  end(chunkOrCb?: unknown, encodingOrCb?: string | (() => void), cb?: () => void): this {
    this.writableSide.end(chunkOrCb, encodingOrCb, cb);
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
  static toWeb(duplex: Duplex): { readable: ReadableStream<unknown>; writable: WritableStream<unknown> } {
    return {
      readable: Readable.toWeb(duplex),
      writable: Writable.toWeb(duplex),
    };
  }

  /**
   * Compose a Node `Duplex` over a WHATWG `{ readable, writable }` pair (Node's
   * `Duplex.fromWeb`, v17). The Duplex's readable side is fed by reading the web
   * `readable`; its writable side pumps into the web `writable`'s writer (with
   * backpressure via the write callback), `_final` → `writer.close`,
   * `destroy(reason)` → `writer.abort` + reader cancel.
   *
   * Defaults `allowHalfOpen` to `false` — deliberately the OPPOSITE of a bare
   * `new Duplex()` (Node parity); `{ allowHalfOpen: true }` is honored. A
   * non-WHATWG pair throws a synchronous `TypeError` (`ERR_INVALID_ARG_TYPE`).
   */
  static fromWeb(
    pair: { readable: ReadableStream<unknown>; writable: WritableStream<unknown> },
    options: DuplexOptions = {},
  ): Duplex {
    if (
      pair === null ||
      typeof pair !== 'object' ||
      typeof (pair.readable as { getReader?: unknown } | undefined)?.getReader !== 'function' ||
      typeof (pair.writable as { getWriter?: unknown } | undefined)?.getWriter !== 'function'
    ) {
      throw new TypeError(
        'The "pair.readable"/"pair.writable" arguments must be of type ReadableStream/WritableStream',
      ) as TypeError & { code?: string };
    }
    const reader = pair.readable.getReader();
    const writer = pair.writable.getWriter();
    let writeAborted = false;

    const d = new Duplex({
      ...options,
      // fromWeb's deliberate default is the OPPOSITE of a bare Duplex.
      allowHalfOpen: options.allowHalfOpen ?? false,
      read(): void {
        reader.read().then(
          ({ done, value }) => {
            if (done) {
              d.push(null);
              return;
            }
            if (value !== undefined) d.push(value);
          },
          (err) => {
            if (!d.destroyed) d.destroy(err as Error);
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
      void reader.cancel().catch(() => {});
    });
    return d;
  }
}
