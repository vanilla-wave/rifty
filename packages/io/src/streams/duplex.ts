/**
 * Node-compatible `node:stream.Duplex` — owned by `@riftydev/io` per ADR-0012.
 *
 * Per ADR-0034, `Duplex` extends `Readable` and embeds a dedicated `Writable`
 * for the writable side. All public methods (`write`, `end`, `read`, `pipe`,
 * `destroy`) live on the prototype — there is NO per-instance rebinding in
 * the constructor. Subclassing via `super({...})` plus options patched later
 * is therefore safe, and `Object.getPrototypeOf(duplex).write === Duplex.prototype.write`
 * matches Node.
 *
 * Subclasses inside `@riftydev/io` (e.g. `Transform`) that need to customise the
 * writable-side impls supply a factory through the {@link INTERNAL_WRITABLE_SIDE}
 * symbol — a Symbol that lives in this module file and is not exported via
 * `src/index.ts`. Subclasses written outside `@riftydev/io` cannot reach it, so
 * the type wall between "public option bag" and "internal subclass hook" is
 * a real one — not a `_underscore-prefixed` field that any cast can pass
 * through.
 */

import { Readable, type ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions, type WritableState } from './writable.ts';

/**
 * Internal subclass hook key. Symbol-keyed so it cannot appear in the public
 * `ReadableOptions & WritableOptions` shape — subclasses outside `@riftydev/io`
 * have no way to construct this Symbol and therefore cannot inject a custom
 * writable side. {@link Transform} (inside `@riftydev/io`) imports this symbol
 * directly.
 */
export const INTERNAL_WRITABLE_SIDE: unique symbol = Symbol('rifty/io:duplex-internal-writable');

/**
 * Type-only carrier for the symbol-keyed factory hook. Re-exported only inside
 * `@riftydev/io`; not part of `src/index.ts`.
 */
export interface DuplexInternalOptions {
  [INTERNAL_WRITABLE_SIDE]?: (opts: ReadableOptions & WritableOptions) => Writable;
}

export class Duplex extends Readable {
  /**
   * The internal `Writable` side. Exposed for tests / debugging only — public
   * code drives the duplex via the prototype methods (`d.write`, `d.end`).
   */
  readonly writableSide: Writable;

  constructor(opts: ReadableOptions & WritableOptions = {}) {
    super(opts);
    // The symbol-keyed factory is the only way to override the writable side.
    // Public callers can't reach the Symbol (it's not exported via index.ts);
    // `Transform` (inside @riftydev/io) injects it through `super({...})` — see
    // `transform.ts`.
    const factory = (opts as DuplexInternalOptions)[INTERNAL_WRITABLE_SIDE];
    this.writableSide = factory ? factory(opts) : new Writable(opts);
    // Propagate the writable side's events up to the duplex.
    this.writableSide.on('finish', () => {
      this.emit('finish');
    });
    this.writableSide.on('error', (err) => {
      this.emit('error', err);
    });
    this.writableSide.on('drain', () => {
      this.emit('drain');
    });
  }

  /**
   * Expose `_writableState` directly so callers using Node's
   * `d._writableState.{destroyed,length,…}` introspection pattern work
   * end-to-end. Reading is fine; writing should go through the public
   * methods.
   */
  get _writableState(): WritableState {
    return this.writableSide._writableState;
  }

  // ---- Public accessors mirroring Node's Writable getters on a Duplex. ----

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
   * Forward writes to the embedded writable side. Per Node, `Duplex.write` is
   * a single function on the prototype — subclasses can `super.write(chunk, ...)`.
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
   * Destroying a Duplex destroys BOTH halves (Node behaviour) — the readable
   * side stops pushing data; the writable side errors any queued writes.
   */
  override destroy(err?: Error): this {
    // Destroy the writable side first so its pending callbacks error before
    // the readable side's close fires. Both are idempotent.
    this.writableSide.destroy(err);
    super.destroy(err);
    return this;
  }
}
