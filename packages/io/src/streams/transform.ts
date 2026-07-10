/**
 * Node-compatible `node:stream.Transform` — owned by `@riftydev/io` per ADR-0012.
 *
 * Per ADR-0034, `write`/`end` live on the prototype — no per-instance rebinding.
 * HOOK dispatch replicates Node's own mechanism: the ctor assigns the
 * `transform`/`flush` options onto the INSTANCE, `Transform.prototype._write`
 * dispatches `this._transform` (loud base — a bare Transform throws, never a
 * silent identity), so precedence is Node's for free: write option (instance
 * `_write`) > subclass `_write` > transform machinery; transform option >
 * subclass `_transform` > loud base.
 *
 * The writable side is wired via the Symbol-keyed {@link INTERNAL_WRITABLE_SIDE}
 * hook on `Duplex` — only to install the transform FINALIZER (Node's 'prefinish'
 * equivalent): user `_final` → `_flush` → `push(null)` → deferred cb, giving
 * Node's observable `final → flush → flush-data → end → finish` order (probed
 * v24.16.0). The Symbol is intentionally not exported from `src/index.ts`.
 */

import { Duplex, type DuplexInternalOptions, INTERNAL_WRITABLE_SIDE } from './duplex.ts';
import { methodNotImplementedError } from './method-not-implemented.ts';
import type { ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions } from './writable.ts';

type TransformCallback = (err?: Error | null, value?: unknown) => void;

export interface TransformOptions extends ReadableOptions, WritableOptions {
  transform?(this: Transform, chunk: unknown, encoding: string, cb: TransformCallback): void;
  /** Node shape: `cb(err, data)` — a flush-produced `data` chunk is pushed. */
  flush?(this: Transform, cb: TransformCallback): void;
}

/**
 * The transform finalizer (Node's 'prefinish' path): run the user `_final`
 * first (instance option or subclass prototype — Node rides the Writable
 * `_final` slot), then `_flush` (its `cb(err, data)` chunk is pushed), then
 * `push(null)`. The write-side cb is deferred one microtask AFTER `push(null)`
 * so a flowing consumer sees 'end' before 'finish' (Node's tick-deferred
 * finish; probed v24.16.0). A `_final`/`_flush` error skips the rest and
 * surfaces via the cb ('error', no 'finish', no 'end') — also Node.
 */
function transformFinalize(t: Transform, cb: (err?: Error | null) => void): void {
  // Deferred one microtask: Node's 'prefinish' runs on a later tick than the
  // in-drain write completion, so a chunk pushed synchronously by the LAST
  // `_transform` has its 'data' delivered BEFORE the user 'final' hook runs.
  queueMicrotask(() => transformFinalizeNow(t, cb));
}

function transformFinalizeNow(t: Transform, cb: (err?: Error | null) => void): void {
  const finishFlush = (): void => {
    const flush = t._flush;
    if (typeof flush === 'function') {
      flush.call(t, (err, value) => {
        if (err) {
          cb(err);
          return;
        }
        if (value !== undefined && value !== null) t.push(value);
        t.push(null);
        queueMicrotask(() => cb());
      });
      return;
    }
    t.push(null);
    queueMicrotask(() => cb());
  };
  const userFinal = t._final;
  if (typeof userFinal === 'function') {
    userFinal.call(t, (err) => {
      if (err) {
        cb(err);
        return;
      }
      finishFlush();
    });
    return;
  }
  finishFlush();
}

export class Transform extends Duplex {
  constructor(opts: TransformOptions = {}) {
    // The `Duplex` ctor type advertises only `ReadableOptions & WritableOptions`
    // but reads the `INTERNAL_WRITABLE_SIDE` symbol key internally; assemble both
    // into one bag. The symbol key is invisible to callers outside this package.
    const superOpts: ReadableOptions & WritableOptions & DuplexInternalOptions = {
      ...opts,
      [INTERNAL_WRITABLE_SIDE]: (innerOpts, owner) =>
        new Writable({
          ...innerOpts,
          // Node dispatch chain on the TRANSFORM: instance `_write` (write
          // option) > subclass `_write` > `Transform.prototype._write` (the
          // `this._transform` machinery).
          write: (chunk, encoding, cb): void => {
            (owner as Transform)._write(chunk, encoding, cb);
          },
          writev:
            typeof (owner as Transform)._writev === 'function'
              ? (chunks, cb): void => {
                  (owner as Transform)._writev?.(chunks, cb);
                }
              : undefined,
          final: (cb): void => {
            transformFinalize(owner as Transform, cb);
          },
        }),
    };
    super(superOpts);
    // Node's own mechanism: `this._transform = options.transform` (instance
    // shadows subclass prototype, which shadows the loud base).
    if (typeof opts.transform === 'function') this._transform = opts.transform;
    if (typeof opts.flush === 'function') this._flush = opts.flush;
  }

  /** Node's loud base: a bare Transform reports `_transform()`, sync from `write()`. */
  _transform(_chunk: unknown, _encoding: string, _cb: TransformCallback): void {
    throw methodNotImplementedError('_transform()');
  }

  /** Flush hook — absent unless assigned (option) or subclass-defined, like Node. */
  _flush?(cb: TransformCallback): void;

  /** Node's `Transform.prototype._write`: feed the chunk through `this._transform`,
   *  pushing a produced value (`cb(err, data)` shape). */
  override _write(chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void {
    this._transform(chunk, encoding, (err, value) => {
      if (err) {
        cb(err);
        return;
      }
      if (value !== undefined && value !== null) this.push(value);
      cb();
    });
  }

  /** Node defines `Transform.prototype._read` — the readable side is fed by
   *  the transform callback (push), never pulled; without this the loud
   *  `Readable` base would destroy every Transform on first read. */
  override _read(): void {}

  protected override writeEntryError(): Error | null {
    if (this._write !== Transform.prototype._write) return null;
    if (this._transform !== Transform.prototype._transform) return null;
    return methodNotImplementedError('_transform()');
  }
}
