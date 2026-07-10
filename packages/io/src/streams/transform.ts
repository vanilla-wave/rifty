/**
 * Node-compatible `node:stream.Transform` — owned by `@riftydev/io` per ADR-0012.
 *
 * Per ADR-0034, `write`/`end` live on the prototype — no per-instance rebinding.
 * The implementation resolves like Node: subclass `_write` > the `transform`
 * option > subclass prototype `_transform` > the LOUD base (`_transform()` is
 * not implemented — a bare Transform throws, never a silent identity).
 *
 * Writable-side impls are wired via the Symbol-keyed
 * {@link INTERNAL_WRITABLE_SIDE} hook on `Duplex`, avoiding instance-method
 * rebinding. The Symbol is intentionally not exported from `src/index.ts` —
 * subclasses outside `@riftydev/io` cannot reach it.
 */

import {
  Duplex,
  type DuplexInternalOptions,
  INTERNAL_WRITABLE_SIDE,
  resolveFinalOverride,
  resolveWriteOverride,
} from './duplex.ts';
import { methodNotImplementedError } from './method-not-implemented.ts';
import type { ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions } from './writable.ts';

type TransformCallback = (err?: Error | null, value?: unknown) => void;

export interface TransformOptions extends ReadableOptions, WritableOptions {
  transform?(this: Transform, chunk: unknown, encoding: string, cb: TransformCallback): void;
  /** Node shape: `cb(err, data)` — a flush-produced `data` chunk is pushed. */
  flush?(this: Transform, cb: TransformCallback): void;
}

/** Subclass prototype `_transform`, filtered against the loud base. */
function resolveTransformOverride(
  t: Transform,
): ((this: Transform, chunk: unknown, encoding: string, cb: TransformCallback) => void) | null {
  const value = t._transform;
  return value !== Transform.prototype._transform ? value : null;
}

/** Subclass prototype `_flush` (no base — any function is an implementation). */
function resolveFlushOverride(
  t: Transform,
): ((this: Transform, cb: TransformCallback) => void) | null {
  const value = (t as { _flush?: unknown })._flush;
  return typeof value === 'function'
    ? (value as (this: Transform, cb: TransformCallback) => void)
    : null;
}

export class Transform extends Duplex {
  /** True when the ctor received a `transform` option (instance impl, Node's
   *  `this._transform = options.transform`). */
  private readonly hasTransformOption: boolean;

  constructor(opts: TransformOptions = {}) {
    const transformImpl = opts.transform;
    const flushImpl = opts.flush;
    // `this` isn't available until super() returns, but the writable-side
    // factory only needs the ref at write-time — back-fill a ref-cell after super.
    const transformRef: { instance: Transform | null } = { instance: null };
    // The `Duplex` ctor type advertises only `ReadableOptions & WritableOptions`
    // but reads the `INTERNAL_WRITABLE_SIDE` symbol key internally; assemble both
    // into one bag. The symbol key is invisible to callers outside this package.
    const superOpts: ReadableOptions & WritableOptions & DuplexInternalOptions = {
      ...opts,
      [INTERNAL_WRITABLE_SIDE]: (innerOpts, owner) =>
        new Writable({
          ...innerOpts,
          write(chunk, encoding, cb): void {
            const t = transformRef.instance ?? (owner as Transform);
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            const override = resolveWriteOverride(t);
            if (override) {
              override.call(t, chunk, encoding, cb);
              return;
            }
            const transform = transformImpl ?? resolveTransformOverride(t);
            if (transform) {
              transform.call(t, chunk, encoding, (err, value) => {
                if (err) {
                  cb(err);
                  return;
                }
                if (value !== undefined && value !== null) t.push(value);
                cb();
              });
              return;
            }
            // Corked-flush backstop; the sync path throws in write() already
            // (writeEntryError) — Node's bare Transform is LOUD, not identity.
            throw methodNotImplementedError('_transform()');
          },
          final(cb): void {
            const t = transformRef.instance ?? (owner as Transform);
            if (!t) {
              cb(new Error('Transform stream not yet bound — internal invariant violated'));
              return;
            }
            const override = resolveFinalOverride(t);
            if (override) {
              override.call(t, cb);
              return;
            }
            const finalize = (): void => {
              t.push(null);
              cb();
            };
            const flush = flushImpl ?? resolveFlushOverride(t);
            if (flush) {
              flush.call(t, (err, value) => {
                if (err) {
                  cb(err);
                  return;
                }
                // Node's `_flush(cb(err, data))`: a produced chunk is pushed.
                if (value !== undefined && value !== null) t.push(value);
                finalize();
              });
              return;
            }
            finalize();
          },
        }),
    };
    super(superOpts);
    transformRef.instance = this;
    this.hasTransformOption = typeof transformImpl === 'function';
  }

  /** Node's loud base: a bare Transform reports `_transform()`, sync from `write()`. */
  _transform(_chunk: unknown, _encoding: string, _cb: TransformCallback): void {
    throw methodNotImplementedError('_transform()');
  }

  /** Node defines `Transform.prototype._read` — the readable side is fed by
   *  the transform callback (push), never pulled; without this the loud
   *  `Readable` base would destroy every Transform on first read. */
  override _read(): void {}

  protected override writeEntryError(): Error | null {
    if (resolveWriteOverride(this)) return null;
    if (this.hasTransformOption) return null;
    if (resolveTransformOverride(this)) return null;
    return methodNotImplementedError('_transform()');
  }
}
